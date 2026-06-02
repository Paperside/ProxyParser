import type { RuleProviderAttachment } from "../../types";
import type { RulesetCatalogEntry } from "../../modules/marketplace/marketplace.repository";

export interface RuleProviderRenderResult {
  providers: Record<string, unknown>;
  rules: string[];
  lockedReasons: string[];
}

const normalizeBehavior = (value: unknown) => {
  return value === "domain" || value === "ipcidr" || value === "classical"
    ? value
    : "classical";
};

const normalizeInterval = (value: unknown) => {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 24 * 60 * 60;
};

const buildRulesetContentUrl = (slug: string, baseUrl = "") => {
  return `${baseUrl.replace(/\/$/, "")}/api/marketplace/rulesets/${slug}/content`;
};

export const renderRuleProviderAttachments = ({
  attachments,
  catalog,
  baseUrl = ""
}: {
  attachments: RuleProviderAttachment[];
  catalog: RulesetCatalogEntry[];
  baseUrl?: string;
}): RuleProviderRenderResult => {
  const catalogBySlug = new Map(catalog.map((item) => [item.slug, item] as const));
  const providers: Record<string, unknown> = {};
  const rules: string[] = [];
  const lockedReasons: string[] = [];

  for (const attachment of attachments) {
    const ruleset = catalogBySlug.get(attachment.providerSlug);

    if (!ruleset) {
      lockedReasons.push(`规则源不存在或不可访问：${attachment.providerSlug}`);
      continue;
    }

    providers[attachment.providerSlug] = {
      type: "http",
      behavior: normalizeBehavior(ruleset.metadata.behavior),
      url: buildRulesetContentUrl(attachment.providerSlug, baseUrl),
      path: `./rule-providers/${attachment.providerSlug}.yaml`,
      interval: normalizeInterval(ruleset.metadata.updateIntervalSeconds),
      format: "yaml"
    };
    rules.push(`RULE-SET,${attachment.providerSlug},${attachment.targetPolicy}`);
  }

  return {
    providers,
    rules,
    lockedReasons
  };
};

export const insertRuleProviderRules = ({
  baseRules,
  providerRules,
  position
}: {
  baseRules: string[];
  providerRules: string[];
  position: RuleProviderAttachment["insert"]["position"];
}) => {
  if (providerRules.length === 0) {
    return baseRules;
  }

  if (position === "top") {
    return [...providerRules, ...baseRules];
  }

  if (position === "bottom") {
    return [...baseRules, ...providerRules];
  }

  const matchIndex = baseRules.findIndex((rule) => rule.trim().startsWith("MATCH"));

  if (matchIndex === -1) {
    return [...baseRules, ...providerRules];
  }

  return [
    ...baseRules.slice(0, matchIndex),
    ...providerRules,
    ...baseRules.slice(matchIndex)
  ];
};
