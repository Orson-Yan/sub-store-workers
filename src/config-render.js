/**
 * 完整配置渲染路由处理。
 *
 * 与 Sub-Store 的分工：Sub-Store 负责合并/过滤/重命名，produceArtifact 产出节点列表；
 * 本模块把节点列表套进模板，输出「节点 + 分组 + 规则」的完整客户端配置。
 *
 * 两种入口：
 *   1. 密码前缀（管理员自用）
 *        /<密码>/cfg/<订阅或组合名>
 *        /<密码>/cfg/<clash|qx>/<订阅或组合名>
 *   2. 分享 token（可撤销、可过期，不暴露密码）
 *        /cfg/share/<sub|col>/<名称>?token=xxx[&format=clash|qx]
 *
 * 纯模板逻辑在 @/utils/config-templates，便于单测；这里只做鉴权、取数和响应。
 */

import $ from '@/core/app';
import { produceArtifact } from '@/restful/sync';
import { SUBS_KEY, COLLECTIONS_KEY } from '@/constants';
import { findByName } from '@/utils/database';
import { consumeShareToken } from '@/restful/token';
import { getPlatformFromHeaders } from '@/utils/user-agent';
import {
    isConfigRequest,
    matchConfigRoute,
    matchShareConfigRoute,
    pickClientFromPlatform,
    buildClashConfig,
    buildQxConfig,
    parseClashProxies,
} from '@/utils/config-templates';

export { isConfigRequest };

const ALLOWED_METHODS = new Set(['GET', 'HEAD']);

/**
 * 查找订阅或组合，找不到返回 null。
 *
 * @param {string} name
 * @returns {{ type: 'subscription'|'collection', name: string }|null}
 */
export function resolveSource(name) {
    if (findByName($.read(SUBS_KEY), name)) {
        return { type: 'subscription', name };
    }
    if (findByName($.read(COLLECTIONS_KEY), name)) {
        return { type: 'collection', name };
    }
    return null;
}

function detectClient(request, explicit) {
    if (explicit === 'clash' || explicit === 'qx') return explicit;
    return pickClientFromPlatform(
        getPlatformFromHeaders(Object.fromEntries(request.headers)),
    );
}

function textResponse(body, status, contentType = 'text/plain; charset=utf-8') {
    return new Response(body, {
        status,
        headers: { 'content-type': contentType },
    });
}

/**
 * 处理配置渲染请求。调用前必须已完成 $.initFromKV。
 *
 * @param {Request} request
 * @param {URL} url 原始请求 URL（含密码前缀）
 * @param {{ backendPath?: string }} options backendPath 需已 normalize
 * @returns {Promise<Response>}
 */
export async function handleConfigRequest(request, url, { backendPath }) {
    if (!ALLOWED_METHODS.has(request.method.toUpperCase())) {
        return new Response('Method not allowed', {
            status: 405,
            headers: { Allow: 'GET, HEAD' },
        });
    }

    const pathname = url.pathname;
    const share = matchShareConfigRoute(pathname);
    let source;
    let client;

    if (share) {
        // 分享链接：token 绑定 type + name，可被撤销/过期/限次，且不暴露密码前缀
        const token = url.searchParams.get('token');
        if (!token) {
            return textResponse('Share token is required', 403);
        }
        const tokenData = consumeShareToken({
            token,
            type: share.type,
            name: share.name,
            pathname: `/share/${share.type}/${share.name}`,
        });
        if (!tokenData) {
            return textResponse('Invalid or expired share token', 403);
        }

        source = resolveSource(share.name);
        const expectedType = share.type === 'sub' ? 'subscription' : 'collection';
        if (!source || source.type !== expectedType) {
            return textResponse('Shared subscription not found', 404);
        }
        client = detectClient(request, url.searchParams.get('format'));
    } else {
        const matched = matchConfigRoute(pathname);
        const expected = `${backendPath || ''}`.replace(/^\/+/, '');
        if (!matched || !expected || matched.password !== expected) {
            // 统一 404：既不暴露路由是否存在，也不返回未受保护的节点信息
            return new Response('Not Found', { status: 404 });
        }

        source = resolveSource(matched.name);
        if (!source) {
            return textResponse('Subscription or collection not found', 404);
        }
        client = detectClient(request, matched.client);
    }

    let text;
    try {
        text = await produceArtifact({
            type: source.type,
            name: source.name,
            platform: client === 'qx' ? 'QuantumultX' : 'mihomo',
            // 配置渲染只需要节点，跳过流量查询，避免每次请求都访问机场
            noFlow: true,
        });
    } catch (error) {
        return textResponse(`Failed to produce nodes: ${error.message}`, 502);
    }

    let body;
    try {
        body =
            client === 'qx'
                ? buildQxConfig(`${text == null ? '' : text}`)
                : buildClashConfig(parseClashProxies(`${text == null ? '' : text}`));
    } catch (error) {
        return textResponse(`Failed to render config: ${error.message}`, 500);
    }

    return new Response(
        request.method.toUpperCase() === 'HEAD' ? null : body,
        {
            status: 200,
            headers: {
                'content-type':
                    client === 'qx'
                        ? 'text/plain; charset=utf-8'
                        : 'text/yaml; charset=utf-8',
                'cache-control': 'no-store',
                'access-control-allow-origin': '*',
                // 客户端按 6 小时刷新
                'profile-update-interval': '6',
            },
        },
    );
}
