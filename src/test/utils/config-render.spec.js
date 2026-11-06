import { expect } from 'chai';
import { describe, it } from 'mocha';
import YAML from 'yaml';

import {
    classifyRegion,
    groupByRegion,
    matchConfigRoute,
    matchShareConfigRoute,
    pickClientFromPlatform,
    buildClashConfig,
    buildQxConfig,
} from '@/utils/config-templates';

describe('config render', function () {
    describe('classifyRegion', function () {
        it('matches flag emoji and Chinese names', function () {
            expect(classifyRegion('🇭🇰 香港 01')).to.equal('🇭🇰 香港');
            expect(classifyRegion('日本 大阪 IEPL')).to.equal('🇯🇵 日本');
            expect(classifyRegion('新加坡 02')).to.equal('🇸🇬 新加坡');
            expect(classifyRegion('美國 洛杉矶')).to.equal('🇺🇸 美国');
        });

        it('matches ASCII codes only as standalone tokens', function () {
            expect(classifyRegion('HK-01')).to.equal('🇭🇰 香港');
            expect(classifyRegion('node-jp-1')).to.equal('🇯🇵 日本');
            // 不应把 AUS / MSG 之类误判成 US / SG
            expect(classifyRegion('AUS node')).to.equal(null);
            expect(classifyRegion('MSG relay')).to.equal(null);
            expect(classifyRegion('Some Node')).to.equal(null);
        });
    });

    describe('groupByRegion', function () {
        it('keeps original order and buckets unmatched nodes', function () {
            const { groups, others } = groupByRegion([
                { name: '🇭🇰 香港 01' },
                { name: 'Some Node' },
                { name: '🇭🇰 香港 02' },
                { name: '日本 01' },
            ]);

            expect(groups.map((g) => g.name)).to.deep.equal(['🇭🇰 香港', '🇯🇵 日本']);
            expect(groups[0].proxies).to.deep.equal(['🇭🇰 香港 01', '🇭🇰 香港 02']);
            expect(others).to.deep.equal(['Some Node']);
        });
    });

    describe('matchConfigRoute', function () {
        it('parses the password-prefixed route', function () {
            expect(matchConfigRoute('/secret/cfg/clash/main')).to.deep.equal({
                password: 'secret',
                client: 'clash',
                name: 'main',
            });
            expect(matchConfigRoute('/secret/cfg/qx/main').client).to.equal('qx');
        });

        it('supports omitting the client segment for UA auto-detection', function () {
            expect(matchConfigRoute('/secret/cfg/main')).to.deep.equal({
                password: 'secret',
                client: null,
                name: 'main',
            });
        });

        it('rejects unrelated paths and extra segments', function () {
            // 无强制格式时，`clash` 会被当成订阅名
            expect(matchConfigRoute('/secret/cfg/clash')).to.deep.equal({
                password: 'secret',
                client: null,
                name: 'clash',
            });
            expect(matchConfigRoute('/secret/cfg/v2ray/main')).to.equal(null);
            expect(matchConfigRoute('/secret/cfg/clash/a/b')).to.equal(null);
        });
    });

    describe('matchShareConfigRoute', function () {
        it('parses share token routes', function () {
            expect(matchShareConfigRoute('/cfg/share/sub/main')).to.deep.equal({
                type: 'sub',
                name: 'main',
            });
            expect(matchShareConfigRoute('/cfg/share/col/main')).to.deep.equal({
                type: 'col',
                name: 'main',
            });
        });

        it('rejects unsupported types', function () {
            expect(matchShareConfigRoute('/cfg/share/file/main')).to.equal(null);
            expect(matchShareConfigRoute('/cfg/share/sub')).to.equal(null);
            expect(matchShareConfigRoute('/share/sub/main')).to.equal(null);
        });
    });

    describe('pickClientFromPlatform', function () {
        it('maps QX to the QX template and everything else to mihomo', function () {
            expect(pickClientFromPlatform('QX')).to.equal('qx');
            expect(pickClientFromPlatform('QuantumultX')).to.equal('qx');
            expect(pickClientFromPlatform('ClashMeta')).to.equal('clash');
            expect(pickClientFromPlatform('Surge')).to.equal('clash');
            expect(pickClientFromPlatform('')).to.equal('clash');
            expect(pickClientFromPlatform(undefined)).to.equal('clash');
        });
    });

    describe('buildClashConfig', function () {
        const proxies = [
            { name: '🇭🇰 香港 01', type: 'ss', server: '1.1.1.1', port: 443 },
            { name: '🇯🇵 日本 01', type: 'ss', server: '2.2.2.2', port: 443 },
            { name: 'Some Node', type: 'ss', server: '3.3.3.3', port: 443 },
        ];

        it('produces valid YAML with groups and rules', function () {
            const config = YAML.parse(buildClashConfig(proxies));

            expect(config.proxies).to.have.length(3);
            expect(config.mode).to.equal('rule');
            // fake-ip 下必须给代理服务器域名单独配真实 DNS，否则节点全部超时
            expect(config.dns['proxy-server-nameserver']).to.be.an('array').that.is.not.empty;
            expect(config.dns['proxy-server-nameserver']).to.include('223.5.5.5');
            expect(config.rules[config.rules.length - 1]).to.match(/^MATCH,/);

            const names = config['proxy-groups'].map((g) => g.name);
            expect(names).to.include.members([
                '🚀 节点选择',
                '♻️ 自动选择',
                '🇭🇰 香港',
                '🇯🇵 日本',
                '🌐 其他节点',
            ]);
        });

        it('only references existing proxies and groups', function () {
            const config = YAML.parse(buildClashConfig(proxies));
            const proxyNames = new Set(config.proxies.map((p) => p.name));
            const groupNames = new Set(config['proxy-groups'].map((g) => g.name));
            const builtins = new Set(['DIRECT', 'REJECT']);

            for (const group of config['proxy-groups']) {
                for (const member of group.proxies) {
                    expect(
                        proxyNames.has(member) ||
                            groupNames.has(member) ||
                            builtins.has(member),
                        `${group.name} 引用了不存在的 ${member}`,
                    ).to.equal(true);
                }
            }
        });

        it('still works when every node is unidentified', function () {
            const config = YAML.parse(
                buildClashConfig([{ name: 'A', type: 'ss', server: '1.1.1.1', port: 443 }]),
            );
            const select = config['proxy-groups'][0];
            expect(select.proxies).to.deep.equal(['♻️ 自动选择', 'DIRECT']);
        });
    });

    describe('buildQxConfig', function () {
        const serverLines = [
            'shadowsocks=1.1.1.1:443,method=aes-128-gcm,password=p,tag=🇭🇰 香港 01',
            'trojan=2.2.2.2:443,password=p,over-tls=true,tag=🇯🇵 日本 01',
            'trojan=3.3.3.3:443,password=p,over-tls=true,tag=Some Node',
        ].join('\n');

        it('emits required sections and node lines', function () {
            const config = buildQxConfig(serverLines);
            for (const section of [
                '[general]',
                '[dns]',
                '[policy]',
                '[server_local]',
                '[filter_local]',
            ]) {
                expect(config).to.include(section);
            }
            expect(config).to.include('tag=🇭🇰 香港 01');
            expect(config).to.include('static=🇭🇰 香港, 🇭🇰 香港 01, direct');
            expect(config).to.include('final, 🐟 漏网之鱼');
        });

        it('moves tag to the end when reality params follow it', function () {
            const line =
                'vless=a.com:443,method=none,password=u,obfs=over-tls,tls-host=x.com,udp-relay=true,tag=🇯🇵日本•移联01,reality-base64-pubkey=PK,reality-hex-shortid=ab12';
            const config = buildQxConfig(line);
            const serverLine = config
                .split('[server_local]')[1]
                .split('[')[0]
                .trim();

            expect(serverLine).to.match(/tag=🇯🇵日本•移联01$/);
            expect(serverLine).to.include('reality-base64-pubkey=PK');
            // 策略里不能把 reality 参数当成节点名
            expect(config).to.include('static=🇯🇵 日本, 🇯🇵日本•移联01, direct');
            expect(config).not.to.include('移联01,reality-base64-pubkey');
        });

        it('references only declared policies in filters', function () {
            const config = buildQxConfig(serverLines);
            const policySection = config.split('[policy]')[1].split('[')[0];
            const declared = new Set([
                ...policySection
                    .split('\n')
                    .filter(Boolean)
                    .map((line) => line.split('=')[1].split(',')[0].trim()),
                'direct',
                'reject',
            ]);

            const filterSection = config.split('[filter_local]')[1] || '';
            for (const line of filterSection.split('\n').filter(Boolean)) {
                const parts = line.split(',').map((part) => part.trim());
                const policy = parts[parts.length - 1];
                expect(declared.has(policy), `未声明的策略 ${policy}`).to.equal(true);
            }
        });
    });
});
