import yaml from "js-yaml";
import { createHash } from "node:crypto";

import type { ClashProxyDocument, ProxyGroupEntry, ProxyNode } from "../../types";
import {
  type BuildConfig,
  type CustomGroup,
  type GroupMember,
  type NodeSelector,
  type NodeTransform,
  BUILTIN_POLICIES
} from "../build-config/types";
import { identifyNodes } from "../build-config/node-identity";
import { detectRegion, isRegionCode, REGION_CODES } from "./region";
import { emitClashYaml } from "./emit-yaml";

// 渲染管线 v2（技术方案 §5）：纯函数、无 IO、确定性。
// evaluate(BuildConfig, 源快照, 规则快照) → 文档 + YAML + issues + 统计。

export interface RulesetSnapshotData {
  hash: string;
  slug: string;
  behavior: "domain" | "ipcidr" | "classical";
  content: string; // 规范化 YAML payload 文本
  isPublic: boolean;
}

export interface EvaluateInput {
  buildConfig: BuildConfig;
  sourceSnapshots: Map<string, ClashProxyDocument>;
  sourceLabels: Map<string, string>;
  rulesetSnapshots: Map<string, RulesetSnapshotData>; // key = hash
  customNodeSecrets: Map<string, Record<string, unknown>>; // key = secretRef
  publicBaseUrl: string;
}

export interface EvaluateIssue {
  kind:
    | "dangling-node-ref"
    | "dangling-group-ref"
    | "dangling-rule-target"
    | "missing-source"
    | "missing-ruleset-snapshot"
    | "missing-secret"
    | "name-collision"
    | "empty-group"
    | "unclassified-nodes"
    | "invalid-raw-patch"
    | "inline-unsupported"
    | "structural";
  severity: "warn" | "error";
  message: string;
  refs: Record<string, string | string[]>;
}

export interface PoolNode {
  id: string;
  renderedName: string;
  document: ProxyNode; // 输出用文档（name 为最终名）
  sourceId: string | null; // null = 自建
  disabled: boolean;
  tags: string[];
  region: string | null; // 解析后的地区（override tag > 名称推断）
  protocol: string;
}

export interface EvaluateResult {
  document: ClashProxyDocument;
  yamlText: string;
  issues: EvaluateIssue[];
  stats: { nodeCount: number; groupCount: number; ruleCount: number; providerCount: number };
  nodeIndex: Array<{
    id: string;
    renderedName: string;
    sourceId: string | null;
    disabled: boolean;
    region: string | null;
    regionInferred: boolean;
    protocol: string;
    tags: string[];
  }>;
  // 渲染后完整代理组列表（含生成器产物与自定义组），供 UI 展开查看真实成员用
  groupIndex: Array<{ name: string; type: string; proxies: string[] }>;
  renderedHash: string;
}

export interface WorkspaceIndexResult {
  issues: EvaluateIssue[];
  stats: { nodeCount: number; groupCount: number };
  nodeIndex: EvaluateResult["nodeIndex"];
  groupIndex: EvaluateResult["groupIndex"];
}

const AUTO_TEST_URL = "https://www.gstatic.com/generate_204";
const AUTO_TEST_INTERVAL = 300;
const BUILTIN_SET = new Set<string>(BUILTIN_POLICIES);
const RAW_PATCH_FORBIDDEN = new Set(["proxies", "proxy-groups", "rules", "rule-providers"]);

const deepClone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

// ── 阶段 1：collect-nodes ────────────────────────────────────

const EMOJI_PATTERN =
  /[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu;
const MULTIPLIER_PATTERN = /\s*[\[(（]?\s*(?:x\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*[x×倍])\s*(?:倍率?)?\s*[\])）]?/gi;

const applyTransforms = (name: string, transforms: NodeTransform[]): string => {
  let result = name;
  for (const transform of transforms) {
    switch (transform.kind) {
      case "strip-emoji":
        result = result.replace(EMOJI_PATTERN, "");
        break;
      case "strip-multiplier":
        result = result.replace(MULTIPLIER_PATTERN, "");
        break;
      case "trim-whitespace":
        result = result.replace(/\s+/g, " ").trim();
        break;
      case "regex-replace":
        try {
          result = result.replace(new RegExp(transform.from, transform.flags ?? "g"), transform.to);
        } catch {
          // 校验器已拦截非法正则；此处静默跳过以保证纯函数不抛
        }
        break;
    }
  }
  const trimmed = result.trim();
  return trimmed.length > 0 ? trimmed : name;
};

export const collectNodes = (
  input: EvaluateInput,
  issues: EvaluateIssue[]
): PoolNode[] => {
  const { buildConfig } = input;
  const pool: PoolNode[] = [];
  const overridesById = new Map(buildConfig.nodes.overrides.map((o) => [o.nodeId, o] as const));

  for (const sourceRef of buildConfig.sources) {
    if (!sourceRef.enabled) continue;
    const snapshot = input.sourceSnapshots.get(sourceRef.sourceId);
    if (!snapshot) {
      issues.push({
        kind: "missing-source",
        severity: "error",
        message: `订阅源 ${input.sourceLabels.get(sourceRef.sourceId) ?? sourceRef.sourceId} 没有可用的成功快照。`,
        refs: { sourceId: sourceRef.sourceId }
      });
      continue;
    }
    const identified = identifyNodes(Array.isArray(snapshot.proxies) ? snapshot.proxies : []);
    for (const { id, node } of identified) {
      const override = overridesById.get(id);
      const baseName = typeof node.name === "string" ? node.name : "";
      const transformed = applyTransforms(baseName, buildConfig.nodes.transforms);
      const renderedName = override?.rename ?? transformed;
      const tags = override?.tags ?? [];
      const regionTag = tags.find(isRegionCode) ?? null;
      pool.push({
        id,
        renderedName,
        document: { ...deepClone(node), name: renderedName },
        sourceId: sourceRef.sourceId,
        disabled: override?.disabled === true,
        tags,
        region: regionTag ?? detectRegion(renderedName),
        protocol: typeof node.type === "string" ? node.type : ""
      });
    }
  }

  for (const custom of buildConfig.nodes.custom) {
    const secretFields = custom.secretRef
      ? input.customNodeSecrets.get(custom.secretRef)
      : undefined;
    if (custom.secretRef && !secretFields) {
      issues.push({
        kind: "missing-secret",
        severity: "error",
        message: `自建节点「${custom.name}」的敏感字段（secretRef=${custom.secretRef}）不存在，无法渲染。`,
        refs: { nodeId: custom.id }
      });
      continue;
    }
    const tags = custom.tags ?? [];
    const regionTag = tags.find(isRegionCode) ?? null;
    pool.push({
      id: custom.id,
      renderedName: custom.name,
      document: {
        name: custom.name,
        type: custom.type,
        server: custom.server,
        port: custom.port,
        ...deepClone(custom.extra),
        ...(secretFields ? deepClone(secretFields) : {})
      },
      sourceId: null,
      disabled: false,
      tags,
      region: regionTag ?? detectRegion(custom.name),
      protocol: custom.type
    });
  }

  // 输出名冲突处理：后出现者加源标签前缀，仍冲突则追加序号
  const seenNames = new Map<string, number>();
  for (const node of pool) {
    if (node.disabled) continue;
    if (!seenNames.has(node.renderedName)) {
      seenNames.set(node.renderedName, 1);
      continue;
    }
    const original = node.renderedName;
    const label = node.sourceId ? input.sourceLabels.get(node.sourceId) ?? "src" : "自建";
    let candidate = `${label}-${original}`;
    while (seenNames.has(candidate)) {
      const count = (seenNames.get(original) ?? 1) + 1;
      seenNames.set(original, count);
      candidate = `${label}-${original}#${count}`;
    }
    seenNames.set(candidate, 1);
    node.renderedName = candidate;
    node.document.name = candidate;
    issues.push({
      kind: "name-collision",
      severity: "warn",
      message: `节点名「${original}」重复，已将后出现者重命名为「${candidate}」。`,
      refs: { nodeId: node.id }
    });
  }

  return pool;
};

// ── 阶段 2：generate-groups ──────────────────────────────────

const expandSelector = (selector: NodeSelector, pool: PoolNode[]): PoolNode[] => {
  const enabled = pool.filter((node) => !node.disabled);
  switch (selector.kind) {
    case "all-enabled":
      return enabled;
    case "custom-only":
      return enabled.filter((node) => node.sourceId === null);
    case "region":
      return enabled.filter((node) => node.region === selector.region);
    case "tag":
      return enabled.filter((node) => node.tags.includes(selector.tag));
    case "protocol":
      return enabled.filter((node) => node.protocol === selector.protocol);
  }
};

interface GroupBuild {
  entry: ProxyGroupEntry;
  origin: "generator" | "custom";
}

export const generateGroups = (
  input: EvaluateInput,
  pool: PoolNode[],
  issues: EvaluateIssue[]
): { groups: ProxyGroupEntry[]; groupNames: Set<string> } => {
  const { buildConfig } = input;
  const enabledNodes = pool.filter((node) => !node.disabled);
  const builds: GroupBuild[] = [];
  const regionGroupNames: string[] = [];
  let autoGroupName: string | null = null;
  let proxiesRoot: { name: string; includeAuto: boolean; extraMembers: GroupMember[] } | null =
    null;

  for (const generator of buildConfig.groups.generators) {
    if (generator.kind === "region-groups") {
      const overrides = generator.regionOverrides ?? {};
      const buckets = new Map<string, PoolNode[]>();
      const unclassified: PoolNode[] = [];
      for (const node of enabledNodes) {
        const region = overrides[node.id] ?? node.region;
        if (region && isRegionCode(region)) {
          const bucket = buckets.get(region) ?? [];
          bucket.push(node);
          buckets.set(region, bucket);
        } else {
          unclassified.push(node);
        }
      }
      for (const code of REGION_CODES) {
        const bucket = buckets.get(code);
        if (!bucket || bucket.length === 0) continue;
        regionGroupNames.push(code);
        builds.push({
          origin: "generator",
          entry:
            generator.groupType === "url-test"
              ? {
                  name: code,
                  type: "url-test",
                  proxies: bucket.map((node) => node.renderedName),
                  url: AUTO_TEST_URL,
                  interval: AUTO_TEST_INTERVAL
                }
              : {
                  name: code,
                  type: "select",
                  proxies: bucket.map((node) => node.renderedName)
                }
        });
      }
      if (unclassified.length > 0) {
        if (generator.unclassified === "others") {
          regionGroupNames.push("Others");
          builds.push({
            origin: "generator",
            entry: {
              name: "Others",
              type: "select",
              proxies: unclassified.map((node) => node.renderedName)
            }
          });
        }
        issues.push({
          kind: "unclassified-nodes",
          severity: "warn",
          message: `${unclassified.length} 个节点未识别到地区（${generator.unclassified === "others" ? "已归入 Others" : "已忽略"}）。可在节点页确认地区标签。`,
          refs: { nodeIds: unclassified.map((node) => node.id) }
        });
      }
      continue;
    }

    if (generator.kind === "auto-group") {
      const members = expandSelector(generator.selector, pool).map((node) => node.renderedName);
      autoGroupName = generator.name;
      builds.push({
        origin: "generator",
        entry: {
          name: generator.name,
          type: "url-test",
          proxies: members,
          url: AUTO_TEST_URL,
          interval: AUTO_TEST_INTERVAL
        }
      });
      continue;
    }

    // proxies-root：成员在所有组收集完后再组装
    proxiesRoot = {
      name: generator.name,
      includeAuto: generator.includeAuto,
      extraMembers: generator.extraMembers
    };
  }

  // includeAuto 且没有显式 auto-group：自动补一个 Auto
  if (proxiesRoot?.includeAuto && !autoGroupName) {
    autoGroupName = "Auto";
    builds.push({
      origin: "generator",
      entry: {
        name: "Auto",
        type: "url-test",
        proxies: enabledNodes.map((node) => node.renderedName),
        url: AUTO_TEST_URL,
        interval: AUTO_TEST_INTERVAL
      }
    });
  }

  const nodeById = new Map(pool.map((node) => [node.id, node] as const));
  const knownGroupNames = new Set<string>([
    ...builds.map((build) => build.entry.name),
    ...(proxiesRoot ? [proxiesRoot.name] : []),
    ...buildConfig.groups.custom.map((group) => group.name)
  ]);

  const expandMembers = (members: GroupMember[], owner: string): string[] => {
    const result: string[] = [];
    for (const member of members) {
      switch (member.kind) {
        case "node": {
          const node = nodeById.get(member.nodeId);
          if (!node || node.disabled) {
            issues.push({
              kind: "dangling-node-ref",
              severity: "error",
              message: `代理组「${owner}」引用的节点（${member.nodeId}）${node ? "已被禁用" : "已不存在"}。`,
              refs: { group: owner, nodeId: member.nodeId }
            });
            continue;
          }
          result.push(node.renderedName);
          break;
        }
        case "group":
          if (!knownGroupNames.has(member.name)) {
            // 地区码/Others 是按节点动态生成的：当前没有该地区节点是正常状态，静默跳过而非报错
            if (isRegionCode(member.name) || member.name === "Others") continue;
            issues.push({
              kind: "dangling-group-ref",
              severity: "error",
              message: `代理组「${owner}」引用的代理组「${member.name}」不存在。`,
              refs: { group: owner, target: member.name }
            });
            continue;
          }
          result.push(member.name);
          break;
        case "selector":
          result.push(...expandSelector(member.selector, pool).map((node) => node.renderedName));
          break;
        case "builtin":
          result.push(member.policy);
          break;
      }
    }
    // 去重保序
    return [...new Set(result)];
  };

  const buildCustomGroup = (group: CustomGroup): ProxyGroupEntry => {
    const proxies = expandMembers(group.members, group.name);
    const entry: ProxyGroupEntry = {
      name: group.name,
      type: group.type,
      proxies,
      ...(group.options ? deepClone(group.options) : {})
    };
    if ((group.type === "url-test" || group.type === "fallback" || group.type === "load-balance") && entry.url === undefined) {
      entry.url = AUTO_TEST_URL;
      entry.interval = AUTO_TEST_INTERVAL;
    }
    return entry;
  };

  for (const group of buildConfig.groups.custom) {
    builds.push({ origin: "custom", entry: buildCustomGroup(group) });
  }

  // proxies-root 最后组装：地区组 + Auto + 额外成员 + 全部启用节点 + DIRECT
  if (proxiesRoot) {
    const members: string[] = [
      ...regionGroupNames,
      ...(autoGroupName ? [autoGroupName] : []),
      ...expandMembers(proxiesRoot.extraMembers, proxiesRoot.name),
      ...enabledNodes.map((node) => node.renderedName),
      "DIRECT"
    ];
    builds.unshift({
      origin: "generator",
      entry: {
        name: proxiesRoot.name,
        type: "select",
        proxies: [...new Set(members)]
      }
    });
  }

  for (const build of builds) {
    if (build.entry.proxies.length === 0) {
      issues.push({
        kind: "empty-group",
        severity: "error",
        message: `代理组「${build.entry.name}」没有任何成员，无法生成合法配置。`,
        refs: { group: build.entry.name }
      });
    }
  }

  // 排序：order 中列出的在前（按 order 顺序），其余按生成顺序
  const order = buildConfig.groups.order;
  const byName = new Map(builds.map((build) => [build.entry.name, build] as const));
  const ordered: ProxyGroupEntry[] = [];
  const consumed = new Set<string>();
  for (const name of order) {
    const build = byName.get(name);
    if (build && !consumed.has(name)) {
      ordered.push(build.entry);
      consumed.add(name);
    }
  }
  for (const build of builds) {
    if (!consumed.has(build.entry.name)) {
      ordered.push(build.entry);
      consumed.add(build.entry.name);
    }
  }

  return { groups: ordered, groupNames: new Set(ordered.map((group) => group.name)) };
};

// ── 阶段 3：assemble-rules ───────────────────────────────────

interface RulesBuild {
  rules: string[];
  providers: Record<string, Record<string, unknown>>;
}

const parsePayloadEntries = (content: string): string[] => {
  try {
    const parsed = yaml.load(content);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      Array.isArray((parsed as Record<string, unknown>).payload)
    ) {
      return ((parsed as Record<string, unknown>).payload as unknown[])
        .map((entry) => String(entry))
        .filter((entry) => entry.trim().length > 0);
    }
  } catch {
    // fallthrough
  }
  return [];
};

const inlineRulesFromSnapshot = (
  snapshot: RulesetSnapshotData,
  target: string
): { rules: string[]; unsupported: string[] } => {
  const entries = parsePayloadEntries(snapshot.content);
  const rules: string[] = [];
  const unsupported: string[] = [];

  for (const entry of entries) {
    if (snapshot.behavior === "classical") {
      const parts = entry.split(",").map((part) => part.trim());
      const modifiers: string[] = [];
      while (parts.length > 2) {
        const tail = parts[parts.length - 1]!.toLowerCase();
        if (tail !== "no-resolve" && tail !== "src") break;
        modifiers.unshift(parts.pop()!);
      }
      rules.push(
        `${parts.join(",")},${target}${modifiers.length > 0 ? `,${modifiers.join(",")}` : ""}`
      );
      continue;
    }
    if (snapshot.behavior === "ipcidr") {
      rules.push(entry.includes(":") ? `IP-CIDR6,${entry},${target}` : `IP-CIDR,${entry},${target}`);
      continue;
    }
    // domain behavior
    if (entry.startsWith("+.")) {
      rules.push(`DOMAIN-SUFFIX,${entry.slice(2)},${target}`);
    } else if (!entry.includes("*")) {
      rules.push(`DOMAIN,${entry},${target}`);
    } else {
      unsupported.push(entry);
    }
  }

  return { rules, unsupported };
};

export const assembleRules = (
  input: EvaluateInput,
  groupNames: Set<string>,
  issues: EvaluateIssue[]
): RulesBuild => {
  const { buildConfig } = input;
  const rules: string[] = [];
  const providers: Record<string, Record<string, unknown>> = {};
  const providerSlugByHash = new Map<string, string>();

  const targetExists = (target: string) => groupNames.has(target) || BUILTIN_SET.has(target);

  for (const prelude of buildConfig.rules.prelude) {
    if (!targetExists(prelude.target)) {
      issues.push({
        kind: "dangling-rule-target",
        severity: "error",
        message: `前置规则「${prelude.type},${prelude.value}」指向不存在的目标「${prelude.target}」。`,
        refs: { target: prelude.target }
      });
      continue;
    }
    rules.push(
      `${prelude.type},${prelude.value},${prelude.target}${prelude.extra ? `,${prelude.extra}` : ""}`
    );
  }

  const blocksByTarget = new Map(
    buildConfig.rules.targets.map((block) => [block.target, block] as const)
  );
  const orderedTargets = [
    ...buildConfig.rules.order.filter((target) => blocksByTarget.has(target)),
    ...buildConfig.rules.targets
      .map((block) => block.target)
      .filter((target) => !buildConfig.rules.order.includes(target))
  ];

  for (const targetName of orderedTargets) {
    const block = blocksByTarget.get(targetName)!;
    if (!targetExists(block.target)) {
      issues.push({
        kind: "dangling-rule-target",
        severity: "error",
        message: `规则块指向不存在的目标「${block.target}」，整块已跳过。删除该组前请先处理其规则。`,
        refs: { target: block.target }
      });
      continue;
    }

    for (const item of block.items) {
      if (item.kind === "manual") {
        for (const entry of item.entries) {
          rules.push(
            `${entry.type},${entry.value},${block.target}${entry.extra ? `,${entry.extra}` : ""}`
          );
        }
        continue;
      }

      const snapshot = input.rulesetSnapshots.get(item.hash);
      if (!snapshot) {
        issues.push({
          kind: "missing-ruleset-snapshot",
          severity: "error",
          message: `规则快照 ${item.slug}@${item.hash.slice(0, 8)} 不存在，无法渲染目标「${block.target}」的该项。`,
          refs: { target: block.target, hash: item.hash }
        });
        continue;
      }

      const deliveryMode = buildConfig.rules.deliveryMode ?? item.emit;
      if (deliveryMode === "inline" || !snapshot.isPublic) {
        const { rules: inlined, unsupported } = inlineRulesFromSnapshot(snapshot, block.target);
        rules.push(...inlined);
        if (unsupported.length > 0) {
          issues.push({
            kind: "inline-unsupported",
            severity: "error",
            message: `规则快照 ${item.slug} 有 ${unsupported.length} 条通配符条目无法安全内联。请改用远程规则文件，或修正规则源后再发布。`,
            refs: { hash: item.hash, entries: unsupported.slice(0, 5) }
          });
        }
        continue;
      }

      // provider 模式：同 slug 不同 hash 时用完整 hash 去重，避免短前缀碰撞。
      let slug = providerSlugByHash.get(item.hash);
      if (!slug) {
        slug = item.slug;
        const taken = Object.keys(providers).some(
          (existing) => existing === slug && providerSlugByHash.get(item.hash) !== slug
        );
        if (providers[slug] && taken) {
          slug = `${item.slug}-${item.hash}`;
        }
        providerSlugByHash.set(item.hash, slug);
        providers[slug] = {
          type: "http",
          behavior: snapshot.behavior,
          format: "yaml",
          url: `${input.publicBaseUrl}/rs/${item.hash}.yaml`,
          // URL 和本地缓存路径必须同时内容寻址。Mihomo 会优先复用已存在的
          // path；若 path 只含 slug，订阅切到新快照 URL 后仍可能永久读取旧规则。
          path: `./rule-providers/${item.hash}.yaml`
        };
      }
      rules.push(`RULE-SET,${slug},${block.target}`);
    }
  }

  if (!targetExists(buildConfig.rules.final.target)) {
    issues.push({
      kind: "dangling-rule-target",
      severity: "error",
      message: `MATCH 兜底目标「${buildConfig.rules.final.target}」不存在。`,
      refs: { target: buildConfig.rules.final.target }
    });
  } else {
    rules.push(`MATCH,${buildConfig.rules.final.target}`);
  }

  return { rules: [...new Set(rules)], providers };
};

// ── 阶段 4：apply-config ─────────────────────────────────────

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const deepMerge = (
  base: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> => {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (isRecord(value) && isRecord(result[key])) {
      result[key] = deepMerge(result[key] as Record<string, unknown>, value);
    } else {
      result[key] = deepClone(value);
    }
  }
  return result;
};

export const applyConfig = (
  input: EvaluateInput,
  base: Record<string, unknown>,
  issues: EvaluateIssue[]
): Record<string, unknown> => {
  const { structured, rawPatch } = input.buildConfig.config;
  let document = { ...base };

  if (structured.ports?.mixedPort !== undefined) document["mixed-port"] = structured.ports.mixedPort;
  if (structured.ports?.port !== undefined) document.port = structured.ports.port;
  if (structured.ports?.socksPort !== undefined) document["socks-port"] = structured.ports.socksPort;
  if (structured.mode !== undefined) document.mode = structured.mode;
  if (structured.logLevel !== undefined) document["log-level"] = structured.logLevel;
  if (structured.ipv6 !== undefined) document.ipv6 = structured.ipv6;
  if (structured.dns !== undefined) document.dns = deepClone(structured.dns);
  if (structured.tun !== undefined) document.tun = deepClone(structured.tun);
  if (structured.sniffer !== undefined) document.sniffer = deepClone(structured.sniffer);

  if (rawPatch) {
    try {
      const parsed = yaml.load(rawPatch);
      if (!isRecord(parsed)) {
        issues.push({
          kind: "invalid-raw-patch",
          severity: "error",
          message: "配置补丁必须是 YAML 对象。",
          refs: {}
        });
      } else {
        const forbidden = Object.keys(parsed).filter((key) => RAW_PATCH_FORBIDDEN.has(key));
        if (forbidden.length > 0) {
          issues.push({
            kind: "invalid-raw-patch",
            severity: "error",
            message: `配置补丁不允许修改 ${forbidden.join("、")}——请在对应模块中编辑。`,
            refs: { keys: forbidden }
          });
        } else {
          document = deepMerge(document, parsed);
        }
      }
    } catch (error) {
      issues.push({
        kind: "invalid-raw-patch",
        severity: "error",
        message: `配置补丁不是合法 YAML：${error instanceof Error ? error.message : String(error)}`,
        refs: {}
      });
    }
  }

  return document;
};

// ── 阶段 6：validate-structural ──────────────────────────────

export const validateStructural = (
  document: ClashProxyDocument,
  issues: EvaluateIssue[]
) => {
  const proxyNames = new Set<string>();
  for (const proxy of document.proxies) {
    if (proxyNames.has(proxy.name)) {
      issues.push({
        kind: "structural",
        severity: "error",
        message: `节点名「${proxy.name}」重复。`,
        refs: { name: proxy.name }
      });
    }
    proxyNames.add(proxy.name);
  }

  const groupNames = new Set<string>();
  for (const group of document["proxy-groups"]) {
    if (groupNames.has(group.name) || proxyNames.has(group.name)) {
      issues.push({
        kind: "structural",
        severity: "error",
        message: `代理组名「${group.name}」与其他节点或组重名。`,
        refs: { name: group.name }
      });
    }
    groupNames.add(group.name);
  }

  const providers = isRecord(document["rule-providers"])
    ? new Set(Object.keys(document["rule-providers"] as Record<string, unknown>))
    : new Set<string>();

  for (const group of document["proxy-groups"]) {
    for (const member of group.proxies) {
      if (BUILTIN_SET.has(member)) continue;
      if (!proxyNames.has(member) && !groupNames.has(member)) {
        issues.push({
          kind: "structural",
          severity: "error",
          message: `代理组「${group.name}」引用了不存在的成员「${member}」。`,
          refs: { group: group.name, member }
        });
      }
    }
  }

  const rules = document.rules ?? [];
  rules.forEach((rule, index) => {
    const parts = rule.split(",");
    if (parts[0] === "RULE-SET" && parts[1] && !providers.has(parts[1])) {
      issues.push({
        kind: "structural",
        severity: "error",
        message: `规则 ${rule} 引用了不存在的 rule-provider「${parts[1]}」。`,
        refs: { rule }
      });
    }
    if (parts[0] === "MATCH" && index !== rules.length - 1) {
      issues.push({
        kind: "structural",
        severity: "error",
        message: "MATCH 兜底规则必须位于最后。",
        refs: { rule }
      });
    }
    const target =
      parts[0] === "MATCH" ? parts[1] : parts.length >= 3 ? parts[2] : undefined;
    if (
      target &&
      target !== "no-resolve" &&
      !BUILTIN_SET.has(target) &&
      !groupNames.has(target)
    ) {
      issues.push({
        kind: "structural",
        severity: "error",
        message: `规则 ${rule} 指向不存在的目标「${target}」。`,
        refs: { rule }
      });
    }
  });

  if (rules.length > 0 && !rules[rules.length - 1]!.startsWith("MATCH,")) {
    issues.push({
      kind: "structural",
      severity: "warn",
      message: "缺少 MATCH 兜底规则，未匹配流量的行为将由客户端决定。",
      refs: {}
    });
  }
};

// ── patch 模式支路 ───────────────────────────────────────────

const evaluatePatchMode = (
  input: EvaluateInput,
  issues: EvaluateIssue[],
  includeRules = true
): { document: ClashProxyDocument; pool: PoolNode[] } => {
  const { buildConfig } = input;
  const sourceRef = buildConfig.sources[0]!;
  const snapshot = input.sourceSnapshots.get(sourceRef.sourceId);
  if (!snapshot) {
    issues.push({
      kind: "missing-source",
      severity: "error",
      message: "订阅源没有可用的成功快照，无法渲染。",
      refs: { sourceId: sourceRef.sourceId }
    });
    return {
      document: { proxies: [], "proxy-groups": [], rules: [] },
      pool: []
    };
  }

  // 工作区的自动索引只关心节点与组。不要复制（更不要后续组装）可能非常大的
  // 源规则；完整 preview/publish 仍走 includeRules=true 的确定性管线。
  const document = includeRules
    ? deepClone(snapshot)
    : {
        proxies: deepClone(Array.isArray(snapshot.proxies) ? snapshot.proxies : []),
        "proxy-groups": deepClone(
          Array.isArray(snapshot["proxy-groups"]) ? snapshot["proxy-groups"] : []
        ),
        rules: []
      };
  document.proxies = Array.isArray(document.proxies) ? document.proxies : [];
  document["proxy-groups"] = Array.isArray(document["proxy-groups"])
    ? document["proxy-groups"]
    : [];
  document.rules = Array.isArray(document.rules) ? document.rules : [];

  const pool = collectNodes(input, issues);
  const renameByOldName = new Map<string, string>();
  const removedNames = new Set<string>();

  // 用 pool 的结果替换 proxies：保留源顺序，应用改名/禁用，追加自建
  const nativeById = new Map(
    pool.filter((node) => node.sourceId !== null).map((node) => [node.id, node] as const)
  );
  const identified = identifyNodes(document.proxies);
  const nextProxies: ProxyNode[] = [];
  for (const { id, node } of identified) {
    const poolNode = nativeById.get(id);
    if (!poolNode) continue;
    if (poolNode.disabled) {
      removedNames.add(String(node.name));
      continue;
    }
    if (poolNode.renderedName !== node.name) {
      renameByOldName.set(String(node.name), poolNode.renderedName);
    }
    nextProxies.push(poolNode.document);
  }
  for (const node of pool.filter((candidate) => candidate.sourceId === null)) {
    nextProxies.push(node.document);
  }
  document.proxies = nextProxies;

  // 改名/删除传播到源代理组成员
  document["proxy-groups"] = document["proxy-groups"].map((group) => ({
    ...group,
    proxies: group.proxies
      .map((member) => renameByOldName.get(member) ?? member)
      .filter((member) => !removedNames.has(member))
  }));

  for (const group of document["proxy-groups"]) {
    if (group.proxies.length === 0) {
      issues.push({
        kind: "empty-group",
        severity: "error",
        message: `禁用节点后，源代理组「${group.name}」已无成员。`,
        refs: { group: group.name }
      });
    }
  }

  // 追加自定义组（成员按现有名字空间解析）
  const knownNames = new Set<string>([
    ...document.proxies.map((proxy) => String(proxy.name)),
    ...document["proxy-groups"].map((group) => group.name)
  ]);
  for (const custom of buildConfig.groups.custom) {
    const members: string[] = [];
    for (const member of custom.members) {
      if (member.kind === "builtin") {
        members.push(member.policy);
      } else if (member.kind === "group") {
        if (knownNames.has(member.name)) {
          members.push(member.name);
        } else if (isRegionCode(member.name) || member.name === "Others") {
          // 地区码/Others 是按节点动态生成的：当前没有该地区节点是正常状态，静默跳过而非报错
        } else {
          issues.push({
            kind: "dangling-group-ref",
            severity: "error",
            message: `代理组「${custom.name}」引用的「${member.name}」不存在。`,
            refs: { group: custom.name, target: member.name }
          });
        }
      } else if (member.kind === "node") {
        const node = pool.find((candidate) => candidate.id === member.nodeId && !candidate.disabled);
        if (node) {
          members.push(node.renderedName);
        } else {
          issues.push({
            kind: "dangling-node-ref",
            severity: "error",
            message: `代理组「${custom.name}」引用的节点已不存在或被禁用。`,
            refs: { group: custom.name, nodeId: member.nodeId }
          });
        }
      } else {
        members.push(...expandSelector(member.selector, pool).map((node) => node.renderedName));
      }
    }
    document["proxy-groups"].push({
      name: custom.name,
      type: custom.type,
      proxies: [...new Set(members)],
      ...(custom.options ? deepClone(custom.options) : {})
    });
  }

  if (includeRules) {
    // 规则：我们的块插入在源 MATCH 之前
    const groupNames = new Set(document["proxy-groups"].map((group) => group.name));
    const ourRules = assembleRules(input, groupNames, issues);
    // patch 模式不使用我们的 MATCH（保留源兜底）
    const ourLines = ourRules.rules.filter((rule) => !rule.startsWith("MATCH,"));
    const sourceRules = document.rules;
    const matchIndex = sourceRules.findIndex((rule) => rule.startsWith("MATCH,"));
    document.rules =
      matchIndex >= 0
        ? [...sourceRules.slice(0, matchIndex), ...ourLines, ...sourceRules.slice(matchIndex)]
        : [...sourceRules, ...ourLines];

    if (Object.keys(ourRules.providers).length > 0) {
      const existing = isRecord(document["rule-providers"])
        ? (document["rule-providers"] as Record<string, unknown>)
        : {};
      document["rule-providers"] = { ...existing, ...ourRules.providers };
    }
  }

  return { document, pool };
};

// ── 入口 ─────────────────────────────────────────────────────

const DEFAULT_BASE: Record<string, unknown> = {
  "mixed-port": 7890,
  mode: "rule",
  "log-level": "info"
};

const nodeIndexFromPool = (pool: PoolNode[]): EvaluateResult["nodeIndex"] =>
  pool.map((node) => ({
    id: node.id,
    renderedName: node.renderedName,
    sourceId: node.sourceId,
    disabled: node.disabled,
    region: node.region,
    regionInferred: !(node.tags.find(isRegionCode) ?? null),
    protocol: node.protocol,
    tags: node.tags
  }));

const groupIndexFromDocument = (
  document: ClashProxyDocument
): EvaluateResult["groupIndex"] =>
  (document["proxy-groups"] ?? []).map((group) => ({
    name: group.name,
    type: group.type,
    proxies: group.proxies
  }));

// 工作区自动刷新专用的轻量路径。它刻意不调用 assembleRules/applyConfig/
// emitClashYaml，也不需要 rulesetSnapshots 中存在任何正文。
export const evaluateWorkspaceIndex = (input: EvaluateInput): WorkspaceIndexResult => {
  const issues: EvaluateIssue[] = [];
  let document: ClashProxyDocument;
  let pool: PoolNode[];

  if (input.buildConfig.mode === "patch") {
    const patched = evaluatePatchMode(input, issues, false);
    document = patched.document;
    pool = patched.pool;
  } else {
    pool = collectNodes(input, issues);
    const { groups } = generateGroups(input, pool, issues);
    document = {
      proxies: pool.filter((node) => !node.disabled).map((node) => node.document),
      "proxy-groups": groups,
      rules: []
    };
  }

  // 只验证节点/组名字空间与成员引用；空 rules 可确保不会进入规则校验成本。
  validateStructural(document, issues);
  return {
    issues,
    stats: {
      nodeCount: document.proxies.length,
      groupCount: document["proxy-groups"].length
    },
    nodeIndex: nodeIndexFromPool(pool),
    groupIndex: groupIndexFromDocument(document)
  };
};

export const evaluate = (input: EvaluateInput): EvaluateResult => {
  const issues: EvaluateIssue[] = [];
  let document: ClashProxyDocument;
  let pool: PoolNode[];

  if (input.buildConfig.mode === "patch") {
    const patched = evaluatePatchMode(input, issues);
    const withConfig = applyConfig(input, patched.document as Record<string, unknown>, issues);
    document = withConfig as unknown as ClashProxyDocument;
    pool = patched.pool;
  } else {
    pool = collectNodes(input, issues);
    const { groups, groupNames } = generateGroups(input, pool, issues);
    const rulesBuild = assembleRules(input, groupNames, issues);
    const base = applyConfig(input, { ...DEFAULT_BASE }, issues);
    document = {
      ...base,
      proxies: pool.filter((node) => !node.disabled).map((node) => node.document),
      "proxy-groups": groups,
      rules: rulesBuild.rules
    } as ClashProxyDocument;
    if (Object.keys(rulesBuild.providers).length > 0) {
      document["rule-providers"] = rulesBuild.providers;
    }
  }

  validateStructural(document, issues);

  const yamlText = emitClashYaml(document as unknown as Record<string, unknown>);
  const providerCount = isRecord(document["rule-providers"])
    ? Object.keys(document["rule-providers"] as Record<string, unknown>).length
    : 0;

  return {
    document,
    yamlText,
    issues,
    stats: {
      nodeCount: document.proxies.length,
      groupCount: document["proxy-groups"].length,
      ruleCount: document.rules?.length ?? 0,
      providerCount
    },
    nodeIndex: nodeIndexFromPool(pool),
    groupIndex: groupIndexFromDocument(document),
    renderedHash: createHash("sha256").update(yamlText).digest("hex")
  };
};
