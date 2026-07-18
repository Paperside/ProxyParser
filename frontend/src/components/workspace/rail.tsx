import { useEffect, useState } from "react";
import { FileText, RefreshCw } from "lucide-react";

import {
  usePreviewRequest,
  usePreviewYaml,
  usePreviewYamlDownload,
  useTrace
} from "../../lib/hooks";
import type { TraceResultDto } from "../../lib/types";
import { DiffChips, IssueList } from "../shared";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { useWorkspace } from "./context";

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
};

const MAX_INLINE_YAML_BYTES = 1024 * 1024;

// 右侧诊断栏：完整求值与 YAML 都由用户明确触发，工作区载入不再隐式展开规则正文。
export const WorkspaceRail = () => {
  const { detail, config, draftRevision, saving } = useWorkspace();
  const [tab, setTab] = useState<"preview" | "diff" | "trace">("diff");
  const previewRequest = usePreviewRequest(detail.id);
  const yamlRequest = usePreviewYaml(detail.id);
  const yamlDownload = usePreviewYamlDownload(detail.id);
  const trace = useTrace(detail.id);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<TraceResultDto | null>(null);

  // 任意本地编辑都会让既有 hash/YAML 失效；服务端保存完成前也不展示旧结果。
  useEffect(() => {
    previewRequest.reset();
    yamlRequest.reset();
    yamlDownload.reset();
  }, [config]);

  const preview =
    !saving && previewRequest.data?.draftRevision === draftRevision
      ? previewRequest.data
      : null;
  const yaml =
    preview &&
    yamlRequest.data?.draftRevision === preview.draftRevision &&
    yamlRequest.data.renderedHash === preview.renderedHash
      ? yamlRequest.data.yamlText
      : null;

  const generatePreview = () => {
    yamlRequest.reset();
    yamlDownload.reset();
    previewRequest.mutate();
  };

  const runTrace = () => {
    if (!query.trim()) return;
    trace.mutate(
      { query: query.trim(), draft: true },
      { onSuccess: setResult }
    );
  };

  const previewEmptyState = (
    <div className="rounded-md border border-line bg-bg p-3 text-xs text-muted">
      <p className="mb-2 leading-relaxed">
        仅在你主动生成时才会展开规则并计算完整差异；内联规则较多时可能需要数秒。
      </p>
      {previewRequest.isError ? (
        <p className="mb-2 text-err">
          生成失败：
          {previewRequest.error instanceof Error ? previewRequest.error.message : "未知错误"}
        </p>
      ) : null}
      <Button
        size="sm"
        variant="primary"
        disabled={saving || previewRequest.isPending}
        onClick={generatePreview}
      >
        {previewRequest.isPending ? "正在生成…" : "生成预览与差异"}
      </Button>
    </div>
  );

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
            {preview ? (
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto"
                title="重新生成预览"
                disabled={saving || previewRequest.isPending}
                onClick={generatePreview}
              >
                <RefreshCw
                  className={`size-3 ${previewRequest.isPending ? "animate-spin" : ""}`}
                />
              </Button>
            ) : null}
          </div>
          {preview ? (
            <>
              <div className="mb-2 flex flex-wrap gap-2 font-mono text-[11px] text-muted">
                <span>{preview.stats.nodeCount} 节点</span>
                <span>{preview.stats.groupCount} 组</span>
                <span>{preview.stats.ruleCount} 规则</span>
                <span>{formatBytes(preview.yamlBytes)}</span>
              </div>
              {yaml ? (
                <pre className="min-h-0 flex-1 overflow-auto rounded-md border border-line bg-bg p-2.5 font-mono text-[10.5px] leading-relaxed text-muted">
                  {yaml}
                </pre>
              ) : (
                <div className="rounded-md border border-line bg-bg p-3 text-xs text-muted">
                  <p className="mb-2 leading-relaxed">
                    {preview.yamlBytes > MAX_INLINE_YAML_BYTES
                      ? `完整 YAML 约 ${formatBytes(preview.yamlBytes)}。为避免浏览器卡顿，大于 1 MiB 的内容只提供文件下载，不会写入页面。`
                      : `完整 YAML 约 ${formatBytes(preview.yamlBytes)}，不会自动加载。`}
                  </p>
                  {yamlRequest.isError || yamlDownload.isError ? (
                    <p className="mb-2 text-err">
                      {preview.yamlBytes > MAX_INLINE_YAML_BYTES ? "下载" : "加载"}失败：
                      {yamlRequest.error instanceof Error
                        ? yamlRequest.error.message
                        : yamlDownload.error instanceof Error
                          ? yamlDownload.error.message
                          : "未知错误"}
                    </p>
                  ) : null}
                  <Button
                    size="sm"
                    disabled={yamlRequest.isPending || yamlDownload.isPending}
                    onClick={() => {
                      const input = {
                        expectedDraftRevision: preview.draftRevision,
                        expectedRenderedHash: preview.renderedHash
                      };
                      if (preview.yamlBytes > MAX_INLINE_YAML_BYTES) {
                        yamlDownload.mutate({ ...input, fileName: detail.displayName });
                      } else {
                        yamlRequest.mutate(input);
                      }
                    }}
                  >
                    <FileText className="size-3" />
                    {yamlRequest.isPending
                      ? "正在加载…"
                      : yamlDownload.isPending
                        ? "正在下载…"
                        : preview.yamlBytes > MAX_INLINE_YAML_BYTES
                          ? yamlDownload.isSuccess
                            ? "再次下载完整 YAML"
                            : "下载完整 YAML"
                          : "加载完整 YAML"}
                  </Button>
                </div>
              )}
            </>
          ) : (
            previewEmptyState
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
          {preview ? (
            <>
              <div className="mb-4">
                <DiffChips diff={preview.diffVsActive} />
              </div>
              <p className="mb-1.5 text-xs font-medium">
                待处理问题{" "}
                {preview.issues.length > 0 ? (
                  <Badge variant="warn">{preview.issues.length}</Badge>
                ) : null}
              </p>
              <div className="min-h-0 flex-1 overflow-y-auto">
                <IssueList issues={preview.issues} />
              </div>
            </>
          ) : (
            previewEmptyState
          )}
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
