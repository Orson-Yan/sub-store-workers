/**
 * 客户端配置模板（纯函数，无 Sub-Store 运行时依赖）。
 *
 * Sub-Store 的 producers 只输出节点（proxies / server_local），不含 proxy-groups、
 * policy 与 rules。这里把节点套进完整配置模板：
 *
 *   - buildClashConfig：mihomo / Clash（Clash Party、Mihomo Party、Verge、Stash…）
 *   - buildQxConfig：Quantumult X（圈X）
 *
 * 分流采用 rule-providers / filter_remote，规则源为：
 *   - Clash：MetaCubeX/meta-rules-dat 的 geosite / geoip YAML（jsDelivr）
 *   - QX：blackmatrix7/ios_rule_script 的 QuantumultX list（jsDelivr）
 * 相比 GEOSITE / GEOIP 内联规则，不依赖客户端是否下载了 geodata，
 * 规则更新由客户端按 interval 自动拉取。
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

/** 分享 token 路由：/cfg/share/<sub|col>/<名称>?token=xxx */
const SHARE_CONFIG_ROUTE = /^\/cfg\/share\/(sub|col)\/([^/]+)$/;

const GEOSITE = (name) =>
    `https://cdn.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo/geosite/${name}.yaml`;
const GEOIP = (name) =>
    `https://cdn.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo/geoip/${name}.yaml`;
const QX_RULE = (name) =>
    `https://cdn.jsdelivr.net/gh/blackmatrix7/ios_rule_script@master/rule/QuantumultX/${name}/${name}.list`;

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
 * @returns {string|null}
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

const CLASH_RULE_PROVIDERS = {
    ads: { behavior: 'domain', url: GEOSITE('category-ads-all') },
    'private-domain': { behavior: 'domain', url: GEOSITE('private') },
    'private-ip': { behavior: 'ipcidr', url: GEOIP('private') },
    telegram: { behavior: 'domain', url: GEOSITE('telegram') },
    netflix: { behavior: 'domain', url: GEOSITE('netflix') },
    disney: { behavior: 'domain', url: GEOSITE('disney') },
    youtube: { behavior: 'domain', url: GEOSITE('youtube') },
    spotify: { behavior: 'domain', url: GEOSITE('spotify') },
    netease: { behavior: 'domain', url: GEOSITE('netease') },
    bilibili: { behavior: 'domain', url: GEOSITE('bilibili') },
    openai: { behavior: 'domain', url: GEOSITE('openai') },
    github: { behavior: 'domain', url: GEOSITE('github') },
    apple: { behavior: 'domain', url: GEOSITE('apple') },
    microsoft: { behavior: 'domain', url: GEOSITE('microsoft') },
    games: { behavior: 'domain', url: GEOSITE('category-games') },
    'media-cn': { behavior: 'domain', url: GEOSITE('category-media-cn') },
    'cn-domain': { behavior: 'domain', url: GEOSITE('geolocation-cn') },
    'cn-ip': { behavior: 'ipcidr', url: GEOIP('cn') },
};

/**
 * 生成完整 mihomo / Clash 配置。
 *
 * @param {Array<object>} proxies
 * @returns {string}
 */
export function buildClashConfig(proxies) {
    const { groups, others } = groupByRegion(proxies);
    const allNames = proxies.map((proxy) => `${proxy.name}`);
    const regionNames = groups.map((group) => group.name);

    const nodeTargets = [
        '♻️ 自动选择',
        '🔯 故障转移',
        '🔮 负载均衡',
        ...regionNames,
        ...(others.length > 0 ? ['🌐 其他节点'] : []),
        'DIRECT',
    ];

    /** 地区节点组 + 直连兜底，用于各类分流的「手动选择」 */
    const regionTargets = [...regionNames, 'DIRECT'];

    const proxyGroups = [
        { name: '🚀 节点选择', type: 'select', proxies: nodeTargets },
        {
            name: '♻️ 自动选择',
            type: 'url-test',
            url: 'http://www.gstatic.com/generate_204',
            interval: 300,
            tolerance: 50,
            proxies: allNames.length > 0 ? allNames : ['DIRECT'],
        },
        {
            name: '🔯 故障转移',
            type: 'fallback',
            url: 'http://www.gstatic.com/generate_204',
            interval: 300,
            proxies: allNames.length > 0 ? allNames : ['DIRECT'],
        },
        {
            name: '🔮 负载均衡',
            type: 'load-balance',
            strategy: 'consistent-hashing',
            url: 'http://www.gstatic.com/generate_204',
            interval: 300,
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
            name: '📲 电报消息',
            type: 'select',
            proxies: ['🚀 节点选择', ...regionTargets],
        },
        {
            name: '🎥 奈飞视频',
            type: 'select',
            proxies: ['🚀 节点选择', ...regionTargets],
        },
        {
            name: '🎬 迪士尼+',
            type: 'select',
            proxies: ['🚀 节点选择', ...regionTargets],
        },
        {
            name: '📺 油管视频',
            type: 'select',
            proxies: ['🚀 节点选择', ...regionTargets],
        },
        {
            name: '🎶 国外音乐',
            type: 'select',
            proxies: ['🚀 节点选择', ...regionTargets],
        },
        {
            name: '🎵 网易云音乐',
            type: 'select',
            proxies: ['🎯 全球直连', '🚀 节点选择', 'DIRECT'],
        },
        {
            name: '📺 哔哩哔哩',
            type: 'select',
            proxies: [
                '🎯 全球直连',
                ...regionNames.filter((name) =>
                    ['🇭🇰 香港', '🇹🇼 台湾'].includes(name),
                ),
                '🚀 节点选择',
                'DIRECT',
            ],
        },
        {
            name: '🤖 OpenAI',
            type: 'select',
            proxies: ['🚀 节点选择', ...regionTargets],
        },
        {
            name: '🐙 GitHub',
            type: 'select',
            proxies: ['🚀 节点选择', ...regionTargets],
        },
        {
            name: '🍎 苹果服务',
            type: 'select',
            proxies: ['🎯 全球直连', '🚀 节点选择', 'DIRECT'],
        },
        {
            name: 'Ⓜ️ 微软服务',
            type: 'select',
            proxies: ['🎯 全球直连', '🚀 节点选择', 'DIRECT'],
        },
        {
            name: '🎮 游戏平台',
            type: 'select',
            proxies: ['🎯 全球直连', '🚀 节点选择', 'DIRECT'],
        },
        {
            name: '🌏 国内媒体',
            type: 'select',
            proxies: ['🎯 全球直连', '🚀 节点选择', 'DIRECT'],
        },
        {
            name: '🎯 全球直连',
            type: 'select',
            proxies: ['DIRECT', '🚀 节点选择'],
        },
        { name: '🛑 广告拦截', type: 'select', proxies: ['REJECT', 'DIRECT'] },
        {
            name: '🐟 漏网之鱼',
            type: 'select',
            proxies: ['🚀 节点选择', '🎯 全球直连', 'DIRECT'],
        },
    );

    const RULE_SETS = [
        ['private-domain', '🎯 全球直连'],
        ['private-ip', '🎯 全球直连', 'no-resolve'],
        ['ads', '🛑 广告拦截'],
        ['telegram', '📲 电报消息'],
        ['netflix', '🎥 奈飞视频'],
        ['disney', '🎬 迪士尼+'],
        ['youtube', '📺 油管视频'],
        ['spotify', '🎶 国外音乐'],
        ['netease', '🎵 网易云音乐'],
        ['bilibili', '📺 哔哩哔哩'],
        ['openai', '🤖 OpenAI'],
        ['github', '🐙 GitHub'],
        ['apple', '🍎 苹果服务'],
        ['microsoft', 'Ⓜ️ 微软服务'],
        ['games', '🎮 游戏平台'],
        ['media-cn', '🌏 国内媒体'],
        ['cn-domain', '🎯 全球直连'],
        ['cn-ip', '🎯 全球直连', 'no-resolve'],
    ];

    const rules = [
        ...RULE_SETS.map(([name, policy, ...extra]) =>
            [`RULE-SET,${name},${policy}`, ...extra].join(','),
        ),
        'MATCH,🐟 漏网之鱼',
    ];

    const ruleProviders = Object.fromEntries(
        Object.entries(CLASH_RULE_PROVIDERS).map(([name, provider]) => [
            name,
            {
                type: 'http',
                behavior: provider.behavior,
                format: 'yaml',
                url: provider.url,
                path: `./ruleset/${name}.yaml`,
                interval: 86400,
            },
        ]),
    );

    const config = {
        'mixed-port': 7890,
        'allow-lan': false,
        mode: 'rule',
        'log-level': 'info',
        ipv6: false,
        'unified-delay': true,
        'tcp-concurrent': true,
        'find-process-mode': 'strict',
        'global-client-fingerprint': 'chrome',
        profile: {
            'store-selected': true,
            'store-fake-ip': true,
        },
        dns: {
            enable: true,
            ipv6: false,
            'use-hosts': true,
            'enhanced-mode': 'fake-ip',
            'fake-ip-range': '198.18.0.1/16',
            'default-nameserver': ['223.5.5.5', '119.29.29.29'],
            // 关键：fake-ip 模式下必须用真实 DNS 解析代理服务器域名，
            // 否则节点域名会被解析成 198.18.x.x，表现为所有节点超时
            'proxy-server-nameserver': ['223.5.5.5', '119.29.29.29'],
            nameserver: [
                'https://doh.pub/dns-query',
                'https://dns.alidns.com/dns-query',
            ],
            fallback: ['https://1.1.1.1/dns-query', 'https://dns.google/dns-query'],
            'fallback-filter': { geoip: true, 'geoip-code': 'CN' },
        },
        proxies,
        'proxy-groups': proxyGroups,
        'rule-providers': ruleProviders,
        rules,
    };

    return YAML.stringify(config, { lineWidth: 0 });
}

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

    // Sub-Store 的 QX producer 会把部分参数（如 reality-*）追加在 tag 之后，
    // 而 QX 要求 tag 放在参数末尾。这里把 tag 摘出来，统一挪到最后，
    // 同时避免把 reality 参数误当成节点名。
    const nodes = lines.map((line) => {
        const match = /,tag=(.*?)(?=,[a-zA-Z0-9-]+=|$)/.exec(line);
        if (!match) return { line, name: null };
        const name = match[1];
        const rest =
            line.slice(0, match.index) + line.slice(match.index + match[0].length);
        return { line: `${rest},tag=${name}`, name };
    });

    const named = nodes.filter((node) => node.name);
    const { groups, others } = groupByRegion(
        named.map((node) => ({ name: node.name })),
    );
    const allNames = named.map((node) => node.name);
    const regionNames = groups.map((group) => group.name);
    const nodeTargets = ['♻️ 自动选择', ...regionNames, 'direct'];

    const buildStatic = (name, policies) =>
        `static=${name}, ${policies.join(', ')}`;

    const policy = [
        buildStatic('🚀 节点选择', [
            '♻️ 自动选择',
            ...regionNames,
            ...(others.length > 0 ? ['🌐 其他节点'] : []),
            'direct',
        ]),
    ];

    if (allNames.length > 0) {
        policy.push(
            `url-latency-benchmark=♻️ 自动选择, ${allNames.join(
                ', ',
            )}, check-interval=600, tolerance=100`,
        );
    }

    for (const group of groups) {
        policy.push(buildStatic(group.name, [...group.proxies, 'direct']));
    }
    if (others.length > 0) {
        policy.push(buildStatic('🌐 其他节点', [...others, 'direct']));
    }

    const proxyFirst = ['🚀 节点选择', ...nodeTargets];
    const directFirst = ['🎯 全球直连', '🚀 节点选择', 'direct'];
    const biliFirst = [
        '🎯 全球直连',
        ...regionNames.filter((name) => ['🇭🇰 香港', '🇹🇼 台湾'].includes(name)),
        '🚀 节点选择',
        'direct',
    ];

    policy.push(
        buildStatic('📲 电报消息', proxyFirst),
        buildStatic('🎥 奈飞视频', proxyFirst),
        buildStatic('🎬 迪士尼+', proxyFirst),
        buildStatic('📺 油管视频', proxyFirst),
        buildStatic('🎶 国外音乐', proxyFirst),
        buildStatic('🎵 网易云音乐', directFirst),
        buildStatic('📺 哔哩哔哩', biliFirst),
        buildStatic('🤖 OpenAI', proxyFirst),
        buildStatic('🐙 GitHub', proxyFirst),
        buildStatic('🍎 苹果服务', directFirst),
        buildStatic('Ⓜ️ 微软服务', directFirst),
        buildStatic('🎮 游戏平台', directFirst),
        buildStatic('🌏 国内媒体', directFirst),
        buildStatic('🎯 全球直连', ['direct', '🚀 节点选择']),
        buildStatic('🛑 广告拦截', ['reject', 'direct']),
        buildStatic('🐟 漏网之鱼', ['🚀 节点选择', '🎯 全球直连', 'direct']),
    );

    // QX 的 filter_remote：规则由客户端自动拉取，force-policy 指向上面的策略组
    const FILTER_REMOTE = [
        ['AdvertisingLite', '🛑 广告拦截'],
        ['Lan', '🎯 全球直连'],
        ['Telegram', '📲 电报消息'],
        ['Netflix', '🎥 奈飞视频'],
        ['Disney', '🎬 迪士尼+'],
        ['YouTube', '📺 油管视频'],
        ['Spotify', '🎶 国外音乐'],
        ['NetEaseMusic', '🎵 网易云音乐'],
        ['BiliBili', '📺 哔哩哔哩'],
        ['OpenAI', '🤖 OpenAI'],
        ['GitHub', '🐙 GitHub'],
        ['Apple', '🍎 苹果服务'],
        ['Microsoft', 'Ⓜ️ 微软服务'],
        ['Game', '🎮 游戏平台'],
        ['China', '🎯 全球直连'],
    ].map(
        ([name, policyName]) =>
            `${QX_RULE(name)}, tag=${name}, force-policy=${policyName}, enabled=true, update-interval=86400`,
    );

    const filterLocal = [
        'host-suffix, local, direct',
        'host-suffix, localdomain, direct',
        'ip-cidr, 10.0.0.0/8, direct',
        'ip-cidr, 172.16.0.0/12, direct',
        'ip-cidr, 192.168.0.0/16, direct',
        'ip-cidr, 127.0.0.0/8, direct',
        'geoip, cn, 🎯 全球直连',
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
        ...FILTER_REMOTE,
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
 * @param {string} platform
 * @returns {'clash'|'qx'}
 */
export function pickClientFromPlatform(platform) {
    const value = `${platform || ''}`.toUpperCase();
    return value === 'QX' || value.includes('QUANTUMULT') ? 'qx' : 'clash';
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
 * 匹配分享 token 路由。
 *
 * @param {string} pathname
 * @returns {{ type: 'sub'|'col', name: string }|null}
 */
export function matchShareConfigRoute(pathname) {
    const match = SHARE_CONFIG_ROUTE.exec(pathname);
    if (!match) return null;
    return {
        type: /** @type {'sub'|'col'} */ (match[1]),
        name: decodeURIComponent(match[2]),
    };
}

/**
 * 判断请求是否命中配置渲染路由（密码前缀或分享 token）。
 *
 * @param {string} pathname
 * @returns {boolean}
 */
export function isConfigRequest(pathname) {
    return CONFIG_ROUTE.test(pathname) || SHARE_CONFIG_ROUTE.test(pathname);
}
