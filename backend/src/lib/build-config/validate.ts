import {
  BUILTIN_POLICIES,
  RULE_TYPES,
  type BuildConfig,
  type BuiltinPolicy,
  type ConfigSection,
  type CustomGroup,
  type CustomNode,
  type GroupGenerator,
  type GroupMember,
  type GroupsSection,
  type NodeOverride,
  type NodeSelector,
  type NodeTransform,
  type NodesSection,
  type PreludeRule,
  type RuleEntry,
  type RuleItem,
  type RulesSection,
  type RuleTargetBlock,
  type RuleType,
  type SourceRef
} from "./types";

export type ValidationResult =
  | { ok: true; value: BuildConfig }
  | { ok: false; errors: string[] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

class Collector {
  errors: string[] = [];

  fail(message: string) {
    this.errors.push(message);
    return null;
  }
}

const parseSourceRef = (value: unknown, index: number, c: Collector): SourceRef | null => {
  if (!isRecord(value) || !isNonEmptyString(value.sourceId)) {
    return c.fail(`sources[${index}]：缺少有效的 sourceId`);
  }
  return { sourceId: value.sourceId, enabled: value.enabled !== false };
};

const parseTransform = (value: unknown, index: number, c: Collector): NodeTransform | null => {
  if (!isRecord(value)) {
    return c.fail(`nodes.transforms[${index}]：必须是对象`);
  }
  switch (value.kind) {
    case "strip-emoji":
    case "strip-multiplier":
    case "trim-whitespace":
      return { kind: value.kind };
    case "regex-replace": {
      if (!isNonEmptyString(value.from) || typeof value.to !== "string") {
        return c.fail(`nodes.transforms[${index}]：regex-replace 需要 from 与 to`);
      }
      try {
        new RegExp(value.from, typeof value.flags === "string" ? value.flags : "g");
      } catch {
        return c.fail(`nodes.transforms[${index}]：无效的正则表达式 ${value.from}`);
      }
      return {
        kind: "regex-replace",
        from: value.from,
        to: value.to,
        ...(typeof value.flags === "string" ? { flags: value.flags } : {})
      };
    }
    default:
      return c.fail(`nodes.transforms[${index}]：未知转换类型 ${String(value.kind)}`);
  }
};

const parseOverride = (value: unknown, index: number, c: Collector): NodeOverride | null => {
  if (!isRecord(value) || !isNonEmptyString(value.nodeId)) {
    return c.fail(`nodes.overrides[${index}]：缺少 nodeId`);
  }
  const override: NodeOverride = { nodeId: value.nodeId };
  if (value.rename !== undefined) {
    if (!isNonEmptyString(value.rename)) {
      return c.fail(`nodes.overrides[${index}]：rename 不能为空`);
    }
    override.rename = value.rename;
  }
  if (value.disabled !== undefined) {
    override.disabled = value.disabled === true;
  }
  if (value.tags !== undefined) {
    if (!Array.isArray(value.tags) || !value.tags.every(isNonEmptyString)) {
      return c.fail(`nodes.overrides[${index}]：tags 必须是非空字符串数组`);
    }
    override.tags = value.tags;
  }
  return override;
};

const parseCustomNode = (value: unknown, index: number, c: Collector): CustomNode | null => {
  if (!isRecord(value)) {
    return c.fail(`nodes.custom[${index}]：必须是对象`);
  }
  if (!isNonEmptyString(value.id) || !value.id.startsWith("cn_")) {
    return c.fail(`nodes.custom[${index}]：id 必须以 cn_ 开头`);
  }
  if (!isNonEmptyString(value.name)) {
    return c.fail(`nodes.custom[${index}]：缺少 name`);
  }
  if (!isNonEmptyString(value.type)) {
    return c.fail(`nodes.custom[${index}]：缺少 type（协议）`);
  }
  if (!isNonEmptyString(value.server)) {
    return c.fail(`nodes.custom[${index}]：缺少 server`);
  }
  const port = typeof value.port === "number" ? value.port : Number(value.port);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return c.fail(`nodes.custom[${index}]：port 必须是 1-65535 的整数`);
  }
  return {
    id: value.id,
    name: value.name,
    type: value.type,
    server: value.server,
    port,
    secretRef: isNonEmptyString(value.secretRef) ? value.secretRef : null,
    extra: isRecord(value.extra) ? value.extra : {},
    ...(Array.isArray(value.tags) && value.tags.every(isNonEmptyString)
      ? { tags: value.tags }
      : {})
  };
};

const parseSelector = (value: unknown, path: string, c: Collector): NodeSelector | null => {
  if (!isRecord(value)) {
    return c.fail(`${path}：selector 必须是对象`);
  }
  switch (value.kind) {
    case "all-enabled":
      return { kind: "all-enabled" };
    case "custom-only":
      return { kind: "custom-only" };
    case "region":
      return isNonEmptyString(value.region)
        ? { kind: "region", region: value.region }
        : c.fail(`${path}：region selector 缺少 region`);
    case "tag":
      return isNonEmptyString(value.tag)
        ? { kind: "tag", tag: value.tag }
        : c.fail(`${path}：tag selector 缺少 tag`);
    case "protocol":
      return isNonEmptyString(value.protocol)
        ? { kind: "protocol", protocol: value.protocol }
        : c.fail(`${path}：protocol selector 缺少 protocol`);
    default:
      return c.fail(`${path}：未知 selector 类型 ${String(value.kind)}`);
  }
};

const parseMember = (value: unknown, path: string, c: Collector): GroupMember | null => {
  if (!isRecord(value)) {
    return c.fail(`${path}：成员必须是对象`);
  }
  switch (value.kind) {
    case "node":
      return isNonEmptyString(value.nodeId)
        ? { kind: "node", nodeId: value.nodeId }
        : c.fail(`${path}：node 成员缺少 nodeId`);
    case "group":
      return isNonEmptyString(value.name)
        ? { kind: "group", name: value.name }
        : c.fail(`${path}：group 成员缺少 name`);
    case "selector": {
      const selector = parseSelector(value.selector, path, c);
      return selector ? { kind: "selector", selector } : null;
    }
    case "builtin":
      return BUILTIN_POLICIES.includes(value.policy as BuiltinPolicy)
        ? { kind: "builtin", policy: value.policy as BuiltinPolicy }
        : c.fail(`${path}：无效的内置策略目标 ${String(value.policy)}`);
    default:
      return c.fail(`${path}：未知成员类型 ${String(value.kind)}`);
  }
};

const GROUP_TYPES = new Set(["select", "url-test", "fallback", "load-balance"]);

const parseGenerator = (value: unknown, index: number, c: Collector): GroupGenerator | null => {
  if (!isRecord(value)) {
    return c.fail(`groups.generators[${index}]：必须是对象`);
  }
  switch (value.kind) {
    case "proxies-root": {
      if (!isNonEmptyString(value.name)) {
        return c.fail(`groups.generators[${index}]：proxies-root 缺少 name`);
      }
      const extraRaw = Array.isArray(value.extraMembers) ? value.extraMembers : [];
      const extraMembers: GroupMember[] = [];
      for (const [memberIndex, member] of extraRaw.entries()) {
        const parsed = parseMember(member, `groups.generators[${index}].extraMembers[${memberIndex}]`, c);
        if (parsed) extraMembers.push(parsed);
      }
      return {
        kind: "proxies-root",
        name: value.name,
        includeAuto: value.includeAuto === true,
        extraMembers
      };
    }
    case "region-groups": {
      if (
        value.scope !== undefined &&
        value.scope !== "common" &&
        value.scope !== "full"
      ) {
        c.fail(`groups.generators[${index}].scope：必须是 common / full`);
      }
      return {
        kind: "region-groups",
        groupType: value.groupType === "url-test" ? "url-test" : "select",
        unclassified: value.unclassified === "ignore" ? "ignore" : "others",
        ...(value.scope === "common" || value.scope === "full"
          ? { scope: value.scope }
          : {}),
        ...(isRecord(value.regionOverrides)
          ? {
              regionOverrides: Object.fromEntries(
                Object.entries(value.regionOverrides).filter(
                  (entry): entry is [string, string] => isNonEmptyString(entry[1])
                )
              )
            }
          : {})
      };
    }
    case "auto-group": {
      if (!isNonEmptyString(value.name)) {
        return c.fail(`groups.generators[${index}]：auto-group 缺少 name`);
      }
      const selector = parseSelector(value.selector, `groups.generators[${index}].selector`, c);
      return selector ? { kind: "auto-group", name: value.name, selector } : null;
    }
    default:
      return c.fail(`groups.generators[${index}]：未知生成器类型 ${String(value.kind)}`);
  }
};

const parseCustomGroup = (value: unknown, index: number, c: Collector): CustomGroup | null => {
  if (!isRecord(value) || !isNonEmptyString(value.name)) {
    return c.fail(`groups.custom[${index}]：缺少 name`);
  }
  if (typeof value.type !== "string" || !GROUP_TYPES.has(value.type)) {
    return c.fail(`groups.custom[${index}]：type 必须是 select / url-test / fallback / load-balance`);
  }
  const membersRaw = Array.isArray(value.members) ? value.members : [];
  const members: GroupMember[] = [];
  for (const [memberIndex, member] of membersRaw.entries()) {
    const parsed = parseMember(member, `groups.custom[${index}].members[${memberIndex}]`, c);
    if (parsed) members.push(parsed);
  }
  return {
    name: value.name,
    type: value.type as CustomGroup["type"],
    members,
    ...(isRecord(value.options) ? { options: value.options } : {})
  };
};

const parseRuleEntry = (value: unknown, path: string, c: Collector): RuleEntry | null => {
  if (!isRecord(value)) {
    return c.fail(`${path}：规则条目必须是对象`);
  }
  if (!RULE_TYPES.includes(value.type as RuleType)) {
    return c.fail(`${path}：无效的规则类型 ${String(value.type)}`);
  }
  if (!isNonEmptyString(value.value)) {
    return c.fail(`${path}：规则缺少匹配值`);
  }
  if (value.value.includes(",")) {
    return c.fail(`${path}：匹配值不能包含逗号（${value.value}）`);
  }
  return {
    type: value.type as RuleType,
    value: value.value.trim(),
    ...(isNonEmptyString(value.extra) ? { extra: value.extra.trim() } : {})
  };
};

const parseRuleItem = (value: unknown, path: string, c: Collector): RuleItem | null => {
  if (!isRecord(value)) {
    return c.fail(`${path}：必须是对象`);
  }
  switch (value.kind) {
    case "snapshot": {
      if (!isNonEmptyString(value.catalogId) || !isNonEmptyString(value.hash) || !isNonEmptyString(value.slug)) {
        return c.fail(`${path}：snapshot 引用需要 catalogId、slug 与 hash`);
      }
      return {
        kind: "snapshot",
        catalogId: value.catalogId,
        slug: value.slug,
        hash: value.hash,
        emit: value.emit === "inline" ? "inline" : "provider"
      };
    }
    case "manual": {
      const entriesRaw = Array.isArray(value.entries) ? value.entries : [];
      const entries: RuleEntry[] = [];
      for (const [entryIndex, entry] of entriesRaw.entries()) {
        const parsed = parseRuleEntry(entry, `${path}.entries[${entryIndex}]`, c);
        if (parsed) entries.push(parsed);
      }
      return { kind: "manual", entries };
    }
    default:
      return c.fail(`${path}：未知规则项类型 ${String(value.kind)}`);
  }
};

const parseNodes = (value: unknown, c: Collector): NodesSection => {
  const section = isRecord(value) ? value : {};
  const transforms: NodeTransform[] = [];
  const overrides: NodeOverride[] = [];
  const custom: CustomNode[] = [];

  for (const [index, transform] of (Array.isArray(section.transforms) ? section.transforms : []).entries()) {
    const parsed = parseTransform(transform, index, c);
    if (parsed) transforms.push(parsed);
  }
  for (const [index, override] of (Array.isArray(section.overrides) ? section.overrides : []).entries()) {
    const parsed = parseOverride(override, index, c);
    if (parsed) overrides.push(parsed);
  }
  const seenOverrideIds = new Set<string>();
  for (const override of overrides) {
    if (seenOverrideIds.has(override.nodeId)) {
      c.fail(`nodes.overrides：节点 ${override.nodeId} 存在重复 override`);
    }
    seenOverrideIds.add(override.nodeId);
  }
  for (const [index, node] of (Array.isArray(section.custom) ? section.custom : []).entries()) {
    const parsed = parseCustomNode(node, index, c);
    if (parsed) custom.push(parsed);
  }
  const seenCustomIds = new Set<string>();
  for (const node of custom) {
    if (seenCustomIds.has(node.id)) {
      c.fail(`nodes.custom：自建节点 ${node.id} 重复`);
    }
    seenCustomIds.add(node.id);
  }

  return { transforms, overrides, custom };
};

const parseGroups = (value: unknown, c: Collector): GroupsSection => {
  const section = isRecord(value) ? value : {};
  const generators: GroupGenerator[] = [];
  const custom: CustomGroup[] = [];

  for (const [index, generator] of (Array.isArray(section.generators) ? section.generators : []).entries()) {
    const parsed = parseGenerator(generator, index, c);
    if (parsed) generators.push(parsed);
  }
  for (const [index, group] of (Array.isArray(section.custom) ? section.custom : []).entries()) {
    const parsed = parseCustomGroup(group, index, c);
    if (parsed) custom.push(parsed);
  }

  const names = new Set<string>();
  for (const generator of generators) {
    if (generator.kind !== "region-groups") {
      if (names.has(generator.name)) {
        c.fail(`groups：组名 ${generator.name} 重复`);
      }
      names.add(generator.name);
    }
  }
  for (const group of custom) {
    if (names.has(group.name)) {
      c.fail(`groups：组名 ${group.name} 重复`);
    }
    names.add(group.name);
  }

  const order = Array.isArray(section.order) ? section.order.filter(isNonEmptyString) : [];
  return { generators, custom, order };
};

const parseRules = (value: unknown, c: Collector): RulesSection => {
  const section = isRecord(value) ? value : {};
  let deliveryMode: RulesSection["deliveryMode"];
  if (section.deliveryMode !== undefined) {
    if (section.deliveryMode === "provider" || section.deliveryMode === "inline") {
      deliveryMode = section.deliveryMode;
    } else {
      c.fail("rules.deliveryMode：必须是 provider / inline");
    }
  }
  const targets: RuleTargetBlock[] = [];

  for (const [index, block] of (Array.isArray(section.targets) ? section.targets : []).entries()) {
    if (!isRecord(block) || !isNonEmptyString(block.target)) {
      c.fail(`rules.targets[${index}]：缺少 target`);
      continue;
    }
    const items: RuleItem[] = [];
    for (const [itemIndex, item] of (Array.isArray(block.items) ? block.items : []).entries()) {
      const parsed = parseRuleItem(item, `rules.targets[${index}].items[${itemIndex}]`, c);
      if (parsed) items.push(parsed);
    }
    targets.push({ target: block.target, items });
  }

  const seenTargets = new Set<string>();
  for (const block of targets) {
    if (seenTargets.has(block.target)) {
      c.fail(`rules.targets：目标 ${block.target} 出现多个块，请合并`);
    }
    seenTargets.add(block.target);
  }

  const prelude: PreludeRule[] = [];
  for (const [index, entry] of (Array.isArray(section.prelude) ? section.prelude : []).entries()) {
    const parsed = parseRuleEntry(entry, `rules.prelude[${index}]`, c);
    if (!parsed) continue;
    if (!isRecord(entry) || !isNonEmptyString(entry.target)) {
      c.fail(`rules.prelude[${index}]：前置规则必须指定 target`);
      continue;
    }
    prelude.push({ ...parsed, target: entry.target });
  }

  const finalRaw = isRecord(section.final) ? section.final : {};
  const final = { target: isNonEmptyString(finalRaw.target) ? finalRaw.target : "" };
  if (!final.target) {
    c.fail("rules.final：必须指定 MATCH 兜底目标");
  }

  const order = Array.isArray(section.order) ? section.order.filter(isNonEmptyString) : [];
  return { ...(deliveryMode ? { deliveryMode } : {}), targets, order, prelude, final };
};

const RAW_PATCH_FORBIDDEN_KEYS = ["proxies", "proxy-groups", "rules", "rule-providers"];

const parseConfig = (value: unknown, c: Collector): ConfigSection => {
  const section = isRecord(value) ? value : {};
  const structuredRaw = isRecord(section.structured) ? section.structured : {};

  const structured: ConfigSection["structured"] = {};
  if (isRecord(structuredRaw.ports)) {
    structured.ports = {};
    for (const key of ["mixedPort", "port", "socksPort"] as const) {
      const raw = structuredRaw.ports[key];
      if (raw !== undefined) {
        const parsed = Number(raw);
        if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
          c.fail(`config.structured.ports.${key}：必须是合法端口`);
        } else {
          structured.ports[key] = parsed;
        }
      }
    }
  }
  if (structuredRaw.mode !== undefined) {
    if (structuredRaw.mode === "rule" || structuredRaw.mode === "global" || structuredRaw.mode === "direct") {
      structured.mode = structuredRaw.mode;
    } else {
      c.fail("config.structured.mode：必须是 rule / global / direct");
    }
  }
  if (structuredRaw.logLevel !== undefined) {
    const levels = ["silent", "error", "warning", "info", "debug"];
    if (typeof structuredRaw.logLevel === "string" && levels.includes(structuredRaw.logLevel)) {
      structured.logLevel = structuredRaw.logLevel as NonNullable<ConfigSection["structured"]["logLevel"]>;
    } else {
      c.fail("config.structured.logLevel：无效的日志级别");
    }
  }
  if (structuredRaw.ipv6 !== undefined) {
    structured.ipv6 = structuredRaw.ipv6 === true;
  }
  for (const key of ["dns", "tun", "sniffer"] as const) {
    if (structuredRaw[key] !== undefined) {
      if (isRecord(structuredRaw[key])) {
        structured[key] = structuredRaw[key] as Record<string, unknown>;
      } else {
        c.fail(`config.structured.${key}：必须是对象`);
      }
    }
  }

  const rawPatch = isNonEmptyString(section.rawPatch) ? section.rawPatch : null;
  return { structured, rawPatch };
};

export const validateBuildConfig = (input: unknown): ValidationResult => {
  const c = new Collector();

  if (!isRecord(input)) {
    return { ok: false, errors: ["BuildConfig 必须是 JSON 对象"] };
  }
  if (input.version !== 1) {
    c.fail("version：当前仅支持 1");
  }
  const mode = input.mode === "patch" ? "patch" : input.mode === "rebuild" ? "rebuild" : null;
  if (!mode) {
    c.fail("mode：必须是 rebuild 或 patch");
  }

  const sources: SourceRef[] = [];
  for (const [index, source] of (Array.isArray(input.sources) ? input.sources : []).entries()) {
    const parsed = parseSourceRef(source, index, c);
    if (parsed) sources.push(parsed);
  }
  if (sources.length === 0) {
    c.fail("sources：至少需要一个订阅源");
  }
  if (mode === "patch" && sources.length > 1) {
    c.fail("sources：保留源配置（patch）模式只支持单一订阅源；多来源必须使用重组模式");
  }
  const seenSourceIds = new Set<string>();
  for (const source of sources) {
    if (seenSourceIds.has(source.sourceId)) {
      c.fail(`sources：订阅源 ${source.sourceId} 重复`);
    }
    seenSourceIds.add(source.sourceId);
  }

  const nodes = parseNodes(input.nodes, c);
  const groups = parseGroups(input.groups, c);
  const rules = parseRules(input.rules, c);
  const config = parseConfig(input.config, c);

  if (c.errors.length > 0) {
    return { ok: false, errors: c.errors };
  }

  return {
    ok: true,
    value: {
      version: 1,
      mode: mode!,
      sources,
      nodes,
      groups,
      rules,
      config
    }
  };
};

export { RAW_PATCH_FORBIDDEN_KEYS };
