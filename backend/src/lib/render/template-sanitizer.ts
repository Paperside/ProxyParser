import type { ProxyGroupEntry, TemplatePayload } from "../../types";

const RESERVED_PROXY_REFERENCES = new Set(["DIRECT", "REJECT", "COMPATIBLE", "PASS"]);

export interface SanitizedTemplateResult {
  payload: TemplatePayload;
  removedProxyNames: string[];
  lockedReasons: string[];
}

const sanitizeGroupReferences = (
  groups: ProxyGroupEntry[],
  removedProxyNames: Set<string>
) => {
  const groupNames = new Set(groups.map((group) => group.name));

  return groups.map((group) => ({
    ...group,
    proxies: (Array.isArray(group.proxies) ? group.proxies : []).filter((item) => {
      return (
        RESERVED_PROXY_REFERENCES.has(item) ||
        groupNames.has(item) ||
        !removedProxyNames.has(item)
      );
    })
  }));
};

export const sanitizeTemplatePayload = (
  payload: TemplatePayload
): SanitizedTemplateResult => {
  const removedProxyNames = new Set(payload.customProxies.map((proxy) => proxy.name));
  const proxyGroups = sanitizeGroupReferences(payload.proxyGroups, removedProxyNames);

  return {
    payload: {
      ...payload,
      customProxies: [],
      customProxiesPolicy: "append",
      proxyGroups
    },
    removedProxyNames: [...removedProxyNames],
    lockedReasons:
      removedProxyNames.size > 0
        ? [`已移除 ${removedProxyNames.size} 个真实节点，仅保留规则和分组操作。`]
        : []
  };
};
