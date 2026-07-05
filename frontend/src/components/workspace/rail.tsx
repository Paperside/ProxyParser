import { useState } from "react";
import { RefreshCw } from "lucide-react";

import { useTrace } from "../../lib/hooks";
import type { TraceResultDto } from "../../lib/types";
import { DiffChips, IssueList } from "../shared";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { useWorkspace } from "./context";

// 右侧诊断栏：预览 / 与已发布差异 / 规则追踪器（原型 03/05 的 rail）
export const WorkspaceRail = () => {
  const { detail, preview, previewLoading, refreshPreview } = useWorkspace();
  const [tab, setTab] = useState<"preview" | "diff" | "trace">("diff");
  const trace = useTrace(detail.id);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<TraceResultDto | null>(null);

  const runTrace = () => {
    if (!query.trim()) return;
    trace.mutate(
      { query: query.trim(), draft: true },
      { onSuccess: setResult }
    );
  };

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3.5 flex gap-0.5 rounded-md border border-line p-0.5">
        {(
          [
            ["preview", "预览"],
            ["diff", "差异"],
            ["trace", "测一测"]
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            className={`flex-1 rounded px-2 py-1 text-xs ${tab === value ? "bg-surface2 font-medium text-ink" : "text-muted"}`}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "preview" ? (
        <>
          <div className="mb-2 flex items-center gap-2">
            <span className="text-xs font-medium">当前草稿的渲染产物</span>
            <Button size="sm" variant="ghost" className="ml-auto" onClick={refreshPreview}>
              <RefreshCw className={`size-3 ${previewLoading ? "animate-spin" : ""}`} />
            </Button>
          </div>
          {preview ? (
            <>
              <div className="mb-2 flex flex-wrap gap-2 font-mono text-[11px] text-muted">
                <span>{preview.stats.nodeCount} 节点</span>
                <span>{preview.stats.groupCount} 组</span>
                <span>{preview.stats.ruleCount} 规则</span>
              </div>
              <pre className="min-h-0 flex-1 overflow-auto rounded-md border border-line bg-bg p-2.5 font-mono text-[10.5px] leading-relaxed text-muted">
                {preview.yamlText}
              </pre>
            </>
          ) : (
            <p className="text-xs text-faint">{previewLoading ? "渲染中…" : "保存草稿后自动渲染。"}</p>
          )}
        </>
      ) : null}

      {tab === "diff" ? (
        <>
          <p className="mb-2 text-xs font-medium">
            草稿 与 已发布{" "}
            {preview?.activeReleaseSeq !== null && preview?.activeReleaseSeq !== undefined
              ? `v${preview.activeReleaseSeq}`
              : "（尚未发布）"}
            <span className="ml-1 font-normal text-faint">发布前你会再次确认</span>
          </p>
          <div className="mb-4">
            <DiffChips diff={preview?.diffVsActive ?? null} />
          </div>
          <p className="mb-1.5 text-xs font-medium">
            待处理问题{" "}
            {preview && preview.issues.length > 0 ? (
              <Badge variant="warn">{preview.issues.length}</Badge>
            ) : null}
          </p>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <IssueList issues={preview?.issues ?? []} />
          </div>
        </>
      ) : null}

      {tab === "trace" ? (
        <>
          <p className="mb-2 text-xs font-medium">
            规则追踪器 <span className="font-normal text-faint">这个域名会走哪？</span>
          </p>
          <div className="flex gap-1.5">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="chat.openai.com"
              className="font-mono text-xs"
              onKeyDown={(event) => event.key === "Enter" && runTrace()}
            />
            <Button size="sm" variant="primary" disabled={trace.isPending} onClick={runTrace}>
              测
            </Button>
          </div>
          {result ? (
            <div className="mt-3.5 text-[12.5px]">
              <div className="flex items-center gap-2">
                {result.verdict === "hit" ? (
                  <Badge variant="ok">命中</Badge>
                ) : result.verdict === "final" ? (
                  <Badge variant="accent">MATCH 兜底</Badge>
                ) : result.verdict === "maybe" ? (
                  <Badge variant="warn">视 geodata 而定</Badge>
                ) : (
                  <Badge>未命中任何规则</Badge>
                )}
                {result.matched ? (
                  <span className="font-mono text-xs">{result.matched.ruleText}</span>
                ) : null}
              </div>
              {result.matched?.via ? (
                <p className="mt-1 text-[11px] text-faint">
                  快照内命中条目：<span className="font-mono">{result.matched.via}</span>
                </p>
              ) : null}
              {result.groupChain.length > 0 ? (
                <div className="mt-2.5 flex flex-col gap-1">
                  {result.groupChain.map((group, index) => (
                    <p key={index} className="text-muted">
                      <span className="mr-2 font-mono text-faint">→</span>
                      {index === 0 ? "目标组 " : "当前选择 "}
                      <code className="rounded border border-line bg-surface2 px-1.5 font-mono text-[11px]">
                        {group}
                      </code>
                    </p>
                  ))}
                </div>
              ) : null}
              {result.maybeNotes.map((note, index) => (
                <p key={index} className="mt-2 text-[11px] text-faint">
                  {note}
                </p>
              ))}
              <p className="mt-3 border-t border-line pt-2 text-[11px] leading-relaxed text-faint">
                基于<strong>当前草稿</strong>求值。含 GEOSITE/GEOIP 的命中以客户端 geodata 为准。
              </p>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
};
