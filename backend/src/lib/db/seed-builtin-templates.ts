import type { Database } from "bun:sqlite";

import type { RuleItem, TemplatePayloadV2 } from "../build-config/types";
import {
  catalogIdForSlug,
  loadBuiltinRulesetContent,
  loadBuiltinRulesetManifest,
  sha256Hex
} from "./seed-ruleset-catalog";

// 官方「推荐方案」模板 seed（技术方案 §13）。
// 约束：只引用内置规则源（离线快照随仓库分发），保证黄金路径全离线可用。
// 原则：不默认清洗节点名——transforms 留空，由用户主动开启。

export const OFFICIAL_USER_ID = "user_official";
export const RECOMMENDED_TEMPLATE_ID = "tpl_recommended";
export const RECOMMENDED_TEMPLATE_SLUG = "recommended";

const snapshotItem = (
  hashBySlug: Map<string, string>,
  slug: string,
  emit: "provider" | "inline"
): RuleItem | null => {
  const hash = hashBySlug.get(slug);
  if (!hash) return null;
  return { kind: "snapshot", catalogId: catalogIdForSlug(slug), slug, hash, emit };
};

export const buildRecommendedTemplatePayload = (): TemplatePayloadV2 | null => {
  const manifest = loadBuiltinRulesetManifest();
  const hashBySlug = new Map<string, string>();
  for (const entry of manifest) {
    const content = loadBuiltinRulesetContent(entry);
    if (content !== null) {
      hashBySlug.set(entry.slug, sha256Hex(content));
    }
  }
  if (hashBySlug.size === 0) {
    return null;
  }

  const items = (slugs: Array<[string, "provider" | "inline"]>): RuleItem[] =>
    slugs
      .map(([slug, emit]) => snapshotItem(hashBySlug, slug, emit))
      .filter((item): item is RuleItem => item !== null);

  return {
    version: 1,
    mode: "rebuild",
    nodes: {
      transforms: [],
      custom: []
    },
    groups: {
      generators: [
        { kind: "proxies-root", name: "Proxies", includeAuto: true, extraMembers: [] },
        { kind: "region-groups", groupType: "select", unclassified: "others" }
      ],
      custom: [
        {
          name: "AI",
          type: "select",
          members: [
            { kind: "group", name: "Proxies" },
            { kind: "group", name: "Auto" },
            { kind: "builtin", policy: "DIRECT" }
          ]
        },
        {
          name: "Streaming",
          type: "select",
          members: [
            { kind: "group", name: "Proxies" },
            { kind: "group", name: "Auto" },
            { kind: "builtin", policy: "DIRECT" }
          ]
        }
      ],
      order: ["Proxies", "AI", "Streaming"]
    },
    rules: {
      targets: [
        { target: "REJECT", items: items([["reject-ads", "provider"]]) },
        {
          target: "AI",
          items: items([
            ["geosite-openai", "provider"],
            ["geosite-anthropic", "provider"]
          ])
        },
        {
          target: "Streaming",
          items: items([
            ["geosite-netflix", "provider"],
            ["geosite-youtube", "provider"]
          ])
        },
        {
          target: "Proxies",
          items: items([
            ["geosite-telegram", "provider"],
            ["gfw-proxy", "provider"]
          ])
        },
        {
          target: "DIRECT",
          items: items([
            ["private", "inline"],
            ["geosite-cn", "provider"],
            ["cn-cidr", "provider"]
          ])
        }
      ],
      order: ["REJECT", "AI", "Streaming", "Proxies", "DIRECT"],
      prelude: [],
      final: { target: "Proxies" }
    },
    config: {
      structured: {
        ports: { mixedPort: 7890 },
        mode: "rule",
        logLevel: "info",
        dns: {
          enable: true,
          ipv6: false,
          "enhanced-mode": "fake-ip",
          "fake-ip-range": "198.18.0.1/16",
          "fake-ip-filter": ["*.lan", "*.local"],
          nameserver: ["https://223.5.5.5/dns-query", "https://doh.pub/dns-query"]
        },
        sniffer: {
          enable: true,
          sniff: {
            HTTP: { ports: [80, 8080] },
            TLS: { ports: [443, 8443] }
          }
        }
      },
      rawPatch: null
    }
  };
};

export const seedBuiltinTemplates = (db: Database): number => {
  const payload = buildRecommendedTemplatePayload();
  if (!payload) {
    return 0;
  }

  const now = new Date().toISOString();

  db.query(`
    INSERT OR IGNORE INTO users (id, email, username, display_name, locale, status, is_admin, created_at, updated_at)
    VALUES (?, 'official@proxyparser.local', 'proxyparser', 'ProxyParser 官方', 'zh-CN', 'disabled', 0, ?, ?)
  `).run(OFFICIAL_USER_ID, now, now);

  db.query(`
    INSERT OR IGNORE INTO templates (id, owner_user_id, display_name, slug, description, visibility, is_official, latest_version_id, created_at, updated_at)
    VALUES (?, ?, '推荐方案', ?, '官方维护的起手配置：自动地区分组 + Auto 测速组，AI / 流媒体 / 广告拦截 / 国内直连分流，合理的 DNS 与嗅探设置。', 'public', 1, NULL, ?, ?)
  `).run(RECOMMENDED_TEMPLATE_ID, OFFICIAL_USER_ID, RECOMMENDED_TEMPLATE_SLUG, now, now);

  const payloadJson = JSON.stringify(payload);
  const existing = db
    .query<{ id: string; payload_json: string }>(
      `SELECT tv.id, tv.payload_json FROM template_versions tv
       JOIN templates t ON t.latest_version_id = tv.id
       WHERE t.id = ?`
    )
    .get(RECOMMENDED_TEMPLATE_ID);

  if (existing && existing.payload_json === payloadJson) {
    return 0;
  }

  const nextVersion =
    (db
      .query<{ max_version: number | null }>(
        "SELECT MAX(version) AS max_version FROM template_versions WHERE template_id = ?"
      )
      .get(RECOMMENDED_TEMPLATE_ID)?.max_version ?? 0) + 1;
  const versionId = `tplv_recommended_${nextVersion}`;

  db.query(`
    INSERT INTO template_versions (id, template_id, version, version_note, payload_json, extraction_report, created_at)
    VALUES (?, ?, ?, '官方推荐方案', ?, NULL, ?)
  `).run(versionId, RECOMMENDED_TEMPLATE_ID, nextVersion, payloadJson, now);

  db.query("UPDATE templates SET latest_version_id = ?, updated_at = ? WHERE id = ?").run(
    versionId,
    now,
    RECOMMENDED_TEMPLATE_ID
  );

  return 1;
};
