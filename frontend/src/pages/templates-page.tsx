import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "../components/shared";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Dialog, DialogContent, DialogFooter } from "../components/ui/dialog";
import { Field, Input } from "../components/ui/input";
import { formatRelative } from "../lib/format";
import { useSources, useTemplate, useTemplateMutations, useTemplates } from "../lib/hooks";
import type { TemplateSummary } from "../lib/types";

// 应用模板 → 选订阅源 → 创建新订阅（黄金迁移路径：换机场 10 分钟）
const InstantiateDialog = ({ template, onClose }: { template: TemplateSummary; onClose: () => void }) => {
  const navigate = useNavigate();
  const sources = useSources();
  const mutations = useTemplateMutations();
  const detail = useTemplate(template.id);
  const [displayName, setDisplayName] = useState(`${template.displayName} 订阅`);
  const [sourceId, setSourceId] = useState<string | null>(null);

  const placeholderNodes =
    detail.data?.payload?.nodes.custom.filter((node) => node.secretPlaceholder) ?? [];

  const submit = async () => {
    if (!sourceId) return;
    try {
      const created = await mutations.instantiate.mutateAsync({
        id: template.id,
        displayName,
        sourceIds: [sourceId]
      });
      toast.success("已按模板创建订阅（草稿）。预览确认后发布即可。");
      onClose();
      void navigate({
        to: "/subscriptions/$subscriptionId",
        params: { subscriptionId: created.subscription.id }
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "应用失败");
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={`应用模板：${template.displayName}`} description="选择订阅源，模板的分组、规则与配置将一次套用。">
        <div className="flex flex-col gap-3.5">
          <Field label="新订阅名称">
            <Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          </Field>
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted">订阅源</p>
            <div className="flex flex-col gap-1">
              {(sources.data ?? []).map((source) => (
                <label key={source.id} className="flex items-center gap-2 rounded px-1 py-1 text-[13px] hover:bg-surface2">
                  <input
                    type="radio"
                    name="tpl-source"
                    checked={sourceId === source.id}
                    onChange={() => setSourceId(source.id)}
                  />
                  {source.displayName}
                  <span className="text-[11px] text-faint">{source.proxyCount} 节点</span>
                </label>
              ))}
            </div>
          </div>
          {placeholderNodes.length > 0 ? (
            <p className="rounded-md bg-warn-bg px-3 py-2 text-xs text-warn">
              模板含 {placeholderNodes.length} 个自建节点（{placeholderNodes.map((node) => node.name).join("、")}）。
              出于安全，敏感字段不随模板保存——创建后请在「节点」页为它们补全凭据。
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button variant="primary" disabled={!sourceId || mutations.instantiate.isPending} onClick={() => void submit()}>
            创建订阅
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const ReportDialog = ({ templateId, onClose }: { templateId: string; onClose: () => void }) => {
  const detail = useTemplate(templateId);
  const report = detail.data?.extractionReport;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title="模板内容报告" description="提炼时记录了什么、剔除了什么。">
        {report ? (
          <div className="flex flex-col gap-3 text-xs">
            <div>
              <p className="mb-1 font-medium text-ok">已记录</p>
              {report.recorded.map((item) => (
                <p key={item} className="text-muted">· {item}</p>
              ))}
            </div>
            {report.dropped.length > 0 ? (
              <div>
                <p className="mb-1 font-medium text-warn">未进入模板</p>
                {report.dropped.map((item, index) => (
                  <p key={index} className="text-muted">· {item.detail}</p>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-faint">该模板没有提炼报告（官方内置或手工创建）。</p>
        )}
      </DialogContent>
    </Dialog>
  );
};

export const TemplatesPage = () => {
  const templates = useTemplates();
  const mutations = useTemplateMutations();
  const [instantiating, setInstantiating] = useState<TemplateSummary | null>(null);
  const [reportFor, setReportFor] = useState<string | null>(null);

  return (
    <div className="mx-auto max-w-[1180px] px-5 pb-16 pt-6">
      <div className="mb-5">
        <h1 className="text-lg font-semibold">模板</h1>
        <p className="text-xs text-muted">
          与订阅源脱钩的构建方案。在订阅工作台点「提炼为模板」沉淀；换机场时应用模板，一次套用全部分组与规则。
        </p>
      </div>

      {templates.data && templates.data.length === 0 ? (
        <EmptyState title="还没有模板" description="先把一个订阅打磨好，再从它的工作台提炼模板。" />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {(templates.data ?? []).map((template) => (
            <Card key={template.id} className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold">
                {template.displayName}
                {template.isOfficial ? <Badge variant="accent">官方</Badge> : null}
                <Badge variant="mono">v{template.latestVersion}</Badge>
                {!template.isOfficial ? (
                  <Badge>{{ private: "私有", unlisted: "链接可见", public: "公开" }[template.visibility]}</Badge>
                ) : null}
              </div>
              {template.description ? (
                <p className="text-xs text-muted">{template.description}</p>
              ) : null}
              <p className="text-[11px] text-faint">更新于 {formatRelative(template.updatedAt)}</p>
              <div className="mt-1 flex gap-2">
                <Button size="sm" variant="primary" onClick={() => setInstantiating(template)}>
                  应用到订阅源
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setReportFor(template.id)}>
                  内容报告
                </Button>
                {!template.isOfficial ? (
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => {
                      if (confirm(`删除模板「${template.displayName}」？`)) {
                        void mutations.remove.mutateAsync(template.id);
                      }
                    }}
                  >
                    删除
                  </Button>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}

      {instantiating ? (
        <InstantiateDialog template={instantiating} onClose={() => setInstantiating(null)} />
      ) : null}
      {reportFor ? <ReportDialog templateId={reportFor} onClose={() => setReportFor(null)} /> : null}
    </div>
  );
};
