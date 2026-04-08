import yaml from "js-yaml";

import type { ClashProxyDocument, ProxyGroupEntry, ProxyNode } from "../../types";
import type { RulesetCatalogEntry } from "../marketplace/marketplace.repository";

type StepPatchMode = "patch" | "full_override";

interface ProxyAddOperation {
  type: "add";
  proxy: ProxyNode;
}

interface ProxyPatchOperation {
  type: "patch";
  targetName: string;
  patch: Record<string, unknown>;
}

interface ProxyReplaceOperation {
  type: "replace";
  targetName: string;
  proxy: ProxyNode;
}

interface ProxyRemoveOperation {
  type: "remove";
  targetName: string;
}

type ProxyOperation =
  | ProxyAddOperation
  | ProxyPatchOperation
  | ProxyReplaceOperation
  | ProxyRemoveOperation;

interface ProxyStepOperations {
  proxies?: ProxyNode[];
  items?: ProxyOperation[];
}

interface GroupAddOperation {
  type: "add";
  group: ProxyGroupEntry;
}

interface GroupPatchOperation {
  type: "patch";
  targetName: string;
  patch: Record<string, unknown>;
}

interface GroupReplaceOperation {
  type: "replace";
  targetName: string;
  group: ProxyGroupEntry;
}

interface GroupRemoveOperation {
  type: "remove";
  targetName: string;
}

type GroupOperation =
  | GroupAddOperation
  | GroupPatchOperation
  | GroupReplaceOperation
  | GroupRemoveOperation;

interface GroupsRulesStepOperations {
  ruleProviderRefs?: string[];
  proxyGroups?: ProxyGroupEntry[];
  items?: GroupOperation[];
  rules?: string[];
  prependRules?: string[];
  appendRules?: string[];
  removeRules?: string[];
}

interface SettingsStepOperations {
  config?: Record<string, unknown>;
  set?: Record<string, unknown>;
  unset?: string[];
}

export interface NormalizedDraftStep<T> {
  patchMode: StepPatchMode;
  editorMode: "visual" | "raw";
  operations: T;
}

export interface DraftPreviewInput {
  sourceDocument: ClashProxyDocument;
  proxiesStep?: {
    patchMode: "patch" | "full_override" | null;
    editorMode: "visual" | "raw";
    operations: unknown;
    raw: unknown;
  } | null;
  groupsRulesStep?: {
    patchMode: "patch" | "full_override" | null;
    editorMode: "visual" | "raw";
    operations: unknown;
    raw: unknown;
  } | null;
  settingsStep?: {
    patchMode: "patch" | "full_override" | null;
    editorMode: "visual" | "raw";
    operations: unknown;
    raw: unknown;
  } | null;
  ruleProviderCatalog: RulesetCatalogEntry[];
}

export interface DraftPreviewResult {
  document: ClashProxyDocument;
  yamlText: string;
  shareabilityStatus: "shareable" | "source_locked";
  lockedReasons: string[];
}

const RESERVED_PROXY_NAMES = new Set(["DIRECT", "REJECT", "COMPATIBLE", "PASS"]);
const RESERVED_TOP_LEVEL_KEYS = new Set(["proxies", "proxy-groups", "rules", "rule-providers"]);

const deepClone = <T,>(value: T): T => {
  return JSON.parse(JSON.stringify(value)) as T;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const toStringArray = (value: unknown) => {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
};

const normalizeProxyNode = (value: unknown): ProxyNode | null => {
  if (!isRecord(value) || typeof value.name !== "string" || value.name.trim().length === 0) {
    return null;
  }

  return value as ProxyNode;
};

const normalizeProxyGroup = (value: unknown): ProxyGroupEntry | null => {
  if (
    !isRecord(value) ||
    typeof value.name !== "string" ||
    value.name.trim().length === 0 ||
    typeof value.type !== "string"
  ) {
    return null;
  }

  return {
    ...(value as ProxyGroupEntry),
    proxies: Array.isArray(value.proxies)
      ? value.proxies.filter((item): item is string => typeof item === "string")
      : []
  };
};

const normalizeProxyStep = (
  step:
    | {
        patchMode: "patch" | "full_override" | null;
        editorMode: "visual" | "raw";
        operations: unknown;
        raw: unknown;
      }
    | null
    | undefined
): NormalizedDraftStep<ProxyStepOperations> | null => {
  if (!step) {
    return null;
  }

  const patchMode: StepPatchMode = step.patchMode === "full_override" ? "full_override" : "patch";
  const editorMode = step.editorMode === "raw" ? "raw" : "visual";

  if (editorMode === "raw" && Array.isArray(step.raw)) {
    const proxies = step.raw.map(normalizeProxyNode).filter((item): item is ProxyNode => Boolean(item));
    return {
      patchMode,
      editorMode,
      operations: {
        proxies
      }
    };
  }

  const candidate = isRecord(step.operations) ? step.operations : {};
  const items = Array.isArray(candidate.items)
    ? candidate.items
        .map((item): ProxyOperation | null => {
          if (!isRecord(item) || typeof item.type !== "string") {
            return null;
          }

          if (item.type === "add") {
            const proxy = normalizeProxyNode(item.proxy);
            return proxy ? { type: "add", proxy } : null;
          }

          if (item.type === "patch") {
            return typeof item.targetName === "string" && isRecord(item.patch)
              ? {
                  type: "patch",
                  targetName: item.targetName,
                  patch: item.patch
                }
              : null;
          }

          if (item.type === "replace") {
            const proxy = normalizeProxyNode(item.proxy);
            return typeof item.targetName === "string" && proxy
              ? {
                  type: "replace",
                  targetName: item.targetName,
                  proxy
                }
              : null;
          }

          if (item.type === "remove") {
            return typeof item.targetName === "string"
              ? {
                  type: "remove",
                  targetName: item.targetName
                }
              : null;
          }

          return null;
        })
        .filter((item): item is ProxyOperation => Boolean(item))
    : [];

  const proxies = Array.isArray(candidate.proxies)
    ? candidate.proxies.map(normalizeProxyNode).filter((item): item is ProxyNode => Boolean(item))
    : [];

  return {
    patchMode,
    editorMode,
    operations: {
      proxies,
      items
    }
  };
};

const normalizeGroupsRulesStep = (
  step:
    | {
        patchMode: "patch" | "full_override" | null;
        editorMode: "visual" | "raw";
        operations: unknown;
        raw: unknown;
      }
    | null
    | undefined
): NormalizedDraftStep<GroupsRulesStepOperations> | null => {
  if (!step) {
    return null;
  }

  const patchMode: StepPatchMode = step.patchMode === "full_override" ? "full_override" : "patch";
  const editorMode = step.editorMode === "raw" ? "raw" : "visual";

  if (editorMode === "raw" && isRecord(step.raw)) {
    const raw = step.raw as Record<string, unknown>;
    return {
      patchMode,
      editorMode,
      operations: {
        ruleProviderRefs: toStringArray(raw.ruleProviderRefs),
        proxyGroups: Array.isArray(raw.proxyGroups)
          ? raw.proxyGroups
              .map(normalizeProxyGroup)
              .filter((item): item is ProxyGroupEntry => Boolean(item))
          : [],
        rules: toStringArray(raw.rules),
        prependRules: [],
        appendRules: [],
        removeRules: []
      }
    };
  }

  const candidate = isRecord(step.operations) ? step.operations : {};
  const items = Array.isArray(candidate.items)
    ? candidate.items
        .map((item): GroupOperation | null => {
          if (!isRecord(item) || typeof item.type !== "string") {
            return null;
          }

          if (item.type === "add") {
            const group = normalizeProxyGroup(item.group);
            return group ? { type: "add", group } : null;
          }

          if (item.type === "patch") {
            return typeof item.targetName === "string" && isRecord(item.patch)
              ? {
                  type: "patch",
                  targetName: item.targetName,
                  patch: item.patch
                }
              : null;
          }

          if (item.type === "replace") {
            const group = normalizeProxyGroup(item.group);
            return typeof item.targetName === "string" && group
              ? {
                  type: "replace",
                  targetName: item.targetName,
                  group
                }
              : null;
          }

          if (item.type === "remove") {
            return typeof item.targetName === "string"
              ? {
                  type: "remove",
                  targetName: item.targetName
                }
              : null;
          }

          return null;
        })
        .filter((item): item is GroupOperation => Boolean(item))
    : [];

  return {
    patchMode,
    editorMode,
    operations: {
      ruleProviderRefs: toStringArray(candidate.ruleProviderRefs),
      proxyGroups: Array.isArray(candidate.proxyGroups)
        ? candidate.proxyGroups
            .map(normalizeProxyGroup)
            .filter((item): item is ProxyGroupEntry => Boolean(item))
        : [],
      items,
      rules: toStringArray(candidate.rules),
      prependRules: toStringArray(candidate.prependRules),
      appendRules: toStringArray(candidate.appendRules),
      removeRules: toStringArray(candidate.removeRules)
    }
  };
};

const normalizeSettingsStep = (
  step:
    | {
        patchMode: "patch" | "full_override" | null;
        editorMode: "visual" | "raw";
        operations: unknown;
        raw: unknown;
      }
    | null
    | undefined
): NormalizedDraftStep<SettingsStepOperations> | null => {
  if (!step) {
    return null;
  }

  const patchMode: StepPatchMode = step.patchMode === "full_override" ? "full_override" : "patch";
  const editorMode = step.editorMode === "raw" ? "raw" : "visual";

  if (editorMode === "raw" && isRecord(step.raw)) {
    return {
      patchMode,
      editorMode,
      operations: {
        config: step.raw
      }
    };
  }

  const candidate = isRecord(step.operations) ? step.operations : {};

  return {
    patchMode,
    editorMode,
    operations: {
      config: isRecord(candidate.config) ? candidate.config : {},
      set: isRecord(candidate.set) ? candidate.set : {},
      unset: toStringArray(candidate.unset)
    }
  };
};

const applyProxyStep = (
  document: ClashProxyDocument,
  step: NormalizedDraftStep<ProxyStepOperations> | null,
  lockedReasons: string[],
  sourceProxyNames: Set<string>
) => {
  if (!step) {
    return;
  }

  if (step.patchMode === "full_override") {
    document.proxies = deepClone(step.operations.proxies ?? []);
    return;
  }

  const proxies = deepClone(document.proxies);
  const indexByName = () => new Map(proxies.map((proxy, index) => [proxy.name, index] as const));

  for (const operation of step.operations.items ?? []) {
    const lookup = indexByName();

    if (operation.type === "add") {
      if (lookup.has(operation.proxy.name)) {
        throw new Error(`节点已存在，无法新增：${operation.proxy.name}`);
      }

      proxies.push(deepClone(operation.proxy));
      continue;
    }

    const currentIndex = lookup.get(operation.targetName);

    if (currentIndex === undefined) {
      throw new Error(`未找到要编辑的节点：${operation.targetName}`);
    }

    if (sourceProxyNames.has(operation.targetName)) {
      lockedReasons.push(`在 patch 模式下修改了源节点：${operation.targetName}`);
    }

    if (operation.type === "patch") {
      proxies[currentIndex] = {
        ...proxies[currentIndex],
        ...deepClone(operation.patch)
      };
      continue;
    }

    if (operation.type === "replace") {
      proxies[currentIndex] = deepClone(operation.proxy);
      continue;
    }

    proxies.splice(currentIndex, 1);
  }

  document.proxies = proxies;
};

const dedupeRules = (rules: string[]) => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const rule of rules) {
    if (seen.has(rule)) {
      continue;
    }

    seen.add(rule);
    result.push(rule);
  }

  return result;
};

const applyGroupsRulesStep = (
  document: ClashProxyDocument,
  step: NormalizedDraftStep<GroupsRulesStepOperations> | null,
  lockedReasons: string[],
  sourceGroupNames: Set<string>,
  sourceRules: Set<string>,
  catalogBySlug: Map<string, RulesetCatalogEntry>
) => {
  if (!step) {
    return;
  }

  const currentProviders = isRecord(document["rule-providers"])
    ? (deepClone(document["rule-providers"]) as Record<string, unknown>)
    : {};

  for (const slug of step.operations.ruleProviderRefs ?? []) {
    const catalog = catalogBySlug.get(slug);

    if (!catalog || catalog.metadata.kind !== "rule_provider" || !catalog.sourceUrl) {
      continue;
    }

    currentProviders[slug] = {
      type: "http",
      behavior: catalog.metadata.behavior ?? "classical",
      url: catalog.sourceUrl,
      path: `./rule-providers/${slug}.yaml`,
      interval:
        typeof catalog.metadata.updateIntervalSeconds === "number"
          ? catalog.metadata.updateIntervalSeconds
          : 24 * 60 * 60,
      format: "yaml"
    };
  }

  if (Object.keys(currentProviders).length > 0) {
    document["rule-providers"] = currentProviders;
  }

  if (step.patchMode === "full_override") {
    document["proxy-groups"] = deepClone(step.operations.proxyGroups ?? []);
    document.rules = dedupeRules(deepClone(step.operations.rules ?? []));
    return;
  }

  const groups = deepClone(document["proxy-groups"]);
  const indexByName = () => new Map(groups.map((group, index) => [group.name, index] as const));

  for (const operation of step.operations.items ?? []) {
    const lookup = indexByName();

    if (operation.type === "add") {
      if (lookup.has(operation.group.name)) {
        throw new Error(`代理组已存在，无法新增：${operation.group.name}`);
      }

      groups.push(deepClone(operation.group));
      continue;
    }

    const currentIndex = lookup.get(operation.targetName);

    if (currentIndex === undefined) {
      throw new Error(`未找到要编辑的代理组：${operation.targetName}`);
    }

    if (sourceGroupNames.has(operation.targetName)) {
      lockedReasons.push(`在 patch 模式下修改了源代理组：${operation.targetName}`);
    }

    if (operation.type === "patch") {
      groups[currentIndex] = {
        ...groups[currentIndex],
        ...deepClone(operation.patch)
      };
      continue;
    }

    if (operation.type === "replace") {
      groups[currentIndex] = deepClone(operation.group);
      continue;
    }

    groups.splice(currentIndex, 1);
  }

  document["proxy-groups"] = groups;

  const baseRules = deepClone(document.rules ?? []);
  const removedRules = new Set(step.operations.removeRules ?? []);

  for (const removed of removedRules) {
    if (sourceRules.has(removed)) {
      lockedReasons.push(`在 patch 模式下移除了源规则：${removed}`);
    }
  }

  const filteredRules = baseRules.filter((rule) => !removedRules.has(rule));
  document.rules = dedupeRules([
    ...(step.operations.prependRules ?? []),
    ...filteredRules,
    ...(step.operations.appendRules ?? [])
  ]);
};

const applySettingsStep = (
  document: ClashProxyDocument,
  step: NormalizedDraftStep<SettingsStepOperations> | null,
  lockedReasons: string[],
  sourceDocument: ClashProxyDocument
) => {
  if (!step) {
    return;
  }

  if (step.patchMode === "full_override") {
    const nextConfig = deepClone(step.operations.config ?? {});

    for (const key of Object.keys(document)) {
      if (!RESERVED_TOP_LEVEL_KEYS.has(key)) {
        delete document[key];
      }
    }

    for (const [key, value] of Object.entries(nextConfig)) {
      if (!RESERVED_TOP_LEVEL_KEYS.has(key)) {
        document[key] = value;
      }
    }

    return;
  }

  const patchSet = deepClone(step.operations.set ?? {});

  for (const [key, value] of Object.entries(patchSet)) {
    if (RESERVED_TOP_LEVEL_KEYS.has(key)) {
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(sourceDocument, key)) {
      lockedReasons.push(`在 patch 模式下覆盖了源配置项：${key}`);
    }

    document[key] = value;
  }

  for (const key of step.operations.unset ?? []) {
    if (RESERVED_TOP_LEVEL_KEYS.has(key)) {
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(sourceDocument, key)) {
      lockedReasons.push(`在 patch 模式下删除了源配置项：${key}`);
    }

    delete document[key];
  }
};

const validateProxyGroups = (document: ClashProxyDocument) => {
  const proxyNames = new Set(document.proxies.map((proxy) => proxy.name));
  const groupNames = new Set(document["proxy-groups"].map((group) => group.name));

  for (const group of document["proxy-groups"]) {
    const items = Array.isArray(group.proxies) ? group.proxies : [];

    for (const item of items) {
      if (RESERVED_PROXY_NAMES.has(item)) {
        continue;
      }

      if (!proxyNames.has(item) && !groupNames.has(item)) {
        throw new Error(`代理组 ${group.name} 引用了不存在的节点或分组：${item}`);
      }
    }
  }
};

export const renderGeneratedSubscriptionDraftPreview = (
  input: DraftPreviewInput
): DraftPreviewResult => {
  const sourceDocument = deepClone(input.sourceDocument);
  const rendered = deepClone(input.sourceDocument);
  const lockedReasons: string[] = [];
  const catalogBySlug = new Map(input.ruleProviderCatalog.map((item) => [item.slug, item] as const));

  applyProxyStep(
    rendered,
    normalizeProxyStep(input.proxiesStep),
    lockedReasons,
    new Set(sourceDocument.proxies.map((proxy) => proxy.name))
  );
  applyGroupsRulesStep(
    rendered,
    normalizeGroupsRulesStep(input.groupsRulesStep),
    lockedReasons,
    new Set(sourceDocument["proxy-groups"].map((group) => group.name)),
    new Set(sourceDocument.rules ?? []),
    catalogBySlug
  );
  applySettingsStep(
    rendered,
    normalizeSettingsStep(input.settingsStep),
    lockedReasons,
    sourceDocument
  );

  validateProxyGroups(rendered);

  return {
    document: rendered,
    yamlText: yaml.dump(rendered, {
      noRefs: true,
      lineWidth: 120
    }),
    shareabilityStatus: lockedReasons.length > 0 ? "source_locked" : "shareable",
    lockedReasons: [...new Set(lockedReasons)]
  };
};
