import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import { formatRelative, usageSummary } from "../../lib/format";
import {
  useSubscriptionMutations,
  useTemplateExtractPreview,
  useTemplateMutations
} from "../../lib/hooks";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardTitle } from "../ui/card";
import { Dialog, DialogContent, DialogFooter } from "../ui/dialog";
import { Field, Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { useWorkspace } from "./context";

// 提炼模板：先看报告，确认后保存（对应产品文档 §9.5）
const ExtractDialog = ({ onClose }: { onClose: () => void }) => {
  const { detail, editingLocked } = useWorkspace();
  const navigate = useNavigate();
  const [retainSensitive, setRetainSensitive] = useState(false);
  const [visibility, setVisibility] = useState<"private" | "unlisted" | "public">("private");
  const [confirmedSensitive, setConfirmedSensitive] = useState(false);
  const [confirmedShare, setConfirmedShare] = useState(false);
  const preview = useTemplateExtractPreview(detail.id, retainSensitive);
  const mutations = useTemplateMutations();
  const [name, setName] = useState(`${detail.displayName} 方案`);
  const [saveError, setSaveError] = useState<string | null>(null);
  const report = preview.data?.report ?? null;
  const normalizedName = name.trim();

  const submit = async () => {
    if (!report || !normalizedName || !preview.data || editingLocked) return;
    setSaveError(null);
    try {
      const created = await mutations.create.mutateAsync({
        subscriptionId: detail.id,
        expectedDraftRevision: preview.data.draftRevision,
        displayName: normalizedName,
        visibility,
        retainSensitive,
        confirmSensitive: !retainSensitive || confirmedSensitive,
        confirmShareSensitive: !retainSensitive || visibility === "private" || confirmedShare
      });
      toast.success(`模板「${created.displayName}」已保存`);
      onClose();
      void navigate({ to: "/templates" });
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "保存失败");
    }
  };

  const requestClose = () => {
    if (!mutations.create.isPending) onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && requestClose()}>
      <DialogContent title="提炼为模板" description="模板与订阅源脱钩：换机场时套用即可。以下是将被记录与剔除的内容。">
        <div className="mb-3 flex items-start justify-between gap-4 rounded-md border border-line bg-surface2 px-3 py-2.5">
          <div>
            <p className="text-xs font-medium">保留自建节点敏感信息</p>
            <p className="mt-0.5 text-[11px] leading-4 text-muted">关闭时凭据会变成占位符；开启后凭据以独立密文保存，应用模板的人将得到可用凭据副本。</p>
          </div>
          <Switch checked={retainSensitive} onCheckedChange={(checked) => {
            setRetainSensitive(checked);
            setConfirmedSensitive(false);
            setConfirmedShare(false);
          }} />
        </div>
        {preview.isFetching ? (
          <p className="text-xs text-muted">正在分析当前草稿…</p>
        ) : preview.isError ? (
          <div className="flex flex-col items-start gap-3 rounded-md bg-err-bg px-3 py-2.5">
            <p className="text-xs text-err">
              {preview.error instanceof Error ? preview.error.message : "提炼失败"}
            </p>
            <Button size="sm" variant="danger" onClick={() => void preview.refetch()}>
              重新分析
            </Button>
          </div>
        ) : report ? (
          <div className="flex flex-col gap-4">
            <div className="text-xs">
              <p className="mb-1 font-medium text-ok">可记录</p>
              {report.recorded.map((item) => (
                <p key={item} className="text-muted">· {item}</p>
              ))}
              {report.dropped.length > 0 ? (
                <>
                  <p className="mb-1 mt-3 font-medium text-warn">不可记录（将被剔除）</p>
                  {report.dropped.map((item, index) => (
                    <p key={index} className="text-muted">· {item.detail}</p>
                  ))}
                </>
              ) : null}
            </div>
            <Field label="模板名称">
              <Input
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setSaveError(null);
                }}
              />
            </Field>
            <Field label="可见范围">
              <Select value={visibility} onValueChange={(value) => {
                setVisibility(value as typeof visibility);
                setConfirmedShare(false);
              }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="private">仅自己</SelectItem>
                  <SelectItem value="unlisted">持链接者可访问</SelectItem>
                  <SelectItem value="public">公开</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {retainSensitive ? (
              <label className="flex items-start gap-2 rounded-md bg-warn-bg px-3 py-2 text-xs text-warn">
                <input type="checkbox" checked={confirmedSensitive} onChange={(event) => setConfirmedSensitive(event.target.checked)} />
                我确认模板会携带自建节点凭据；任何成功应用此模板的人都将获得一份独立、可用的加密凭据副本。
              </label>
            ) : null}
            {retainSensitive && visibility !== "private" ? (
              <label className="flex items-start gap-2 rounded-md border border-err/30 bg-err-bg px-3 py-2 text-xs text-err">
                <input type="checkbox" checked={confirmedShare} onChange={(event) => setConfirmedShare(event.target.checked)} />
                我确认这是含凭据的共享模板；公开或拿到链接的用户可以复制并使用这些节点凭据。
              </label>
            ) : null}
            {!normalizedName ? <p className="text-xs text-err">模板名称不能为空。</p> : null}
            {saveError ? (
              <p className="rounded-md bg-err-bg px-3 py-2 text-xs text-err">{saveError}</p>
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-err">未能读取提炼报告。</p>
        )}
        <DialogFooter>
          <Button variant="ghost" disabled={mutations.create.isPending} onClick={requestClose}>
            取消
          </Button>
          <Button
            variant="primary"
            disabled={
              !report ||
              !normalizedName ||
              preview.isFetching ||
              mutations.create.isPending ||
              (retainSensitive && !confirmedSensitive) ||
              (retainSensitive && visibility !== "private" && !confirmedShare) ||
              editingLocked
            }
            onClick={() => void submit()}
          >
            {mutations.create.isPending ? "保存中…" : "确认保存模板"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export const OverviewTab = () => {
  const { detail, config, workspaceIndex, saving } = useWorkspace();
  const navigate = useNavigate();
  const mutations = useSubscriptionMutations(detail.id);
  const [showExtract, setShowExtract] = useState(false);
  const usage = usageSummary(detail.usage);

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <Card>
        <CardTitle>状态</CardTitle>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-[12.5px]">
          <dt className="text-faint">构建模式</dt>
          <dd>
            {config.mode === "rebuild" ? "完整重组（可提炼模板）" : "保留源配置（与该订阅源绑定）"}
          </dd>
          <dt className="text-faint">订阅源</dt>
          <dd>{detail.sourceNames.join(" + ")}</dd>
          <dt className="text-faint">当前版本</dt>
          <dd>
            {detail.activeReleaseSeq !== null
              ? `v${detail.activeReleaseSeq}（${formatRelative(detail.activeReleaseAt)}）`
              : "未发布"}
          </dd>
          <dt className="text-faint">最近拉取</dt>
          <dd>{formatRelative(detail.lastPullAt)}</dd>
          {usage ? (
            <>
              <dt className="text-faint">上游流量</dt>
              <dd>
                已用 {usage.percent}%
                {usage.expireDays !== null ? ` · ${usage.expireDays} 天后到期` : ""}
              </dd>
            </>
          ) : null}
          {workspaceIndex ? (
            <>
              <dt className="text-faint">当前草稿</dt>
              <dd className="font-mono text-xs">
                {workspaceIndex.stats.nodeCount} 节点 · {workspaceIndex.stats.groupCount} 组
              </dd>
            </>
          ) : null}
        </dl>
        {detail.healthReasons.length > 0 ? (
          <div className="mt-3 flex flex-col gap-1">
            {detail.healthReasons.map((reason) => (
              <Badge key={reason} variant={detail.health === "error" ? "err" : "warn"}>
                {reason}
              </Badge>
            ))}
          </div>
        ) : null}
      </Card>

      <Card>
        <CardTitle>操作</CardTitle>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={config.mode !== "rebuild" || saving}
            onClick={() => setShowExtract(true)}
          >
            提炼为模板
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={() => {
              if (
                confirm(
                  `删除订阅「${detail.displayName}」？所有版本历史和订阅链接将立即失效，客户端将无法再拉取。`
                )
              ) {
                void mutations.remove.mutateAsync(detail.id).then(() => {
                  toast.success("订阅已删除");
                  void navigate({ to: "/subscriptions" });
                });
              }
            }}
          >
            删除订阅
          </Button>
        </div>
        {config.mode !== "rebuild" ? (
          <p className="mt-2 text-[11px] text-faint">保留源配置模式与订阅源绑定，不能提炼为通用模板。</p>
        ) : saving ? (
          <p className="mt-2 text-[11px] text-faint">草稿保存完成后即可提炼，确保模板包含最新修改。</p>
        ) : null}
      </Card>

      {showExtract ? <ExtractDialog onClose={() => setShowExtract(false)} /> : null}
    </div>
  );
};
