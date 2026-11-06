/**
 * 完整配置渲染路由处理。
 *
 * 与 Sub-Store 的分工：Sub-Store 负责合并/过滤/重命名，produceArtifact 产出节点列表；
 * 本模块把节点列表套进模板，输出「节点 + 分组 + 规则」的完整客户端配置。
 *
 *   /<密码>/cfg/clash/<订阅或组合名>  → mihomo / Clash
 *   /<密码>/cfg/qx/<订阅或组合名>     → Quantumult X
 *
 * 纯模板逻辑在 @/utils/config-templates，便于单测；这里只做鉴权、取数和响应。
 */

import $ from '@/core/app';
import { produceArtifact } from '@/restful/sync';
import { SUBS_KEY, COLLECTIONS_KEY } from '@/constants';
import { findByName } from '@/utils/database';
import {
    isConfigRequest,
    matchConfigRoute,
    pickClientFromPlatform,
    buildClashConfig,
    buildQxConfig,
    parseClashProxies,
} from '@/utils/config-templates';
import { getPlatformFromHeaders } from '@/utils/user-agent';

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

/**
 * 处理配置渲染请求。调用前必须已完成 $.initFromKV。
 *
 * @param {Request} request
 * @param {string} pathname 原始路径（含密码前缀）
 * @param {{ backendPath?: string }} options backendPath 需已 normalize
 * @returns {Promise<Response>}
 */
export async function handleConfigRequest(request, pathname, { backendPath }) {
    if (!ALLOWED_METHODS.has(request.method.toUpperCase())) {
        return new Response('Method not allowed', {
            status: 405,
            headers: { Allow: 'GET, HEAD' },
        });
    }

    const matched = matchConfigRoute(pathname);
    const expected = `${backendPath || ''}`.replace(/^\/+/, '');
    if (!matched || !expected || matched.password !== expected) {
        // 统一 404：既不暴露路由是否存在，也不返回未受保护的节点信息
        return new Response('Not Found', { status: 404 });
    }

    const source = resolveSource(matched.name);
    if (!source) {
        return new Response('Subscription or collection not found', {
            status: 404,
            headers: { 'content-type': 'text/plain; charset=utf-8' },
        });
    }

    // 未在路径里指定格式时，按客户端 User-Agent 自动识别：QX → 圈X 配置，其余 → mihomo
    const client =
        matched.client ||
        pickClientFromPlatform(getPlatformFromHeaders(Object.fromEntries(request.headers)));

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
        return new Response(`Failed to produce nodes: ${error.message}`, {
            status: 502,
            headers: { 'content-type': 'text/plain; charset=utf-8' },
        });
    }

    let body;
    try {
        body =
            client === 'qx'
                ? buildQxConfig(`${text == null ? '' : text}`)
                : buildClashConfig(parseClashProxies(`${text == null ? '' : text}`));
    } catch (error) {
        return new Response(`Failed to render config: ${error.message}`, {
            status: 500,
        });
    }

    const contentType =
        client === 'qx' ? 'text/plain; charset=utf-8' : 'text/yaml; charset=utf-8';

    return new Response(
        request.method.toUpperCase() === 'HEAD' ? null : body,
        {
            status: 200,
            headers: {
                'content-type': contentType,
                'cache-control': 'no-store',
                'access-control-allow-origin': '*',
                // 客户端按 6 小时刷新
                'profile-update-interval': '6',
            },
        },
    );
}
