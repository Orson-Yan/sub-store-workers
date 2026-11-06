/**
 * 客户端配置模板（纯函数，无 Sub-Store 运行时依赖）。
 *
 * Sub-Store 的 producers 只输出节点（proxies / server_local），不含 proxy-groups、
 * policy 与 rules。这里把节点列表渲染成完整配置：
 *
 *   - buildClashConfig：mihomo / Clash（Clash Party、Mihomo Party、Stash、Verge…）
 *   - buildQxConfig：Quantumult X（圈X）
 *
 * 放在 utils 下的原因：不引入 `@/core/app` 等有副作用的运行时，测试可直接引用。
 */

import YAML from 'yaml';

/**
 * 配置渲染路由。
 *
 *   /<密码>/cfg/<订阅或组合名>          按 User-Agent 自动选择格式（推荐）
 *   /<密码>/cfg/clash/<订阅或组合名>    强制 mihomo / Clash
 *   /<密码>/cfg/qx/<订阅或组合名>       强制 Quantumult X
 */
const CONFIG_ROUTE = /^\/([^/]+)\/cfg\/(?:(clash|qx)\/)?([^/]+)$/;

const REGION_RULES = [
    {
        group: '🇭🇰 香港',
        keys: ['🇭🇰', '香港', 'hongkong', 'hong kong'],
        ascii: ['hk'],
    },
    {
        group: '🇹🇼 台湾',
        keys: ['🇹🇼', '台湾', '台灣', 'taiwan'],
        ascii: ['tw'],
    },
    {
        group: '🇯🇵 日本',
        keys: ['🇯🇵', '日本', 'japan', '东京', '大阪', '埼玉'],
        ascii: ['jp'],
    },
    {
        group: '🇸🇬 新加坡',
        keys: ['🇸🇬', '新加坡', '狮城', 'singapore'],
        ascii: ['sg'],
    },
    {
        group: '🇺🇸 美国',
        keys: ['🇺🇸', '美国', '美國', '洛杉矶', '硅谷', '西雅图', '纽约', '达拉斯', '圣何塞'],
        ascii: ['us', 'usa'],
    },
    {
        group: '🇰🇷 韩国',
        keys: ['🇰🇷', '韩国', '韓國', '首尔', 'korea'],
        ascii: ['kr'],
    },
    {
        group: '🇬🇧 英国',
        keys: ['🇬🇧', '英国', '英國', '伦敦', 'united kingdom'],
        ascii: ['uk', 'gb'],
    },
    {
        group: '🇩🇪 德国',
        keys: ['🇩🇪', '德国', '德國', '法兰克福', 'germany'],
        ascii: ['de'],
    },
];

/**
 * 按节点名归类到地区分组。
 * ASCII 缩写（HK/JP/US…）用边界匹配，避免 "AUS"、"MSG" 这类误判。
 *
 * @param {string} name
 * @returns {string|null} 命中的分组名，未命中返回 null
 */
export function classifyRegion(name) {
    const raw = `${name || ''}`;
    const lower = raw.toLowerCase();

    for (const rule of REGION_RULES) {
        if (rule.keys.some((key) => lower.includes(key.toLowerCase()))) {
            return rule.group;
        }
        for (const code of rule.ascii) {
            const pattern = new RegExp(`(^|[^a-z])${code}($|[^a-z])`, 'i');
            if (pattern.test(raw)) return rule.group;
        }
    }
    return null;
}

/**
 * 把节点名按地区分组，保持原始顺序。
 *
 * @param {Array<{name: string}>} proxies
 * @returns {{ groups: Array<{name: string, proxies: string[]}>, others: string[] }}
 */
export function groupByRegion(proxies) {
    const names = proxies.map((proxy) => `${proxy.name}`);
    const buckets = new Map();
    const others = [];

    for (const name of names) {
        const region = classifyRegion(name);
        if (!region) {
            others.push(name);
            continue;
        }
        if (!buckets.has(region)) buckets.set(region, []);
        buckets.get(region).push(name);
    }

    const groups = REGION_RULES.filter((rule) => buckets.has(rule.group)).map(
        (rule) => ({ name: rule.group, proxies: buckets.get(rule.group) }),
    );

    return { groups, others };
}

const CLASH_RULES = [
    'GEOSITE,category-ads-all,🛑 广告拦截',
    'GEOSITE,private,🎯 全局直连',
    'GEOIP,private,🎯 全局直连,no-resolve',
    'GEOSITE,cn,🎯 全局直连',
    'GEOIP,CN,🎯 全局直连,no-resolve',
    'MATCH,🐟 漏网之鱼',
];

/**
 * 生成完整 mihomo / Clash 配置。
 *
 * @param {Array<object>} proxies
 * @returns {string}
 */
export function buildClashConfig(proxies) {
    const { groups, others } = groupByRegion(proxies);
    const allNames = proxies.map((proxy) => `${proxy.name}`);

    const proxyGroups = [
        {
            name: '🚀 节点选择',
            type: 'select',
            proxies: ['♻️ 自动选择', ...groups.map((g) => g.name), 'DIRECT'],
        },
        {
            name: '♻️ 自动选择',
            type: 'url-test',
            url: 'http://www.gstatic.com/generate_204',
            interval: 300,
            tolerance: 50,
            proxies: allNames.length > 0 ? allNames : ['DIRECT'],
        },
        ...groups.map((group) => ({
            name: group.name,
            type: 'select',
            proxies: [...group.proxies, 'DIRECT'],
        })),
    ];

    if (others.length > 0) {
        proxyGroups.push({
            name: '🌐 其他节点',
            type: 'select',
            proxies: [...others, 'DIRECT'],
        });
    }

    proxyGroups.push(
        {
            name: '🎯 全局直连',
            type: 'select',
            proxies: ['DIRECT', '🚀 节点选择'],
        },
        { name: '🛑 广告拦截', type: 'select', proxies: ['REJECT', 'DIRECT'] },
        {
            name: '🐟 漏网之鱼',
            type: 'select',
            proxies: ['🚀 节点选择', '🎯 全局直连', 'DIRECT'],
        },
    );

    const config = {
        'mixed-port': 7890,
        'allow-lan': false,
        mode: 'rule',
        'log-level': 'info',
        ipv6: false,
        'unified-delay': true,
        'tcp-concurrent': true,
        dns: {
            enable: true,
            ipv6: false,
            'enhanced-mode': 'fake-ip',
            'fake-ip-range': '198.18.0.1/16',
            'default-nameserver': ['223.5.5.5', '119.29.29.29'],
            nameserver: [
                'https://doh.pub/dns-query',
                'https://dns.alidns.com/dns-query',
            ],
            fallback: ['https://1.1.1.1/dns-query', 'https://dns.google/dns-query'],
            'fallback-filter': { geoip: true, 'geoip-code': 'CN' },
        },
        proxies,
        'proxy-groups': proxyGroups,
        rules: CLASH_RULES,
    };

    return YAML.stringify(config, { lineWidth: 0 });
}

/** QX 广告规则（filter_remote）。jsdelivr 国内可直连，避免 raw.githubusercontent 被墙 */
const QX_FILTER_REMOTE = [
    'https://cdn.jsdelivr.net/gh/blackmatrix7/ios_rule_script@master/rule/QuantumultX/Advertising/Advertising.list, tag=广告拦截, force-policy=🛑 广告拦截, enabled=true',
];

/**
 * 生成完整 Quantumult X 配置。
 *
 * @param {string} serverLines Sub-Store QX producer 输出的 server_local 行
 * @returns {string}
 */
export function buildQxConfig(serverLines) {
    const lines = `${serverLines || ''}`
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

    const nodes = lines.map((line) => {
        const match = /,tag=(.+)$/.exec(line);
        return { line, name: match ? match[1] : null };
    });

    const named = nodes.filter((node) => node.name);
    const { groups, others } = groupByRegion(
        named.map((node) => ({ name: node.name })),
    );
    const allNames = named.map((node) => node.name);

    const policy = [];
    const members = ['♻️ 自动选择', ...groups.map((g) => g.name)];
    if (others.length > 0) members.push('🌐 其他节点');
    policy.push(`static=🚀 节点选择, ${[...members, 'direct'].join(', ')}`);

    if (allNames.length > 0) {
        policy.push(
            `url-latency-benchmark=♻️ 自动选择, ${allNames.join(
                ', ',
            )}, check-interval=600, tolerance=100`,
        );
    }

    for (const group of groups) {
        policy.push(
            `static=${group.name}, ${[...group.proxies, 'direct'].join(', ')}`,
        );
    }
    if (others.length > 0) {
        policy.push(`static=🌐 其他节点, ${[...others, 'direct'].join(', ')}`);
    }

    policy.push(
        'static=🎯 全局直连, direct',
        'static=🛑 广告拦截, reject, direct',
        'static=🐟 漏网之鱼, 🚀 节点选择, 🎯 全局直连, direct',
    );

    const filterLocal = [
        'host-suffix, local, direct',
        'host-suffix, localdomain, direct',
        'ip-cidr, 10.0.0.0/8, direct',
        'ip-cidr, 172.16.0.0/12, direct',
        'ip-cidr, 192.168.0.0/16, direct',
        'ip-cidr, 127.0.0.0/8, direct',
        'geoip, cn, 🎯 全局直连',
        'final, 🐟 漏网之鱼',
    ];

    return [
        '[general]',
        'server_check_url=http://www.gstatic.com/generate_204',
        'network_check_url=http://www.baidu.com',
        'dns-server=223.5.5.5, 119.29.29.29',
        'ipv6=false',
        '',
        '[dns]',
        'server=223.5.5.5',
        'server=119.29.29.29',
        'no-system',
        '',
        '[policy]',
        ...policy,
        '',
        '[server_local]',
        ...nodes.map((node) => node.line),
        '',
        '[filter_remote]',
        ...QX_FILTER_REMOTE,
        '',
        '[filter_local]',
        ...filterLocal,
        '',
    ].join('\n');
}

/**
 * 解析 Sub-Store 的 Clash 节点输出（形如 `proxies:\n - {...}`）。
 *
 * @param {string} text
 * @returns {Array<object>}
 */
export function parseClashProxies(text) {
    const parsed = YAML.parse(text || '');
    if (!parsed || !Array.isArray(parsed.proxies)) {
        throw new Error('Sub-Store 返回的节点列表为空');
    }
    return parsed.proxies;
}

/**
 * 把 Sub-Store 识别出的平台映射成配置模板类型。
 * QX 之外的客户端统一走 mihomo 模板（本仓库只维护这两种模板）。
 *
 * @param {string} platform 例如 QX / ClashMeta / Surge / sing-box
 * @returns {'clash'|'qx'}
 */
export function pickClientFromPlatform(platform) {
    const value = `${platform || ''}`.toUpperCase();
    return value === 'QX' || value === 'QUANTUMULTX' ? 'qx' : 'clash';
}

/**
 * 匹配配置渲染路由。
 *
 * @param {string} pathname
 * @returns {{ password: string, client: 'clash'|'qx'|null, name: string }|null}
 */
export function matchConfigRoute(pathname) {
    const match = CONFIG_ROUTE.exec(pathname);
    if (!match) return null;
    return {
        password: decodeURIComponent(match[1]),
        client: /** @type {'clash'|'qx'|null} */ (match[2] || null),
        name: decodeURIComponent(match[3]),
    };
}

/**
 * 判断请求是否命中配置渲染路由。
 *
 * @param {string} pathname
 * @returns {boolean}
 */
export function isConfigRequest(pathname) {
    return CONFIG_ROUTE.test(pathname);
}
