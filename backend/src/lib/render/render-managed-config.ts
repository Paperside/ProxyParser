import yaml from "js-yaml";

import type {
  ClashProxyDocument,
  ProxyGroupEntry,
  ProxyNode,
  TemplatePayload
} from "../../types";

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
  templatePayload: TemplatePayload
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

  rendered["proxy-groups"] =
    templatePayload.groupsMode === "full_override"
      ? deepClone(templatePayload.proxyGroups)
      : mergeGroups(sourceClone["proxy-groups"], deepClone(templatePayload.proxyGroups));

  const sourceRules = sourceClone.rules ?? [];
  rendered.rules =
    templatePayload.rulesMode === "full_override"
      ? deepClone(templatePayload.rules)
      : dedupeRules([...deepClone(templatePayload.rules), ...sourceRules]);

  validateProxyGroups(rendered);

  return {
    document: rendered,
    yamlText: yaml.dump(rendered, {
      noRefs: true,
      lineWidth: 120
    })
  };
};
