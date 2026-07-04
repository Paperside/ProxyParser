import { createHash } from "node:crypto";

import type { ProxyNode } from "../../types";

// 原生节点稳定 ID：identity = type|server|port（技术方案 §4.1）。
// 改名/换凭据不改变 ID；换服务器地址视为删+增（selector 引用自动吸收，ID 引用进问题清单）。

const sha256Hex = (input: string) => createHash("sha256").update(input).digest("hex");

const identityOf = (node: ProxyNode) => {
  const type = typeof node.type === "string" ? node.type : "";
  const server = typeof node.server === "string" ? node.server : "";
  const port = typeof node.port === "number" || typeof node.port === "string" ? String(node.port) : "";
  return `${type}|${server}|${port}`;
};

export const computeNativeNodeId = (node: ProxyNode, collisionIndex = 0) => {
  const identity =
    collisionIndex === 0 ? identityOf(node) : `${identityOf(node)}#${collisionIndex}`;
  return `n_${sha256Hex(identity).slice(0, 12)}`;
};

export interface IdentifiedNode {
  id: string;
  node: ProxyNode;
}

// 对一份源快照内的全部节点计算稳定 ID。
// identity 冲突时（同 type|server|port 多个节点，罕见）：按名称排序后追加 #1、#2… 保证确定性。
export const identifyNodes = (nodes: ProxyNode[]): IdentifiedNode[] => {
  const byIdentity = new Map<string, ProxyNode[]>();

  for (const node of nodes) {
    const key = identityOf(node);
    const bucket = byIdentity.get(key);
    if (bucket) {
      bucket.push(node);
    } else {
      byIdentity.set(key, [node]);
    }
  }

  const assigned = new Map<ProxyNode, string>();

  for (const bucket of byIdentity.values()) {
    if (bucket.length === 1) {
      assigned.set(bucket[0]!, computeNativeNodeId(bucket[0]!));
      continue;
    }

    const sorted = [...bucket].sort((left, right) =>
      String(left.name).localeCompare(String(right.name))
    );
    sorted.forEach((node, index) => {
      assigned.set(node, computeNativeNodeId(node, index));
    });
  }

  // 保持原始顺序输出
  return nodes.map((node) => ({ id: assigned.get(node)!, node }));
};
