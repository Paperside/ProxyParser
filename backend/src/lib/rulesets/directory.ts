import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// 规则库扩展目录：blackmatrix7/ios_rule_script 全部规则组的只读索引（scripts/fetch-rule-directory.ts 生成）。
// 不预置离线快照——只作为搜索/浏览用的参考索引，用户导入时才实时抓取内容（走 importFromUrl）。

const assetsRulesetsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../assets/rulesets");

export interface RulesetDirectoryEntry {
  slug: string;
  name: string;
  behavior: "classical" | "domain";
  sourceUrl: string;
}

let cached: RulesetDirectoryEntry[] | null = null;

export const loadRulesetDirectory = (): RulesetDirectoryEntry[] => {
  if (cached) return cached;
  const path = resolve(assetsRulesetsDir, "directory.json");
  if (!existsSync(path)) {
    cached = [];
    return cached;
  }
  cached = JSON.parse(readFileSync(path, "utf8")) as RulesetDirectoryEntry[];
  return cached;
};

export interface DirectorySearchResult {
  items: RulesetDirectoryEntry[];
  total: number;
  page: number;
  pageSize: number;
}

export const searchRulesetDirectory = (
  query: string | null,
  page: number,
  pageSize: number
): DirectorySearchResult => {
  const all = loadRulesetDirectory();
  const normalizedQuery = query?.trim().toLowerCase() ?? "";
  const filtered = normalizedQuery
    ? all.filter(
        (entry) =>
          entry.name.toLowerCase().includes(normalizedQuery) || entry.slug.includes(normalizedQuery)
      )
    : all;
  const safePage = Math.max(1, page);
  const safePageSize = Math.min(100, Math.max(1, pageSize));
  const start = (safePage - 1) * safePageSize;
  return {
    items: filtered.slice(start, start + safePageSize),
    total: filtered.length,
    page: safePage,
    pageSize: safePageSize
  };
};
