import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { EmptyState, HealthDot } from "../components/shared";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardTitle } from "../components/ui/card";
import { Dialog, DialogContent, DialogFooter } from "../components/ui/dialog";
import { Field, Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { formatRelative, syncStatusLabel, usageSummary } from "../lib/format";
import { useSourceMutations, useSourceReports, useSources } from "../lib/hooks";
import type { SourceSummary } from "../lib/types";

const AddSourceDialog = ({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) => {
  const mutations = useSourceMutations();
  const [mode, setMode] = useState<"url" | "upload">("url");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [yamlContent, setYamlContent] = useState("");

  const submit = async () => {
    try {
      await mutations.create.mutateAsync(
        mode === "url"
          ? { displayName: name, sourceUrl: url.trim() }
          : { displayName: name, yamlContent }
      );
      toast.success("订阅源已添加并同步");
      onOpenChange(false);
      setName("");
      setUrl("");
      setYamlContent("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "添加失败");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="添加订阅源" description="机场订阅链接，或直接粘贴一份 Clash YAML。">
        <div className="mb-4 flex gap-1 rounded-md border border-line p-0.5">
          {(
            [
              ["url", "订阅链接"],
              ["upload", "粘贴 YAML"]
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              className={`flex-1 rounded px-2 py-1 text-xs ${mode === value ? "bg-surface2 font-medium text-ink" : "text-muted"}`}
              onClick={() => setMode(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-3.5">
          <Field label="名称">
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：白云机场" />
          </Field>
          {mode === "url" ? (
            <Field label="订阅链接">
              <Input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://…" />
            </Field>
          ) : (
            <Field label="YAML 内容" hint="需包含 proxies 列表">
              <Textarea value={yamlContent} onChange={(event) => setYamlContent(event.target.value)} className="min-h-40" />
            </Field>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            variant="primary"
            disabled={mutations.create.isPending || (mode === "url" ? !/^https?:\/\//.test(url.trim()) : yamlContent.trim().length === 0)}
            onClick={() => void submit()}
          >
            {mutations.create.isPending ? "同步中…" : "添加并同步"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const SourceReports = ({ sourceId }: { sourceId: string }) => {
  const reports = useSourceReports(sourceId);
  if (!reports.data || reports.data.length === 0) {
    return <p className="text-xs text-faint">暂无同步报告。</p>;
  }
  return (
    <div className="flex flex-col">
      {reports.data.map((report) => (
        <div key={report.id} className="border-b border-line py-2 text-xs last:border-b-0">
          <p className="text-faint">{formatRelative(report.createdAt)}</p>
          <div className="mt-1 flex flex-wrap gap-1.5 font-mono text-[11px]">
            {report.nodesAdded.length > 0 && (
              <span className="rounded bg-ok-bg px-1.5 text-ok">+{report.nodesAdded.length} {report.nodesAdded.slice(0, 3).map((n) => n.name).join("、")}{report.nodesAdded.length > 3 ? "…" : ""}</span>
            )}
            {report.nodesRemoved.length > 0 && (
              <span className="rounded bg-err-bg px-1.5 text-err">-{report.nodesRemoved.length} {report.nodesRemoved.slice(0, 3).map((n) => n.name).join("、")}{report.nodesRemoved.length > 3 ? "…" : ""}</span>
            )}
            {report.nodesRenamed.length > 0 && (
              <span className="rounded bg-surface2 px-1.5 text-muted">改名 {report.nodesRenamed.length}</span>
            )}
            {report.nodesUpdated.length > 0 && (
              <span className="rounded bg-surface2 px-1.5 text-muted">凭据/字段更新 {report.nodesUpdated.length}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

const SourceCard = ({ source }: { source: SourceSummary }) => {
  const mutations = useSourceMutations();
  const [showReports, setShowReports] = useState(false);
  const usage = usageSummary(source.usage);
  const health = source.lastSyncStatus === "success" ? "ok" : source.lastSyncStatus === "failed" ? "warn" : "warn";

  return (
    <Card>
      <div className="flex items-center gap-2.5">
        <HealthDot health={source.sourceKind === "uploaded_yaml" ? "ok" : health} />
        <span className="text-sm font-semibold">{source.displayName}</span>
        <Badge variant="mono">{source.sourceKind === "url" ? "URL" : "上传"}</Badge>
        <Badge>{syncStatusLabel[source.lastSyncStatus]}</Badge>
        <div className="ml-auto flex items-center gap-2">
          {source.sourceKind === "url" ? (
            <Button
              size="sm"
              disabled={mutations.sync.isPending}
              onClick={() =>
                mutations.sync
                  .mutateAsync(source.id)
                  .then(() => toast.success("同步完成"))
                  .catch((error: unknown) =>
                    toast.error(error instanceof Error ? error.message : "同步失败")
                  )
              }
            >
              <RefreshCw className="size-3.5" /> 立即同步
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => setShowReports((current) => !current)}>
            同步报告
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={() => {
              if (confirm(`删除订阅源「${source.displayName}」？引用它的订阅将无法渲染。`)) {
                void mutations.remove.mutateAsync(source.id);
              }
            }}
          >
            删除
          </Button>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-faint">
        <span>{source.proxyCount} 节点 · {source.groupCount} 组 · {source.ruleCount} 规则</span>
        <span>最近成功同步 {formatRelative(source.lastSuccessfulSyncAt)}</span>
        {source.sourceKind === "url" ? <span>同步间隔 {source.syncIntervalMinutes} 分钟</span> : null}
        {usage ? (
          <span>
            流量已用 {usage.percent}%{usage.expireDays !== null ? ` · ${usage.expireDays} 天后到期` : ""}
          </span>
        ) : null}
      </div>
      {source.lastErrorMessage ? (
        <p className="mt-2 rounded-md bg-warn-bg px-2.5 py-1.5 font-mono text-[11px] text-warn">
          {source.lastErrorMessage}
        </p>
      ) : null}
      {showReports ? (
        <div className="mt-3 border-t border-line pt-2.5">
          <SourceReports sourceId={source.id} />
        </div>
      ) : null}
    </Card>
  );
};

export const SourcesPage = () => {
  const sources = useSources();
  const [showAdd, setShowAdd] = useState(false);

  return (
    <div className="mx-auto max-w-[1180px] px-5 pb-16 pt-6">
      <div className="mb-5 flex items-start gap-4">
        <div>
          <h1 className="text-lg font-semibold">订阅源</h1>
          <p className="text-xs text-muted">上游原料。后台按间隔自动同步，节点变化会生成同步报告并按发布策略吸收进订阅。</p>
        </div>
        <div className="ml-auto">
          <Button variant="primary" onClick={() => setShowAdd(true)}>
            添加订阅源
          </Button>
        </div>
      </div>
      {sources.data && sources.data.length === 0 ? (
        <EmptyState
          title="还没有订阅源"
          description="添加机场订阅链接或上传一份 Clash YAML 作为原料。"
          action={<Button variant="primary" onClick={() => setShowAdd(true)}>添加订阅源</Button>}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {(sources.data ?? []).map((source) => (
            <SourceCard key={source.id} source={source} />
          ))}
        </div>
      )}
      <AddSourceDialog open={showAdd} onOpenChange={setShowAdd} />
    </div>
  );
};
