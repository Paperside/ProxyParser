import { RULE_TYPES, type RuleEntry, type RuleType } from "../build-config/types";

// 粘贴规则解析（技术方案 §8）：解析为结构化条目 + 规范化报告。
// 凡保存结果与用户输入不完全等价，报告必须说清系统改了什么。

export interface PasteParseReport {
  entries: RuleEntry[];
  totalLines: number;
  duplicatesRemoved: number;
  normalizedCount: number; // 大小写/空格被修正的条数
  strippedTargets: number; // 携带目标被剥离的条数（目标由所在块决定）
  skippedMatch: number; // MATCH 行被跳过（兜底由 final 管理）
  invalid: Array<{ line: string; reason: string }>;
}

const RULE_TYPE_SET = new Set<string>(RULE_TYPES);

export const parsePastedRules = (text: string): PasteParseReport => {
  const report: PasteParseReport = {
    entries: [],
    totalLines: 0,
    duplicatesRemoved: 0,
    normalizedCount: 0,
    strippedTargets: 0,
    skippedMatch: 0,
    invalid: []
  };
  const seen = new Set<string>();

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#") || line.startsWith("//")) {
      continue;
    }
    report.totalLines += 1;

    // 支持 YAML 列表格式的 "- DOMAIN,..." 前缀
    const cleaned = line.startsWith("- ") ? line.slice(2).trim() : line;
    const parts = cleaned.split(",").map((part) => part.trim());

    const typeRaw = parts[0] ?? "";
    const type = typeRaw.toUpperCase();

    if (type === "MATCH") {
      report.skippedMatch += 1;
      continue;
    }
    if (!RULE_TYPE_SET.has(type)) {
      report.invalid.push({ line, reason: `不支持的规则类型「${typeRaw}」` });
      continue;
    }
    const value = parts[1];
    if (!value) {
      report.invalid.push({ line, reason: "缺少匹配值" });
      continue;
    }

    // 第三段如果是 no-resolve 等选项则保留为 extra；否则视为目标并剥离
    let extra: string | undefined;
    if (parts.length >= 3) {
      const tail = parts.slice(2);
      const options = tail.filter((part) => part.toLowerCase() === "no-resolve" || part.toLowerCase() === "src");
      const targets = tail.filter((part) => !options.includes(part));
      if (targets.length > 0) {
        report.strippedTargets += 1;
      }
      if (options.length > 0) {
        extra = options.map((part) => part.toLowerCase()).join(",");
      }
    }

    if (type !== typeRaw || cleaned !== cleaned.replace(/\s*,\s*/g, ",")) {
      report.normalizedCount += 1;
    }

    const key = `${type},${value},${extra ?? ""}`;
    if (seen.has(key)) {
      report.duplicatesRemoved += 1;
      continue;
    }
    seen.add(key);
    report.entries.push({ type: type as RuleType, value, ...(extra ? { extra } : {}) });
  }

  return report;
};
