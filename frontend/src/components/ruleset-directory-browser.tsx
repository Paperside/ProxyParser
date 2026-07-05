import { useState } from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";

import { useRulesetDirectory } from "../lib/hooks";
import type { RulesetDirectoryEntry } from "../lib/types";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

const PAGE_SIZE = 20;

// 规则库扩展目录浏览器：搜索 + 分页浏览 blackmatrix7 全量规则组，点击导入即可。
// 常用的十几个规则组已作为内置规则源常驻置顶列表，这里是"其余规则，用户按需自取"。
export const RulesetDirectoryBrowser = ({
  onImport,
  busySlug
}: {
  onImport: (entry: RulesetDirectoryEntry) => void;
  busySlug?: string | null;
}) => {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const directory = useRulesetDirectory(query, page, PAGE_SIZE);
  const total = directory.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-2.5">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
        <Input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(1);
          }}
          placeholder={`搜索其余 ${total || "…"} 个规则组（Apple、Netflix、GitHub…）`}
          className="pl-8"
        />
      </div>
      <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
        {(directory.data?.items ?? []).map((entry) => (
          <div
            key={entry.slug}
            className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-surface2"
          >
            <span className="text-xs font-medium">{entry.name}</span>
            <Badge variant="mono" className="text-[10px]">
              {entry.behavior === "domain" ? "域名" : "经典规则"}
            </Badge>
            <Button
              size="sm"
              className="ml-auto"
              disabled={busySlug !== null && busySlug !== undefined}
              onClick={() => onImport(entry)}
            >
              {busySlug === entry.slug ? "导入中…" : "导入"}
            </Button>
          </div>
        ))}
        {directory.data && directory.data.items.length === 0 ? (
          <p className="px-2 py-3 text-xs text-faint">没有匹配的规则组。</p>
        ) : null}
      </div>
      <div className="flex items-center justify-between text-[11px] text-faint">
        <span>
          第 {page} / {totalPages} 页 · 共 {total} 个
        </span>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft className="size-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            <ChevronRight className="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
};
