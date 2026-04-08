import type { Database } from "bun:sqlite";

interface BuiltinRulesetCatalogEntry {
  id: string;
  slug: string;
  name: string;
  description: string;
  sourceType: "http_file";
  sourceUrl: string;
  sourceRepo: string;
  metadata: Record<string, unknown>;
}

interface BuiltinRulesetFactoryInput {
  family: "loyalsoldier" | "metacubex" | "blackmatrix7" | "acl4ssr";
  key: string;
  name: string;
  description: string;
  sourceUrl: string;
  sourceRepo: string;
  kind: "rule_provider" | "geosite" | "geoip";
  behavior?: "domain" | "ipcidr" | "classical";
  recommended?: boolean;
  upstreamBranch?: string;
  upstreamPath?: string;
}

const createBuiltinRulesetEntry = (
  input: BuiltinRulesetFactoryInput
): BuiltinRulesetCatalogEntry => {
  return {
    id: `ruleset_builtin_${input.family}_${input.key}`,
    slug: `${input.family}-${input.key}`.toLowerCase(),
    name: input.name,
    description: input.description,
    sourceType: "http_file",
    sourceUrl: input.sourceUrl,
    sourceRepo: input.sourceRepo,
    metadata: {
      category: "builtin_ruleset",
      sourceFamily: input.family,
      kind: input.kind,
      behavior: input.behavior ?? null,
      format: "yaml",
      parser: "yaml_payload_or_lines",
      recommended: input.recommended ?? false,
      updateIntervalSeconds: 24 * 60 * 60,
      upstreamBranch: input.upstreamBranch ?? null,
      upstreamPath: input.upstreamPath ?? null
    }
  };
};

const BUILTIN_RULESET_CATALOG: BuiltinRulesetCatalogEntry[] = [
  createBuiltinRulesetEntry({
    family: "loyalsoldier",
    key: "direct",
    name: "Loyalsoldier Direct",
    description: "常见直连域名规则，适合作为基础直连 rule-provider。",
    sourceUrl: "https://raw.githubusercontent.com/Loyalsoldier/clash-rules/release/direct.txt",
    sourceRepo: "Loyalsoldier/clash-rules",
    kind: "rule_provider",
    behavior: "domain",
    recommended: true,
    upstreamBranch: "release",
    upstreamPath: "direct.txt"
  }),
  createBuiltinRulesetEntry({
    family: "loyalsoldier",
    key: "proxy",
    name: "Loyalsoldier Proxy",
    description: "通用代理域名规则，适合作为默认代理目标集合。",
    sourceUrl: "https://raw.githubusercontent.com/Loyalsoldier/clash-rules/release/proxy.txt",
    sourceRepo: "Loyalsoldier/clash-rules",
    kind: "rule_provider",
    behavior: "domain",
    recommended: true,
    upstreamBranch: "release",
    upstreamPath: "proxy.txt"
  }),
  createBuiltinRulesetEntry({
    family: "loyalsoldier",
    key: "reject",
    name: "Loyalsoldier Reject",
    description: "广告与常见拦截域名规则，适合默认 REJECT 组。",
    sourceUrl: "https://raw.githubusercontent.com/Loyalsoldier/clash-rules/release/reject.txt",
    sourceRepo: "Loyalsoldier/clash-rules",
    kind: "rule_provider",
    behavior: "domain",
    recommended: true,
    upstreamBranch: "release",
    upstreamPath: "reject.txt"
  }),
  createBuiltinRulesetEntry({
    family: "loyalsoldier",
    key: "private",
    name: "Loyalsoldier Private",
    description: "私网和保留地址相关规则，适合作为局域网直连集合。",
    sourceUrl: "https://raw.githubusercontent.com/Loyalsoldier/clash-rules/release/private.txt",
    sourceRepo: "Loyalsoldier/clash-rules",
    kind: "rule_provider",
    behavior: "domain",
    upstreamBranch: "release",
    upstreamPath: "private.txt"
  }),
  createBuiltinRulesetEntry({
    family: "loyalsoldier",
    key: "apple",
    name: "Loyalsoldier Apple",
    description: "Apple 域名规则集合，可用于 Apple 专属策略。",
    sourceUrl: "https://raw.githubusercontent.com/Loyalsoldier/clash-rules/release/apple.txt",
    sourceRepo: "Loyalsoldier/clash-rules",
    kind: "rule_provider",
    behavior: "domain",
    upstreamBranch: "release",
    upstreamPath: "apple.txt"
  }),
  createBuiltinRulesetEntry({
    family: "loyalsoldier",
    key: "google",
    name: "Loyalsoldier Google",
    description: "Google 域名规则集合，可作为代理或直连参考。",
    sourceUrl: "https://raw.githubusercontent.com/Loyalsoldier/clash-rules/release/google.txt",
    sourceRepo: "Loyalsoldier/clash-rules",
    kind: "rule_provider",
    behavior: "domain",
    upstreamBranch: "release",
    upstreamPath: "google.txt"
  }),
  createBuiltinRulesetEntry({
    family: "loyalsoldier",
    key: "telegramcidr",
    name: "Loyalsoldier Telegram CIDR",
    description: "Telegram IP 规则集合，适合作为 IP-CIDR 规则源。",
    sourceUrl:
      "https://raw.githubusercontent.com/Loyalsoldier/clash-rules/release/telegramcidr.txt",
    sourceRepo: "Loyalsoldier/clash-rules",
    kind: "rule_provider",
    behavior: "ipcidr",
    upstreamBranch: "release",
    upstreamPath: "telegramcidr.txt"
  }),
  createBuiltinRulesetEntry({
    family: "loyalsoldier",
    key: "cncidr",
    name: "Loyalsoldier CN CIDR",
    description: "中国大陆 IP 范围规则集合，适合作为直连策略。",
    sourceUrl: "https://raw.githubusercontent.com/Loyalsoldier/clash-rules/release/cncidr.txt",
    sourceRepo: "Loyalsoldier/clash-rules",
    kind: "rule_provider",
    behavior: "ipcidr",
    upstreamBranch: "release",
    upstreamPath: "cncidr.txt"
  }),
  createBuiltinRulesetEntry({
    family: "loyalsoldier",
    key: "applications",
    name: "Loyalsoldier Applications",
    description: "常见应用规则集合，适合用作 classical 规则源。",
    sourceUrl:
      "https://raw.githubusercontent.com/Loyalsoldier/clash-rules/release/applications.txt",
    sourceRepo: "Loyalsoldier/clash-rules",
    kind: "rule_provider",
    behavior: "classical",
    upstreamBranch: "release",
    upstreamPath: "applications.txt"
  }),
  createBuiltinRulesetEntry({
    family: "metacubex",
    key: "geosite-cn",
    name: "MetaCubeX Geosite CN",
    description: "基于 meta-rules-dat 的 geosite:cn 集合，可直接用于 Mihomo 规则。",
    sourceUrl: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/cn.yaml",
    sourceRepo: "MetaCubeX/meta-rules-dat",
    kind: "geosite",
    behavior: "domain",
    recommended: true,
    upstreamBranch: "meta",
    upstreamPath: "geo/geosite/cn.yaml"
  }),
  createBuiltinRulesetEntry({
    family: "metacubex",
    key: "geosite-ads",
    name: "MetaCubeX Geosite Ads",
    description: "广告域名 geosite 集合，可用于默认拦截规则。",
    sourceUrl:
      "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/category-ads-all.yaml",
    sourceRepo: "MetaCubeX/meta-rules-dat",
    kind: "geosite",
    behavior: "domain",
    recommended: true,
    upstreamBranch: "meta",
    upstreamPath: "geo/geosite/category-ads-all.yaml"
  }),
  createBuiltinRulesetEntry({
    family: "metacubex",
    key: "geosite-google",
    name: "MetaCubeX Geosite Google",
    description: "Google 相关 geosite 集合。",
    sourceUrl:
      "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/google.yaml",
    sourceRepo: "MetaCubeX/meta-rules-dat",
    kind: "geosite",
    behavior: "domain",
    upstreamBranch: "meta",
    upstreamPath: "geo/geosite/google.yaml"
  }),
  createBuiltinRulesetEntry({
    family: "metacubex",
    key: "geosite-github",
    name: "MetaCubeX Geosite GitHub",
    description: "GitHub 相关 geosite 集合。",
    sourceUrl:
      "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/github.yaml",
    sourceRepo: "MetaCubeX/meta-rules-dat",
    kind: "geosite",
    behavior: "domain",
    upstreamBranch: "meta",
    upstreamPath: "geo/geosite/github.yaml"
  }),
  createBuiltinRulesetEntry({
    family: "metacubex",
    key: "geosite-microsoft",
    name: "MetaCubeX Geosite Microsoft",
    description: "Microsoft 相关 geosite 集合。",
    sourceUrl:
      "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/microsoft.yaml",
    sourceRepo: "MetaCubeX/meta-rules-dat",
    kind: "geosite",
    behavior: "domain",
    upstreamBranch: "meta",
    upstreamPath: "geo/geosite/microsoft.yaml"
  }),
  createBuiltinRulesetEntry({
    family: "metacubex",
    key: "geosite-netflix",
    name: "MetaCubeX Geosite Netflix",
    description: "Netflix 相关 geosite 集合。",
    sourceUrl:
      "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/netflix.yaml",
    sourceRepo: "MetaCubeX/meta-rules-dat",
    kind: "geosite",
    behavior: "domain",
    upstreamBranch: "meta",
    upstreamPath: "geo/geosite/netflix.yaml"
  }),
  createBuiltinRulesetEntry({
    family: "metacubex",
    key: "geosite-openai",
    name: "MetaCubeX Geosite OpenAI",
    description: "OpenAI 相关 geosite 集合，适合作为 AI 专属策略。",
    sourceUrl:
      "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/openai.yaml",
    sourceRepo: "MetaCubeX/meta-rules-dat",
    kind: "geosite",
    behavior: "domain",
    recommended: true,
    upstreamBranch: "meta",
    upstreamPath: "geo/geosite/openai.yaml"
  }),
  createBuiltinRulesetEntry({
    family: "metacubex",
    key: "geosite-telegram",
    name: "MetaCubeX Geosite Telegram",
    description: "Telegram 相关 geosite 集合。",
    sourceUrl:
      "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/telegram.yaml",
    sourceRepo: "MetaCubeX/meta-rules-dat",
    kind: "geosite",
    behavior: "domain",
    upstreamBranch: "meta",
    upstreamPath: "geo/geosite/telegram.yaml"
  }),
  createBuiltinRulesetEntry({
    family: "metacubex",
    key: "geosite-youtube",
    name: "MetaCubeX Geosite YouTube",
    description: "YouTube 相关 geosite 集合。",
    sourceUrl:
      "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/youtube.yaml",
    sourceRepo: "MetaCubeX/meta-rules-dat",
    kind: "geosite",
    behavior: "domain",
    upstreamBranch: "meta",
    upstreamPath: "geo/geosite/youtube.yaml"
  }),
  createBuiltinRulesetEntry({
    family: "metacubex",
    key: "geoip-cn",
    name: "MetaCubeX GeoIP CN",
    description: "中国大陆 GeoIP 集合，可作为 GEOIP 规则参考。",
    sourceUrl: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geoip/cn.yaml",
    sourceRepo: "MetaCubeX/meta-rules-dat",
    kind: "geoip",
    behavior: "ipcidr",
    upstreamBranch: "meta",
    upstreamPath: "geo/geoip/cn.yaml"
  }),
  createBuiltinRulesetEntry({
    family: "metacubex",
    key: "geoip-telegram",
    name: "MetaCubeX GeoIP Telegram",
    description: "Telegram 相关 GeoIP 集合。",
    sourceUrl:
      "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geoip/telegram.yaml",
    sourceRepo: "MetaCubeX/meta-rules-dat",
    kind: "geoip",
    behavior: "ipcidr",
    upstreamBranch: "meta",
    upstreamPath: "geo/geoip/telegram.yaml"
  }),
  createBuiltinRulesetEntry({
    family: "blackmatrix7",
    key: "openai",
    name: "blackmatrix7 OpenAI",
    description: "OpenAI 规则集合，覆盖域名与部分 IP 规则。",
    sourceUrl:
      "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Clash/OpenAI/OpenAI.yaml",
    sourceRepo: "blackmatrix7/ios_rule_script",
    kind: "rule_provider",
    behavior: "classical",
    recommended: true,
    upstreamBranch: "master",
    upstreamPath: "rule/Clash/OpenAI/OpenAI.yaml"
  }),
  createBuiltinRulesetEntry({
    family: "blackmatrix7",
    key: "netflix",
    name: "blackmatrix7 Netflix",
    description: "Netflix 规则集合，适合流媒体模板。",
    sourceUrl:
      "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Clash/Netflix/Netflix.yaml",
    sourceRepo: "blackmatrix7/ios_rule_script",
    kind: "rule_provider",
    behavior: "classical",
    upstreamBranch: "master",
    upstreamPath: "rule/Clash/Netflix/Netflix.yaml"
  }),
  createBuiltinRulesetEntry({
    family: "blackmatrix7",
    key: "telegram",
    name: "blackmatrix7 Telegram",
    description: "Telegram 规则集合。",
    sourceUrl:
      "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Clash/Telegram/Telegram.yaml",
    sourceRepo: "blackmatrix7/ios_rule_script",
    kind: "rule_provider",
    behavior: "classical",
    upstreamBranch: "master",
    upstreamPath: "rule/Clash/Telegram/Telegram.yaml"
  }),
  createBuiltinRulesetEntry({
    family: "blackmatrix7",
    key: "youtube",
    name: "blackmatrix7 YouTube",
    description: "YouTube 规则集合。",
    sourceUrl:
      "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Clash/YouTube/YouTube.yaml",
    sourceRepo: "blackmatrix7/ios_rule_script",
    kind: "rule_provider",
    behavior: "classical",
    upstreamBranch: "master",
    upstreamPath: "rule/Clash/YouTube/YouTube.yaml"
  }),
  createBuiltinRulesetEntry({
    family: "blackmatrix7",
    key: "google",
    name: "blackmatrix7 Google",
    description: "Google 规则集合。",
    sourceUrl:
      "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Clash/Google/Google.yaml",
    sourceRepo: "blackmatrix7/ios_rule_script",
    kind: "rule_provider",
    behavior: "classical",
    upstreamBranch: "master",
    upstreamPath: "rule/Clash/Google/Google.yaml"
  }),
  createBuiltinRulesetEntry({
    family: "blackmatrix7",
    key: "apple",
    name: "blackmatrix7 Apple",
    description: "Apple 规则集合。",
    sourceUrl:
      "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Clash/Apple/Apple.yaml",
    sourceRepo: "blackmatrix7/ios_rule_script",
    kind: "rule_provider",
    behavior: "classical",
    upstreamBranch: "master",
    upstreamPath: "rule/Clash/Apple/Apple.yaml"
  }),
  createBuiltinRulesetEntry({
    family: "blackmatrix7",
    key: "onedrive",
    name: "blackmatrix7 OneDrive",
    description: "OneDrive 规则集合。",
    sourceUrl:
      "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Clash/OneDrive/OneDrive.yaml",
    sourceRepo: "blackmatrix7/ios_rule_script",
    kind: "rule_provider",
    behavior: "classical",
    upstreamBranch: "master",
    upstreamPath: "rule/Clash/OneDrive/OneDrive.yaml"
  }),
  createBuiltinRulesetEntry({
    family: "blackmatrix7",
    key: "chinamax",
    name: "blackmatrix7 ChinaMax",
    description: "较完整的中国大陆规则集合，适合作为直连模板参考。",
    sourceUrl:
      "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Clash/ChinaMax/ChinaMax.yaml",
    sourceRepo: "blackmatrix7/ios_rule_script",
    kind: "rule_provider",
    behavior: "classical",
    upstreamBranch: "master",
    upstreamPath: "rule/Clash/ChinaMax/ChinaMax.yaml"
  }),
  createBuiltinRulesetEntry({
    family: "acl4ssr",
    key: "banad",
    name: "ACL4SSR BanAD",
    description: "常见广告关键字规则碎片，适合作为默认广告拦截规则。",
    sourceUrl:
      "https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Providers/BanAD.yaml",
    sourceRepo: "ACL4SSR/ACL4SSR",
    kind: "rule_provider",
    behavior: "classical",
    recommended: true,
    upstreamBranch: "master",
    upstreamPath: "Clash/Providers/BanAD.yaml"
  }),
  createBuiltinRulesetEntry({
    family: "acl4ssr",
    key: "banprogramad",
    name: "ACL4SSR BanProgramAD",
    description: "应用级广告与统计规则碎片。",
    sourceUrl:
      "https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Providers/BanProgramAD.yaml",
    sourceRepo: "ACL4SSR/ACL4SSR",
    kind: "rule_provider",
    behavior: "classical",
    upstreamBranch: "master",
    upstreamPath: "Clash/Providers/BanProgramAD.yaml"
  }),
  createBuiltinRulesetEntry({
    family: "acl4ssr",
    key: "localareanetwork",
    name: "ACL4SSR LocalAreaNetwork",
    description: "局域网与本地资源规则碎片。",
    sourceUrl:
      "https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Providers/LocalAreaNetwork.yaml",
    sourceRepo: "ACL4SSR/ACL4SSR",
    kind: "rule_provider",
    behavior: "classical",
    upstreamBranch: "master",
    upstreamPath: "Clash/Providers/LocalAreaNetwork.yaml"
  }),
  createBuiltinRulesetEntry({
    family: "acl4ssr",
    key: "chinadomain",
    name: "ACL4SSR ChinaDomain",
    description: "中国大陆常见域名规则碎片。",
    sourceUrl:
      "https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Providers/ChinaDomain.yaml",
    sourceRepo: "ACL4SSR/ACL4SSR",
    kind: "rule_provider",
    behavior: "classical",
    upstreamBranch: "master",
    upstreamPath: "Clash/Providers/ChinaDomain.yaml"
  }),
  createBuiltinRulesetEntry({
    family: "acl4ssr",
    key: "chinaip",
    name: "ACL4SSR ChinaIP",
    description: "中国大陆 IP 规则碎片。",
    sourceUrl:
      "https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Providers/ChinaIp.yaml",
    sourceRepo: "ACL4SSR/ACL4SSR",
    kind: "rule_provider",
    behavior: "classical",
    upstreamBranch: "master",
    upstreamPath: "Clash/Providers/ChinaIp.yaml"
  }),
  createBuiltinRulesetEntry({
    family: "acl4ssr",
    key: "apple",
    name: "ACL4SSR Apple",
    description: "Apple 规则碎片。",
    sourceUrl:
      "https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Providers/Apple.yaml",
    sourceRepo: "ACL4SSR/ACL4SSR",
    kind: "rule_provider",
    behavior: "classical",
    upstreamBranch: "master",
    upstreamPath: "Clash/Providers/Apple.yaml"
  }),
  createBuiltinRulesetEntry({
    family: "acl4ssr",
    key: "download",
    name: "ACL4SSR Download",
    description: "下载域名规则碎片，适合作为大文件下载直连策略参考。",
    sourceUrl:
      "https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Providers/Download.yaml",
    sourceRepo: "ACL4SSR/ACL4SSR",
    kind: "rule_provider",
    behavior: "classical",
    upstreamBranch: "master",
    upstreamPath: "Clash/Providers/Download.yaml"
  }),
  createBuiltinRulesetEntry({
    family: "acl4ssr",
    key: "proxymedia",
    name: "ACL4SSR ProxyMedia",
    description: "代理流媒体规则碎片。",
    sourceUrl:
      "https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Providers/ProxyMedia.yaml",
    sourceRepo: "ACL4SSR/ACL4SSR",
    kind: "rule_provider",
    behavior: "classical",
    upstreamBranch: "master",
    upstreamPath: "Clash/Providers/ProxyMedia.yaml"
  }),
  createBuiltinRulesetEntry({
    family: "acl4ssr",
    key: "unban",
    name: "ACL4SSR UnBan",
    description: "解锁与常见代理规则碎片。",
    sourceUrl:
      "https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Providers/UnBan.yaml",
    sourceRepo: "ACL4SSR/ACL4SSR",
    kind: "rule_provider",
    behavior: "classical",
    upstreamBranch: "master",
    upstreamPath: "Clash/Providers/UnBan.yaml"
  }),
  createBuiltinRulesetEntry({
    family: "acl4ssr",
    key: "proxylite",
    name: "ACL4SSR ProxyLite",
    description: "精简代理规则碎片，可作为黑名单模式的代理集合。",
    sourceUrl:
      "https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Providers/ProxyLite.yaml",
    sourceRepo: "ACL4SSR/ACL4SSR",
    kind: "rule_provider",
    behavior: "classical",
    recommended: true,
    upstreamBranch: "master",
    upstreamPath: "Clash/Providers/ProxyLite.yaml"
  })
];

const LEGACY_REPOSITORY_PLACEHOLDER_SLUGS = [
  "loyalsoldier-clash-rules",
  "metacubex-meta-rules-dat",
  "blackmatrix7-ios-rule-script",
  "acl4ssr",
  "acl4ssr-microsoft",
  "acl4ssr-netflix",
  "acl4ssr-telegram"
];

export const seedBuiltinRulesetCatalog = (db: Database) => {
  const now = new Date().toISOString();

  const archiveLegacyPlaceholders = db.query(`
    UPDATE ruleset_catalog
    SET status = 'archived', updated_at = ?
    WHERE slug = ?
  `);

  const upsertEntry = db.query(`
    INSERT INTO ruleset_catalog (
      id,
      slug,
      name,
      description,
      source_type,
      source_url,
      source_repo,
      visibility,
      is_official,
      status,
      metadata_json,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      source_type = excluded.source_type,
      source_url = excluded.source_url,
      source_repo = excluded.source_repo,
      visibility = excluded.visibility,
      is_official = excluded.is_official,
      status = excluded.status,
      metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at
  `);

  for (const legacySlug of LEGACY_REPOSITORY_PLACEHOLDER_SLUGS) {
    archiveLegacyPlaceholders.run(now, legacySlug);
  }

  for (const entry of BUILTIN_RULESET_CATALOG) {
    upsertEntry.run(
      entry.id,
      entry.slug,
      entry.name,
      entry.description,
      entry.sourceType,
      entry.sourceUrl,
      entry.sourceRepo,
      "public",
      1,
      "active",
      JSON.stringify(entry.metadata),
      now,
      now
    );
  }

  return BUILTIN_RULESET_CATALOG.length;
};
