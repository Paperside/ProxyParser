import type { ClashProxyDocument } from "../../types";
import { identifyNodes } from "../build-config/node-identity";

// 版本 diff 摘要（技术方案 §6.3）：结构化对比两个渲染文档，
// 存入 releases.diff_summary，前端直接渲染。

export interface DiffSummary {
  nodes: {
    added: string[]; // 渲染名
    removed: string[];
    renamed: Array<{ from: string; to: string }>;
    updated: string[]; // 同 ID 字段变化（如凭据轮换）
  };
  groups: {
    added: string[];
    removed: string[];
    membersChanged: string[];
  };
  ruleCountDelta: number;
  configKeysChanged: string[];
  identical: boolean;
}

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

export const diffDocuments = (
  previous: ClashProxyDocument | null,
  next: ClashProxyDocument
): DiffSummary => {
  const summary: DiffSummary = {
    nodes: { added: [], removed: [], renamed: [], updated: [] },
    groups: { added: [], removed: [], membersChanged: [] },
    ruleCountDelta: 0,
    configKeysChanged: [],
    identical: false
  };

  const prevNodes = previous ? identifyNodes(previous.proxies ?? []) : [];
  const nextNodes = identifyNodes(next.proxies ?? []);
  const prevById = new Map(prevNodes.map((item) => [item.id, item.node] as const));
  const nextById = new Map(nextNodes.map((item) => [item.id, item.node] as const));

  for (const { id, node } of nextNodes) {
    const before = prevById.get(id);
    if (!before) {
      summary.nodes.added.push(String(node.name));
      continue;
    }
    if (String(before.name) !== String(node.name)) {
      summary.nodes.renamed.push({ from: String(before.name), to: String(node.name) });
    } else if (stableStringify(before) !== stableStringify(node)) {
      summary.nodes.updated.push(String(node.name));
    }
  }
  for (const { id, node } of prevNodes) {
    if (!nextById.has(id)) {
      summary.nodes.removed.push(String(node.name));
    }
  }

  const prevGroups = new Map(
    (previous?.["proxy-groups"] ?? []).map((group) => [group.name, group] as const)
  );
  const nextGroups = new Map(
    (next["proxy-groups"] ?? []).map((group) => [group.name, group] as const)
  );
  for (const [name, group] of nextGroups) {
    const before = prevGroups.get(name);
    if (!before) {
      summary.groups.added.push(name);
    } else if (stableStringify(before.proxies) !== stableStringify(group.proxies)) {
      summary.groups.membersChanged.push(name);
    }
  }
  for (const name of prevGroups.keys()) {
    if (!nextGroups.has(name)) {
      summary.groups.removed.push(name);
    }
  }

  summary.ruleCountDelta = (next.rules?.length ?? 0) - (previous?.rules?.length ?? 0);

  const configKeys = new Set<string>();
  const skip = new Set(["proxies", "proxy-groups", "rules"]);
  const prevConfig = (previous ?? {}) as Record<string, unknown>;
  const nextConfig = next as unknown as Record<string, unknown>;
  for (const key of new Set([...Object.keys(prevConfig), ...Object.keys(nextConfig)])) {
    if (skip.has(key)) continue;
    if (stableStringify(prevConfig[key]) !== stableStringify(nextConfig[key])) {
      configKeys.add(key);
    }
  }
  summary.configKeysChanged = [...configKeys].sort();

  summary.identical =
    previous !== null &&
    summary.nodes.added.length === 0 &&
    summary.nodes.removed.length === 0 &&
    summary.nodes.renamed.length === 0 &&
    summary.nodes.updated.length === 0 &&
    summary.groups.added.length === 0 &&
    summary.groups.removed.length === 0 &&
    summary.groups.membersChanged.length === 0 &&
    summary.ruleCountDelta === 0 &&
    summary.configKeysChanged.length === 0 &&
    stableStringify(previous?.rules ?? []) === stableStringify(next.rules ?? []);

  return summary;
};
