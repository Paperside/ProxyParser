import yaml from "js-yaml";

// 多源规则合并：按目标 behavior 生成 domain/ipcidr/classical payload，
// 拉取脚本（scripts/fetch-rulesets.ts）与在线复检（ruleset.service.ts）共用同一份逻辑，
// 保证离线快照与远端实时重新抓取的结果字节级一致。

export type RulesetBehavior = "domain" | "ipcidr" | "classical";

export interface RulesetSource {
  kind: RulesetBehavior;
  url: string;
}

export interface MultiSourceSpec {
  sources: RulesetSource[];
  extraRules: string[];
}

// domain behavior 的条目遵循 blackmatrix7 payload YAML 的 "+." 前缀约定：
// "+.example.com" → DOMAIN-SUFFIX，裸域名 → DOMAIN，含通配符 "*" 的条目 classical 无法表达，跳过。
const domainEntryToClassical = (entry: string): string | null => {
  const trimmed = entry.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.includes("*")) return null;
  if (trimmed.startsWith("+.")) return `DOMAIN-SUFFIX,${trimmed.slice(2)}`;
  return `DOMAIN,${trimmed}`;
};

const classicalEntryToIpCidr = (entry: string): string | null => {
  const [type, value] = entry.split(",").map((part) => part.trim());
  if ((type !== "IP-CIDR" && type !== "IP-CIDR6") || !value) return null;
  return value;
};

const convertEntry = (
  entry: string,
  sourceBehavior: RulesetBehavior,
  targetBehavior: RulesetBehavior
): string | null => {
  const trimmed = entry.trim();
  if (trimmed.length === 0) return null;

  if (targetBehavior === "classical") {
    if (sourceBehavior === "domain") return domainEntryToClassical(trimmed);
    if (sourceBehavior === "ipcidr") {
      return trimmed.includes(":")
        ? `IP-CIDR6,${trimmed},no-resolve`
        : `IP-CIDR,${trimmed},no-resolve`;
    }
    return trimmed;
  }

  if (targetBehavior === "domain") {
    if (sourceBehavior !== "domain") return null;
    return trimmed;
  }

  if (sourceBehavior === "ipcidr") return trimmed;
  if (sourceBehavior === "classical") return classicalEntryToIpCidr(trimmed);
  return null;
};

const normalizeExtraEntry = (entry: string, targetBehavior: RulesetBehavior): string | null => {
  const trimmed = entry.trim();
  if (trimmed.length === 0) return null;
  if (targetBehavior === "classical") return trimmed;
  if (targetBehavior === "domain") {
    if (trimmed.includes(",")) {
      throw new Error(`domain extraRules 只能包含 domain payload 条目：${trimmed}`);
    }
    return trimmed;
  }
  if (!/^[0-9a-f:.]+\/\d+$/i.test(trimmed)) {
    throw new Error(`ipcidr extraRules 只能包含 CIDR：${trimmed}`);
  }
  return trimmed;
};

const fetchPayloadEntries = async (url: string): Promise<string[]> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  const text = await response.text();
  const parsed = yaml.load(text);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as Record<string, unknown>).payload)
  ) {
    throw new Error(`不是合法的 payload YAML: ${url}`);
  }
  return ((parsed as Record<string, unknown>).payload as unknown[])
    .map((entry) => String(entry).trim())
    .filter((entry) => entry.length > 0);
};

export const mergeMultiSourceRuleset = async (
  spec: MultiSourceSpec,
  targetBehavior: RulesetBehavior
): Promise<{ content: string; entryCount: number }> => {
  const seen = new Set<string>();
  const lines: string[] = [];
  const push = (line: string) => {
    if (!seen.has(line)) {
      seen.add(line);
      lines.push(line);
    }
  };

  for (const source of spec.sources) {
    const rawEntries = await fetchPayloadEntries(source.url);
    for (const raw of rawEntries) {
      const converted = convertEntry(raw, source.kind, targetBehavior);
      if (converted) push(converted);
    }
  }
  for (const extra of spec.extraRules) {
    const normalized = normalizeExtraEntry(extra, targetBehavior);
    if (normalized) push(normalized);
  }

  return {
    content: yaml.dump({ payload: lines }, { noRefs: true, lineWidth: -1, sortKeys: false }),
    entryCount: lines.length
  };
};

export const mergeMultiSourceClassical = async (spec: MultiSourceSpec) =>
  mergeMultiSourceRuleset(spec, "classical");

// source_url 落库编码：官方多源规则组存 JSON（{sources, extraRules}），
// 用户从 URL 导入的自定义规则源仍是裸 URL 字符串，两者共用同一列。
export const encodeMultiSourceSpec = (spec: MultiSourceSpec): string => JSON.stringify(spec);

export const decodeMultiSourceSpec = (raw: string): MultiSourceSpec | null => {
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray((parsed as Record<string, unknown>).sources)
    ) {
      const sources = (parsed as { sources: unknown[] }).sources.filter(
        (item): item is RulesetSource =>
          typeof item === "object" &&
          item !== null &&
          ["domain", "ipcidr", "classical"].includes((item as RulesetSource).kind) &&
          typeof (item as RulesetSource).url === "string"
      );
      const extraRules = Array.isArray((parsed as Record<string, unknown>).extraRules)
        ? ((parsed as { extraRules: unknown[] }).extraRules.filter(
            (item): item is string => typeof item === "string"
          ) as string[])
        : [];
      return { sources, extraRules };
    }
  } catch {
    // 不是 JSON，说明是普通单一 URL（用户导入），非多源规格
  }
  return null;
};
