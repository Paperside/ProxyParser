import type { Database } from "bun:sqlite";

import type { CustomGroup, GroupMember, RuleItem, RuleTargetBlock, TemplatePayloadV2 } from "../build-config/types";
import { REGION_CODES } from "../render-v2/region";
import {
  catalogIdForSlug,
  loadBuiltinRulesetContent,
  loadBuiltinRulesetManifest,
  sha256Hex
} from "./seed-ruleset-catalog";

// 官方「推荐方案」模板 seed（技术方案 §13）。
// 约束：只引用内置规则源（离线快照随仓库分发），保证黄金路径全离线可用。
// 原则：不默认清洗节点名——transforms 留空，由用户主动开启。
//
// 规则组 = 同名策略组：manifest 里 groupKind 为 proxy-first/direct-first 的规则集按
// recommendedTarget 聚合到同一个规则块与 select 策略组；境外服务（proxy-first）默认选中 Proxies，
// 国内相关服务（direct-first）默认选中 DIRECT（策略组仍保留切换到 Proxies/Auto 的能力）。
// AdvertisingLite（reject）与 Lan（direct-builtin）没有对应策略组，规则直接落到 REJECT/DIRECT 内置策略。
// manifest 可用 includeInRecommendedTemplate=false 保留高级规则集供手动选择，同时避免其进入推荐方案。

export const OFFICIAL_USER_ID = "user_official";
export const RECOMMENDED_TEMPLATE_ID = "tpl_recommended";
export const RECOMMENDED_TEMPLATE_SLUG = "recommended";

const snapshotItem = (
  hashBySlug: Map<string, string>,
  entry: ReturnType<typeof loadBuiltinRulesetManifest>[number]
): RuleItem | null => {
  const hash = hashBySlug.get(entry.slug);
  if (!hash) return null;
  return {
    kind: "snapshot",
    catalogId: catalogIdForSlug(entry.slug),
    slug: entry.slug,
    hash,
    emit: "provider",
    ...(entry.behavior === "ipcidr" ? { extra: "no-resolve" } : {})
  };
};

// 地区分组是按实际节点动态生成的：某个地区码当前没有节点时，渲染阶段会静默跳过
// 对应的「group」成员引用（见 evaluate.ts expandMembers），所以这里可以放心把全部
// 已支持的地区码都列进默认候选——用户实际能选到的，永远只是他们真正拥有节点的那些地区。
const regionMembers = (): GroupMember[] => [
  ...REGION_CODES.map((code): GroupMember => ({ kind: "group", name: code })),
  { kind: "group", name: "Others" }
];

const proxyFirstMembers = (): GroupMember[] => [
  { kind: "group", name: "Proxies" },
  { kind: "group", name: "Auto" },
  ...regionMembers(),
  { kind: "builtin", policy: "DIRECT" },
  { kind: "builtin", policy: "REJECT" }
];

const directFirstMembers = (): GroupMember[] => [
  { kind: "builtin", policy: "DIRECT" },
  { kind: "group", name: "Proxies" },
  { kind: "group", name: "Auto" },
  ...regionMembers(),
  { kind: "builtin", policy: "REJECT" }
];

export const buildRecommendedTemplatePayload = (): TemplatePayloadV2 | null => {
  const manifest = loadBuiltinRulesetManifest();
  const recommendedEntries = manifest.filter(
    (entry) => entry.includeInRecommendedTemplate !== false
  );
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

  const customGroups: CustomGroup[] = [];
  const groupOrder: string[] = ["Proxies"];
  const ruleTargets: RuleTargetBlock[] = [];
  const ruleOrder: string[] = [];

  // Lan → DIRECT、AdvertisingLite → REJECT 恒排最前，不受制于同名策略组
  for (const groupKind of ["direct-builtin", "reject"] as const) {
    const entry = recommendedEntries.find((candidate) => candidate.groupKind === groupKind);
    if (!entry) continue;
    const item = snapshotItem(hashBySlug, entry);
    if (!item) continue;
    ruleTargets.push({ target: entry.recommendedTarget, items: [item] });
    ruleOrder.push(entry.recommendedTarget);
  }

  const groupKindByTarget = new Map<string, "proxy-first" | "direct-first">();
  const ruleBlockByTarget = new Map<string, RuleTargetBlock>();

  for (const entry of recommendedEntries) {
    if (entry.groupKind !== "proxy-first" && entry.groupKind !== "direct-first") continue;
    const item = snapshotItem(hashBySlug, entry);
    if (!item) continue;
    const groupName = entry.recommendedTarget;
    const existingKind = groupKindByTarget.get(groupName);
    if (existingKind && existingKind !== entry.groupKind) {
      throw new Error(`推荐目标 ${groupName} 的 groupKind 冲突：${existingKind} / ${entry.groupKind}`);
    }
    if (!existingKind) {
      groupKindByTarget.set(groupName, entry.groupKind);
      customGroups.push({
        name: groupName,
        type: "select",
        members: entry.groupKind === "proxy-first" ? proxyFirstMembers() : directFirstMembers()
      });
      groupOrder.push(groupName);
      const block = { target: groupName, items: [item] };
      ruleBlockByTarget.set(groupName, block);
      ruleTargets.push(block);
      ruleOrder.push(groupName);
      continue;
    }
    ruleBlockByTarget.get(groupName)!.items.push(item);
  }

  // domain behavior 只能承载精确/后缀域名；旧 classical 规则中的 DOMAIN-KEYWORD
  // 作为同一目标块的手动规则保留，避免拆分 provider 时静默改变既有推荐语义。
  for (const entry of recommendedEntries) {
    if (!entry.recommendedManualRules?.length) continue;
    const block = ruleTargets.find((candidate) => candidate.target === entry.recommendedTarget);
    if (!block) continue;
    block.items.push({
      kind: "manual",
      entries: entry.recommendedManualRules.map((rule) => ({ ...rule }))
    });
  }

  // MATCH 不直接绑死 Proxies：客户端可在 Final 里临时切为 DIRECT，
  // 同时保留 Proxies 作为默认首选。Final 固定放在所有代理组之后。
  customGroups.push({
    name: "Final",
    type: "select",
    members: [
      { kind: "group", name: "Proxies" },
      { kind: "builtin", policy: "DIRECT" }
    ]
  });
  groupOrder.push("Final");

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
        {
          kind: "region-groups",
          groupType: "select",
          unclassified: "others",
          scope: "common"
        }
      ],
      custom: customGroups,
      order: groupOrder
    },
    rules: {
      deliveryMode: "provider",
      targets: ruleTargets,
      order: ruleOrder,
      prelude: [],
      final: { target: "Final" }
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
    INSERT INTO templates (id, owner_user_id, display_name, slug, description, visibility, is_official, latest_version_id, created_at, updated_at)
    VALUES (?, ?, '推荐方案', ?, '官方维护的起手配置：自动地区分组 + Auto 测速组，Apple / Netflix / Disney+ / TikTok / OpenAI / Anthropic / Steam / Google / PayPal / Telegram / Microsoft / GlobalMedia 等常用服务按同名策略组分流，BiliBili / SteamCN / China 默认直连，轻量去广告与内网直连兜底，合理的 DNS 与嗅探设置。', 'public', 1, NULL, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      display_name = excluded.display_name,
      slug = excluded.slug,
      description = excluded.description,
      visibility = excluded.visibility,
      is_official = excluded.is_official,
      updated_at = excluded.updated_at
    WHERE templates.display_name IS NOT excluded.display_name
       OR templates.slug IS NOT excluded.slug
       OR templates.description IS NOT excluded.description
       OR templates.visibility IS NOT excluded.visibility
       OR templates.is_official IS NOT excluded.is_official
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
