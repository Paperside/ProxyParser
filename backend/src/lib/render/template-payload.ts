import type { TemplatePayload } from "../../types";

export const createDefaultTemplatePayload = (): TemplatePayload => {
  return {
    rulesMode: "patch",
    groupsMode: "patch",
    configMode: "patch",
    customProxiesPolicy: "append",
    ruleProviderRefs: [],
    rules: [],
    proxyGroups: [],
    configPatch: {},
    customProxies: []
  };
};

export const normalizeTemplatePayload = (value: unknown): TemplatePayload => {
  const fallback = createDefaultTemplatePayload();

  if (typeof value !== "object" || value === null) {
    return fallback;
  }

  const candidate = value as Partial<TemplatePayload>;

  return {
    rulesMode: candidate.rulesMode === "full_override" ? "full_override" : "patch",
    groupsMode: candidate.groupsMode === "full_override" ? "full_override" : "patch",
    configMode: candidate.configMode === "full_override" ? "full_override" : "patch",
    customProxiesPolicy:
      candidate.customProxiesPolicy === "replace_same_name" ||
      candidate.customProxiesPolicy === "fail_on_conflict"
        ? candidate.customProxiesPolicy
        : "append",
    ruleProviderRefs: Array.isArray(candidate.ruleProviderRefs)
      ? candidate.ruleProviderRefs.filter((item): item is string => typeof item === "string")
      : [],
    rules: Array.isArray(candidate.rules)
      ? candidate.rules.filter((item): item is string => typeof item === "string")
      : [],
    proxyGroups: Array.isArray(candidate.proxyGroups) ? candidate.proxyGroups : [],
    configPatch:
      typeof candidate.configPatch === "object" && candidate.configPatch !== null
        ? candidate.configPatch
        : {},
    customProxies: Array.isArray(candidate.customProxies) ? candidate.customProxies : []
  };
};
