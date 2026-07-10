import yaml from "js-yaml";

import type { ClashProxyDocument } from "../../types";

// 规则追踪器（技术方案 §10）："这个域名/IP 会走哪？"
// 对渲染产物顺序匹配；RULE-SET 用我们自己的快照内容展开；
// GEOSITE/GEOIP 如实降级为 maybe（命中取决于客户端 geodata）。

export interface TraceQueryInput {
  document: ClashProxyDocument;
  rulesetContentBySlug: Map<string, { behavior: string; content: string }>; // provider slug -> 快照
  query: string;
}

export interface TraceResult {
  verdict: "hit" | "maybe" | "final" | "no-rules";
  matched: { ruleText: string; index: number; via: string | null } | null; // via: RULE-SET 内命中的条目
  target: string | null;
  groupChain: string[]; // 从目标组展开的组链（第一跳成员）
  maybeNotes: string[]; // 途中跳过的 GEOSITE/GEOIP 说明
}

const isIpQuery = (query: string) => /^[0-9.]+$/.test(query) || query.includes(":");

const ipToLong = (ip: string): number | null => {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    value = value * 256 + n;
  }
  return value >>> 0;
};

const cidrMatch = (ip: string, cidr: string): boolean => {
  const [network, prefixRaw] = cidr.split("/");
  if (!network || !prefixRaw) return false;
  const prefix = Number(prefixRaw);
  const ipLong = ipToLong(ip);
  const netLong = ipToLong(network);
  if (ipLong === null || netLong === null || !Number.isInteger(prefix)) return false;
  if (prefix === 0) return true;
  const mask = prefix >= 32 ? 0xffffffff : (~((1 << (32 - prefix)) - 1)) >>> 0;
  return (ipLong & mask) === (netLong & mask);
};

const domainMatch = {
  exact: (query: string, value: string) => query === value,
  suffix: (query: string, value: string) =>
    query === value || query.endsWith(`.${value}`),
  keyword: (query: string, value: string) => query.includes(value)
};

const parsePayload = (content: string): string[] => {
  try {
    const parsed = yaml.load(content) as Record<string, unknown> | null;
    if (parsed && Array.isArray(parsed.payload)) {
      return parsed.payload.map((entry) => String(entry));
    }
  } catch {
    // ignore
  }
  return [];
};

const matchPayloadEntry = (
  query: string,
  isIp: boolean,
  behavior: string,
  entry: string
): boolean | "maybe" => {
  if (behavior === "domain") {
    if (isIp) return false;
    if (entry.startsWith("+.")) return domainMatch.suffix(query, entry.slice(2));
    if (entry.includes("*")) return false; // 通配符：v1 不展开，保守不命中
    return domainMatch.exact(query, entry);
  }
  if (behavior === "ipcidr") {
    return isIp && !query.includes(":") ? cidrMatch(query, entry) : false;
  }
  // classical：entry 形如 TYPE,value
  const [type, value] = entry.split(",");
  if (!type || !value) return false;
  return matchSimpleRule(query, isIp, type.trim(), value.trim());
};

// 返回 true=命中，false=未命中，"maybe"=取决于 geodata
const matchSimpleRule = (
  query: string,
  isIp: boolean,
  type: string,
  value: string
): boolean | "maybe" => {
  switch (type) {
    case "DOMAIN":
      return !isIp && domainMatch.exact(query, value);
    case "DOMAIN-SUFFIX":
      return !isIp && domainMatch.suffix(query, value);
    case "DOMAIN-KEYWORD":
      return !isIp && domainMatch.keyword(query, value);
    case "IP-CIDR":
      return isIp && !query.includes(":") && cidrMatch(query, value);
    case "IP-CIDR6":
      return false; // v1 不实现 v6 匹配，保守不命中
    case "GEOSITE":
      return isIp ? false : "maybe";
    case "GEOIP":
      return isIp ? "maybe" : false;
    case "IP-ASN":
      return isIp ? "maybe" : false;
    default:
      return false;
  }
};

const buildGroupChain = (document: ClashProxyDocument, target: string): string[] => {
  const chain: string[] = [];
  const groupByName = new Map(document["proxy-groups"].map((group) => [group.name, group]));
  let current: string | undefined = target;
  const visited = new Set<string>();
  while (current && groupByName.has(current) && !visited.has(current)) {
    visited.add(current);
    chain.push(current);
    current = groupByName.get(current)!.proxies[0];
  }
  if (current && !visited.has(current)) {
    chain.push(current);
  }
  return chain;
};

export const traceQuery = (input: TraceQueryInput): TraceResult => {
  const query = input.query.trim().toLowerCase();
  const isIp = isIpQuery(query);
  const rules = input.document.rules ?? [];
  const maybeNotes: string[] = [];

  for (const [index, ruleText] of rules.entries()) {
    const parts = ruleText.split(",");
    const type = parts[0]?.trim() ?? "";

    if (type === "MATCH") {
      const target = parts[1]?.trim() ?? null;
      return {
        verdict: "final",
        matched: { ruleText, index, via: null },
        target,
        groupChain: target ? buildGroupChain(input.document, target) : [],
        maybeNotes
      };
    }

    if (type === "RULE-SET") {
      const slug = parts[1]?.trim() ?? "";
      const target = parts[2]?.trim() ?? null;
      const snapshot = input.rulesetContentBySlug.get(slug);
      if (!snapshot) continue;
      const entries = parsePayload(snapshot.content);
      for (const entry of entries) {
        const outcome = matchPayloadEntry(query, isIp, snapshot.behavior, entry);
        if (outcome === true) {
          return {
            verdict: "hit",
            matched: { ruleText, index, via: entry },
            target,
            groupChain: target ? buildGroupChain(input.document, target) : [],
            maybeNotes
          };
        }
        if (outcome === "maybe") {
          maybeNotes.push(
            `规则 ${ruleText} 内的 ${entry} 命中取决于客户端 geodata，已跳过继续匹配。`
          );
        }
      }
      continue;
    }

    const value = parts[1]?.trim() ?? "";
    const target = parts[2]?.trim() ?? null;
    const outcome = matchSimpleRule(query, isIp, type, value);
    if (outcome === true) {
      return {
        verdict: "hit",
        matched: { ruleText, index, via: null },
        target,
        groupChain: target ? buildGroupChain(input.document, target) : [],
        maybeNotes
      };
    }
    if (outcome === "maybe") {
      maybeNotes.push(`规则 ${ruleText} 的命中取决于客户端 geodata，已跳过继续匹配。`);
    }
  }

  if (maybeNotes.length > 0) {
    return { verdict: "maybe", matched: null, target: null, groupChain: [], maybeNotes };
  }
  return { verdict: "no-rules", matched: null, target: null, groupChain: [], maybeNotes };
};
