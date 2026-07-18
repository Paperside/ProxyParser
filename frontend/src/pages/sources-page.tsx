import { useEffect, useRef, useState } from "react";
import { FileUp, Pencil, RefreshCw } from "lucide-react";
import { load } from "js-yaml";
import { toast } from "sonner";

import { EmptyState, HealthDot } from "../components/shared";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Dialog, DialogContent, DialogFooter } from "../components/ui/dialog";
import { Field, Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { formatRelative, syncStatusLabel, usageSummary } from "../lib/format";
import { useSourceContent, useSourceMutations, useSourceReports, useSources } from "../lib/hooks";
import type { SourceSummary } from "../lib/types";

const MAX_YAML_BYTES = 10 * 1024 * 1024;

const inspectYaml = (content: string) => {
  if (!content.trim()) return { valid: false as const, message: "请选择文件或粘贴 YAML 内容。" };
  try {
    const document = load(content) as Record<string, unknown> | null;
    if (!document || !Array.isArray(document.proxies)) {
      return { valid: false as const, message: "未找到 proxies 列表。" };
    }
    return {
      valid: true as const,
      proxyCount: document.proxies.length,
      groupCount: Array.isArray(document["proxy-groups"]) ? document["proxy-groups"].length : 0,
      ruleCount: Array.isArray(document.rules) ? document.rules.length : 0
    };
  } catch (error) {
    return {
      valid: false as const,
      message: error instanceof Error ? `YAML 解析失败：${error.message}` : "YAML 解析失败。"
    };
  }
};

const readYamlFile = async (file: File) => {
  if (!/\.ya?ml$/i.test(file.name)) throw new Error("请选择 .yaml 或 .yml 文件。");
  if (file.size > MAX_YAML_BYTES) throw new Error("YAML 文件不能超过 10 MiB。");
  return file.text();
};

const YamlEditor = ({
  yamlContent,
  onYamlContentChange,
  fileName,
  onFileNameChange
}: {
  yamlContent: string;
  onYamlContentChange: (value: string) => void;
  fileName: string;
  onFileNameChange: (value: string) => void;
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const summary = inspectYaml(yamlContent);
  const selectFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const content = await readYamlFile(file);
      onYamlContentChange(content);
      onFileNameChange(file.name);
      toast.success("YAML 已读取并填入编辑器");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "文件读取失败");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <input
        ref={inputRef}
        aria-label="选择 YAML 文件"
        type="file"
        accept=".yaml,.yml,application/x-yaml,text/yaml"
        className="sr-only"
        onChange={(event) => void selectFile(event.target.files?.[0])}
      />
      <button
        type="button"
        className="flex items-center justify-between rounded-md border border-dashed border-line-strong bg-bg px-3 py-2.5 text-left transition-colors hover:border-accent/70 hover:bg-surface2"
        onClick={() => inputRef.current?.click()}
      >
        <span className="flex items-center gap-2 text-xs font-medium text-ink">
          <FileUp className="size-4 text-accent" /> 上传 YAML 文件
        </span>
        <span className="font-mono text-[11px] text-faint">{fileName || ".yaml / .yml · 最大 10 MiB"}</span>
      </button>
      <Field label="YAML 内容" hint="上传后会自动填入；也可以直接编辑，需包含 proxies 列表。">
        <Textarea
          aria-label="YAML 内容"
          value={yamlContent}
          onChange={(event) => onYamlContentChange(event.target.value)}
          className="min-h-52 font-mono text-[11.5px] leading-5"
        />
      </Field>
      {summary.valid ? (
        <div className="rounded-md border border-ok/25 bg-ok-bg px-3 py-2 text-xs text-ok">
          已解析：{summary.proxyCount} 节点 · {summary.groupCount} 组 · {summary.ruleCount} 规则
        </div>
      ) : (
        <p className="text-[11px] text-warn">{summary.message}</p>
      )}
    </div>
  );
};

const AddSourceDialog = ({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) => {
  const mutations = useSourceMutations();
  const [mode, setMode] = useState<"url" | "upload">("url");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [yamlContent, setYamlContent] = useState("");
  const [uploadedFileName, setUploadedFileName] = useState("");

  useEffect(() => {
    if (open) return;
    setMode("url");
    setName("");
    setUrl("");
    setYamlContent("");
    setUploadedFileName("");
    if (!mutations.create.isPending) mutations.create.reset();
  }, [mutations.create.isPending, open]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && mutations.create.isPending) return;
    onOpenChange(nextOpen);
  };

  const submit = async () => {
    try {
      await mutations.create.mutateAsync(
        mode === "url"
          ? { displayName: name, sourceUrl: url.trim() }
          : { displayName: name, yamlContent, uploadedFileName: uploadedFileName || undefined }
      );
      toast.success("订阅源已添加并同步");
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "添加失败");
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent wide title="添加订阅源" description="使用机场订阅链接，或上传、粘贴一份 Clash/Mihomo YAML。">
        <div className="mb-4 flex gap-1 rounded-md border border-line p-0.5">
          {(
            [
              ["url", "订阅链接"],
              ["upload", "上传或编辑 YAML"]
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
            <YamlEditor
              yamlContent={yamlContent}
              onYamlContentChange={setYamlContent}
              fileName={uploadedFileName}
              onFileNameChange={(value) => {
                setUploadedFileName(value);
                if (!name) setName(value.replace(/\.ya?ml$/i, ""));
              }}
            />
          )}
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            disabled={mutations.create.isPending}
            onClick={() => handleOpenChange(false)}
          >
            取消
          </Button>
          <Button
            variant="primary"
            disabled={mutations.create.isPending || (mode === "url" ? !/^https?:\/\//.test(url.trim()) : !inspectYaml(yamlContent).valid)}
            onClick={() => void submit()}
          >
            {mutations.create.isPending ? "同步中…" : "添加并同步"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const UpdateUploadDialog = ({
  source,
  open,
  onOpenChange
}: {
  source: SourceSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const mutations = useSourceMutations();
  const content = useSourceContent(source.id, open);
  const [yamlContent, setYamlContent] = useState("");
  const [uploadedFileName, setUploadedFileName] = useState(source.uploadedFileName ?? "");

  useEffect(() => {
    if (!open || !content.data) return;
    setYamlContent(content.data.yamlContent);
    setUploadedFileName(content.data.uploadedFileName ?? "");
  }, [content.data, open]);

  useEffect(() => {
    if (open) return;
    setYamlContent("");
    setUploadedFileName("");
    content.clear();
    if (!mutations.update.isPending) mutations.update.reset();
  }, [content.clear, mutations.update.isPending, open]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && mutations.update.isPending) return;
    onOpenChange(nextOpen);
  };

  const submit = async () => {
    try {
      await mutations.update.mutateAsync({
        id: source.id,
        yamlContent,
        uploadedFileName: uploadedFileName || undefined
      });
      toast.success("YAML 订阅源已更新，下游订阅已收到变更");
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "更新失败");
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent wide title={`更新 ${source.displayName}`} description="上传替换文件，或直接修改当前 YAML。保存后会生成同步报告并通知引用它的订阅。">
        {content.isLoading ? (
          <p className="py-8 text-center text-xs text-muted">正在读取当前 YAML…</p>
        ) : content.isError ? (
          <p className="rounded-md bg-err-bg px-3 py-2 text-xs text-err">{content.error.message}</p>
        ) : (
          <YamlEditor
            yamlContent={yamlContent}
            onYamlContentChange={setYamlContent}
            fileName={uploadedFileName}
            onFileNameChange={setUploadedFileName}
          />
        )}
        <DialogFooter>
          <Button
            variant="ghost"
            disabled={mutations.update.isPending}
            onClick={() => handleOpenChange(false)}
          >
            取消
          </Button>
          <Button
            variant="primary"
            disabled={content.isLoading || mutations.update.isPending || !inspectYaml(yamlContent).valid}
            onClick={() => void submit()}
          >
            {mutations.update.isPending ? "保存中…" : "保存并更新"}
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
  const [showUpdate, setShowUpdate] = useState(false);
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
          ) : (
            <Button size="sm" onClick={() => setShowUpdate(true)}>
              <Pencil className="size-3.5" /> 更新 YAML
            </Button>
          )}
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
      {source.sourceKind === "uploaded_yaml" ? (
        <UpdateUploadDialog source={source} open={showUpdate} onOpenChange={setShowUpdate} />
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
