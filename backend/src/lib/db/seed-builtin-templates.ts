import type { Database } from "bun:sqlite";

import { createDefaultTemplatePayload } from "../render/template-payload";
import { renderManagedConfig } from "../render/render-managed-config";

export const OFFICIAL_SYSTEM_USER_ID = "user_official_proxyparser";
export const OFFICIAL_SYSTEM_USER_DISPLAY_NAME = "ProxyParser 官方";

interface BuiltinTemplateSeed {
  id: string;
  slug: string;
  displayName: string;
  description: string;
  payload: ReturnType<typeof createDefaultTemplatePayload>;
}

const exportYaml = (payload: ReturnType<typeof createDefaultTemplatePayload>) => {
  try {
    return renderManagedConfig(
      {
        proxies: payload.customProxies,
        "proxy-groups": payload.proxyGroups,
        rules: payload.rules,
        ...payload.configPatch
      },
      createDefaultTemplatePayload()
    ).yamlText;
  } catch {
    return null;
  }
};

const BUILTIN_TEMPLATES: BuiltinTemplateSeed[] = [
  {
    id: "tpl_builtin_balanced",
    slug: "official-balanced-routing",
    displayName: "官方·基础分流",
    description: "内置基础分流模板，提供默认代理、直连和拦截三类常见规则组。",
    payload: {
      ...createDefaultTemplatePayload(),
      rulesMode: "full_override",
      groupsMode: "full_override",
      configMode: "patch",
      ruleProviderRefs: [
        "loyalsoldier-direct",
        "loyalsoldier-proxy",
        "loyalsoldier-reject",
        "loyalsoldier-private"
      ],
      proxyGroups: [
        {
          name: "默认代理",
          type: "select",
          proxies: ["DIRECT", "REJECT"]
        },
        {
          name: "拦截",
          type: "select",
          proxies: ["REJECT", "DIRECT"]
        }
      ],
      rules: [
        "RULE-SET,loyalsoldier-reject,拦截",
        "RULE-SET,loyalsoldier-direct,DIRECT",
        "RULE-SET,loyalsoldier-private,DIRECT",
        "RULE-SET,loyalsoldier-proxy,默认代理",
        "MATCH,默认代理"
      ],
      configPatch: {
        mode: "rule",
        "log-level": "info",
        "allow-lan": true
      }
    }
  },
  {
    id: "tpl_builtin_ai_media",
    slug: "official-ai-media",
    displayName: "官方·AI 与流媒体增强",
    description: "为 AI 服务与常见流媒体预留独立策略组，适合在已有上游之上快速增强。",
    payload: {
      ...createDefaultTemplatePayload(),
      rulesMode: "patch",
      groupsMode: "patch",
      configMode: "patch",
      ruleProviderRefs: [
        "metacubex-geosite-openai",
        "metacubex-geosite-netflix",
        "blackmatrix7-openai",
        "blackmatrix7-netflix"
      ],
      proxyGroups: [
        {
          name: "AI 服务",
          type: "select",
          proxies: ["DIRECT", "REJECT"]
        },
        {
          name: "流媒体",
          type: "select",
          proxies: ["DIRECT", "REJECT"]
        }
      ],
      rules: [
        "RULE-SET,blackmatrix7-openai,AI 服务",
        "RULE-SET,metacubex-geosite-openai,AI 服务",
        "RULE-SET,blackmatrix7-netflix,流媒体",
        "RULE-SET,metacubex-geosite-netflix,流媒体"
      ],
      configPatch: {
        "unified-delay": true
      }
    }
  },
  {
    id: "tpl_builtin_global_minimal",
    slug: "official-global-minimal",
    displayName: "官方·极简全局代理",
    description: "适合只有少量节点时使用的极简模板，直接收敛到单一代理组。",
    payload: {
      ...createDefaultTemplatePayload(),
      rulesMode: "full_override",
      groupsMode: "full_override",
      configMode: "patch",
      proxyGroups: [
        {
          name: "GLOBAL",
          type: "select",
          proxies: ["DIRECT", "REJECT"]
        }
      ],
      rules: ["MATCH,GLOBAL"],
      configPatch: {
        mode: "rule"
      }
    }
  }
];

export const seedBuiltinTemplates = (db: Database) => {
  const ensureUser = db.query(`
    INSERT INTO users (
      id,
      email,
      username,
      display_name,
      locale,
      status,
      is_admin,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, 'zh-CN', 'disabled', 1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      display_name = excluded.display_name,
      updated_at = excluded.updated_at
  `);
  const existingTemplateIds = new Set(
    db
      .query<{ id: string }>(`SELECT id FROM templates WHERE owner_user_id = ?`)
      .all(OFFICIAL_SYSTEM_USER_ID)
      .map((row) => row.id)
  );
  const insertTemplate = db.query(`
    INSERT INTO templates (
      id,
      owner_user_id,
      display_name,
      slug,
      description,
      visibility,
      share_mode,
      publish_status,
      is_internal,
      source_template_id,
      source_label,
      source_url,
      latest_version_id,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, 'public', 'fork', 'published', 0, NULL, ?, ?, ?, ?, ?)
  `);
  const insertVersion = db.query(`
    INSERT INTO template_versions (
      id,
      template_id,
      version,
      version_note,
      payload_json,
      exported_yaml,
      created_at
    )
    VALUES (?, ?, 1, ?, ?, ?, ?)
  `);
  const now = new Date().toISOString();

  ensureUser.run(
    OFFICIAL_SYSTEM_USER_ID,
    "official@proxyparser.local",
    "proxyparser_official",
    OFFICIAL_SYSTEM_USER_DISPLAY_NAME,
    now,
    now
  );

  let seededCount = 0;

  for (const template of BUILTIN_TEMPLATES) {
    if (existingTemplateIds.has(template.id)) {
      continue;
    }

    const versionId = `${template.id}_v1`;
    insertTemplate.run(
      template.id,
      OFFICIAL_SYSTEM_USER_ID,
      template.displayName,
      template.slug,
      template.description,
      OFFICIAL_SYSTEM_USER_DISPLAY_NAME,
      "https://github.com/lanjiasheng/ProxyParser",
      versionId,
      now,
      now
    );
    insertVersion.run(
      versionId,
      template.id,
      "官方内置模板",
      JSON.stringify(template.payload),
      exportYaml(template.payload),
      now
    );
    seededCount += 1;
  }

  return seededCount;
};
