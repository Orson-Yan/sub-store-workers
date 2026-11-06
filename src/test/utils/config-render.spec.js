import { expect } from 'chai';
import { describe, it } from 'mocha';
import YAML from 'yaml';

import {
    classifyRegion,
    groupByRegion,
    matchConfigRoute,
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

        it('rejects unrelated paths and extra segments', function () {
            expect(matchConfigRoute('/secret/cfg/clash')).to.equal(null);
            expect(matchConfigRoute('/secret/cfg/v2ray/main')).to.equal(null);
            expect(matchConfigRoute('/secret/cfg/clash/a/b')).to.equal(null);
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
