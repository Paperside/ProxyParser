import yaml from "js-yaml";

import type {
  ClashProxyDocument,
  ProxyGroupEntry,
  ProxyNode,
  TemplatePayload
} from "../../types";
import { renderAutoGroups } from "./auto-groups";
import {
  insertRuleProviderRules,
  renderRuleProviderAttachments
} from "./rule-provider-render";
import type { RulesetCatalogEntry } from "../../modules/marketplace/marketplace.repository";

const RESERVED_PROXY_NAMES = new Set(["DIRECT", "REJECT", "COMPATIBLE", "PASS"]);

const deepClone = <T,>(value: T): T => {
  return JSON.parse(JSON.stringify(value)) as T;
};

const dedupeRules = (rules: string[]) => {
  return [...new Set(rules)];
};

const mergeGroups = (baseGroups: ProxyGroupEntry[], templateGroups: ProxyGroupEntry[]) => {
  const groupMap = new Map(baseGroups.map((group) => [group.name, group] as const));

  for (const group of templateGroups) {
    groupMap.set(group.name, group);
  }

  return [...groupMap.values()];
};

const applyCustomProxies = (
  proxies: ProxyNode[],
  customProxies: ProxyNode[],
  policy: TemplatePayload["customProxiesPolicy"]
) => {
  const proxyMap = new Map(proxies.map((proxy) => [proxy.name, proxy] as const));

  for (const customProxy of customProxies) {
    const existing = proxyMap.get(customProxy.name);

    if (existing && policy === "fail_on_conflict") {
      throw new Error(`自定义节点与现有节点重名：${customProxy.name}`);
    }

    if (existing && policy === "append") {
      throw new Error(`检测到重名节点，当前策略不允许覆盖：${customProxy.name}`);
    }

    proxyMap.set(customProxy.name, customProxy);
  }

  return [...proxyMap.values()];
};

const validateProxyGroups = (document: ClashProxyDocument) => {
  const proxyNames = new Set(document.proxies.map((proxy) => proxy.name));
  const groupNames = new Set(document["proxy-groups"].map((group) => group.name));

  for (const group of document["proxy-groups"]) {
    for (const item of group.proxies) {
      if (RESERVED_PROXY_NAMES.has(item)) {
        continue;
      }

      if (!proxyNames.has(item) && !groupNames.has(item)) {
        throw new Error(`代理组 ${group.name} 引用了不存在的节点或分组：${item}`);
      }
    }
  }
};

export interface ManagedRenderResult {
  document: ClashProxyDocument;
  yamlText: string;
}

export const renderManagedConfig = (
  sourceDocument: ClashProxyDocument,
  templatePayload: TemplatePayload,
  ruleProviderCatalog: RulesetCatalogEntry[] = []
): ManagedRenderResult => {
  const sourceClone = deepClone(sourceDocument);
  const rendered: ClashProxyDocument =
    templatePayload.configMode === "full_override"
      ? ({
          ...deepClone(templatePayload.configPatch),
          proxies: [],
          "proxy-groups": [],
          rules: []
        } as ClashProxyDocument)
      : {
          ...sourceClone,
          ...deepClone(templatePayload.configPatch)
        };

  rendered.proxies = applyCustomProxies(
    sourceClone.proxies,
    deepClone(templatePayload.customProxies),
    templatePayload.customProxiesPolicy
  );

  const sourceGroups = templatePayload.autoGroup?.enabled
    ? renderAutoGroups(rendered.proxies, templatePayload.autoGroup).groups
    : sourceClone["proxy-groups"];

  rendered["proxy-groups"] =
    templatePayload.groupsMode === "full_override"
      ? deepClone(templatePayload.proxyGroups)
      : mergeGroups(sourceGroups, deepClone(templatePayload.proxyGroups));

  const sourceRules = sourceClone.rules ?? [];
  const attachmentRender = renderRuleProviderAttachments({
    attachments: templatePayload.ruleProviderAttachments ?? [],
    catalog: ruleProviderCatalog
  });
  const currentProviders =
    typeof rendered["rule-providers"] === "object" && rendered["rule-providers"] !== null
      ? (rendered["rule-providers"] as Record<string, unknown>)
      : {};

  Object.assign(currentProviders, attachmentRender.providers);

  if (Object.keys(currentProviders).length > 0) {
    rendered["rule-providers"] = currentProviders;
  }

  rendered.rules =
    templatePayload.rulesMode === "full_override"
      ? deepClone(templatePayload.rules)
      : dedupeRules([...deepClone(templatePayload.rules), ...sourceRules]);
  rendered.rules = dedupeRules(
    insertRuleProviderRules({
      baseRules: rendered.rules,
      providerRules: attachmentRender.rules,
      position:
        templatePayload.ruleProviderAttachments?.find((attachment) => attachment.insert)?.insert
          .position ?? "before-match"
    })
  );

  validateProxyGroups(rendered);

  return {
    document: rendered,
    yamlText: yaml.dump(rendered, {
      noRefs: true,
      lineWidth: 120
    })
  };
};
