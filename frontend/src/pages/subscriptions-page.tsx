import { useNavigate } from "@tanstack/react-router";
import { Plus, Copy, PencilLine, RefreshCw, Trash2 } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";

import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { ScrollArea } from "../components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Textarea } from "../components/ui/textarea";
import { copyText } from "../lib/clipboard";
import {
  formatExpire,
  formatTime,
  formatUsage,
  renderStatusText,
  renderStatusTone,
  shareModeText,
  syncStatusText,
  syncStatusTone,
  visibilityText
} from "../lib/format";
import type { ShareMode, UpstreamSource, Visibility } from "../lib/types";
import { useWorkspace } from "../providers/workspace-provider";

type SourceFormState = {
  displayName: string;
  sourceUrl: string;
  visibility: Visibility;
  shareMode: ShareMode;
  isEnabled: boolean;
};

type GeneratedFormState = {
  displayName: string;
  upstreamSourceId: string;
  templateId: string;
  visibility: Visibility;
  shareMode: ShareMode;
  isEnabled: boolean;
};

const emptySourceForm = (): SourceFormState => ({
  displayName: "",
  sourceUrl: "",
  visibility: "private",
  shareMode: "disabled",
  isEnabled: true
});

const emptyGeneratedForm = (): GeneratedFormState => ({
  displayName: "",
  upstreamSourceId: "",
  templateId: "",
  visibility: "private",
  shareMode: "disabled",
  isEnabled: true
});

const SourceDialog = ({
  open,
  title,
  description,
  form,
  isSaving,
  errorMessage,
  onOpenChange,
  onSubmit,
  onChange
}: {
  open: boolean;
  title: string;
  description: string;
  form: SourceFormState;
  isSaving: boolean;
  errorMessage: string | null;
  onOpenChange: (nextOpen: boolean) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onChange: (nextForm: SourceFormState) => void;
}) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <form className="mt-6 space-y-4" onSubmit={onSubmit}>
          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-600">名称</span>
            <Input
              required
              value={form.displayName}
              onChange={(event) => {
                onChange({
                  ...form,
                  displayName: event.target.value
                });
              }}
              placeholder="例如：主力订阅 / 公司线路"
            />
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-600">订阅链接</span>
            <Input
              required
              value={form.sourceUrl}
              onChange={(event) => {
                onChange({
                  ...form,
                  sourceUrl: event.target.value
                });
              }}
              placeholder="https://example.com/subscription.yaml"
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-2">
              <span className="text-sm font-medium text-slate-600">可见性</span>
              <Select
                value={form.visibility}
                onValueChange={(value) => {
                  onChange({
                    ...form,
                    visibility: value as Visibility
                  });
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="private">私有</SelectItem>
                  <SelectItem value="unlisted">凭链接访问</SelectItem>
                  <SelectItem value="public">公开</SelectItem>
                </SelectContent>
              </Select>
            </label>

            <label className="block space-y-2">
              <span className="text-sm font-medium text-slate-600">共享方式</span>
              <Select
                value={form.shareMode}
                onValueChange={(value) => {
                  onChange({
                    ...form,
                    shareMode: value as ShareMode
                  });
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="disabled">不共享</SelectItem>
                  <SelectItem value="view">仅查看</SelectItem>
                  <SelectItem value="fork">允许复用</SelectItem>
                </SelectContent>
              </Select>
            </label>
          </div>

          <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={form.isEnabled}
              onChange={(event) => {
                onChange({
                  ...form,
                  isEnabled: event.target.checked
                });
              }}
              className="size-4 rounded border-slate-300"
            />
            启用这个订阅来源
          </label>

          {errorMessage ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {errorMessage}
            </div>
          ) : null}

          <div className="flex justify-end">
            <Button type="submit" disabled={isSaving}>
              {isSaving ? "保存中..." : "保存"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

const GeneratedDialog = ({
  open,
  title,
  description,
  form,
  isSaving,
  errorMessage,
  onOpenChange,
  onSubmit,
  onChange,
  sourceOptions,
  templateOptions
}: {
  open: boolean;
  title: string;
  description: string;
  form: GeneratedFormState;
  isSaving: boolean;
  errorMessage: string | null;
  onOpenChange: (nextOpen: boolean) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onChange: (nextForm: GeneratedFormState) => void;
  sourceOptions: Array<{ id: string; label: string }>;
  templateOptions: Array<{ id: string; label: string }>;
}) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <form className="mt-6 space-y-4" onSubmit={onSubmit}>
          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-600">名称</span>
            <Input
              required
              value={form.displayName}
              onChange={(event) => {
                onChange({
                  ...form,
                  displayName: event.target.value
                });
              }}
              placeholder="例如：日常出行 / 流媒体专用"
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-2">
              <span className="text-sm font-medium text-slate-600">外部订阅</span>
              <Select
                value={form.upstreamSourceId}
                onValueChange={(value) => {
                  onChange({
                    ...form,
                    upstreamSourceId: value
                  });
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择外部订阅" />
                </SelectTrigger>
                <SelectContent>
                  {sourceOptions.map((source) => (
                    <SelectItem key={source.id} value={source.id}>
                      {source.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>

            <label className="block space-y-2">
              <span className="text-sm font-medium text-slate-600">模板</span>
              <Select
                value={form.templateId}
                onValueChange={(value) => {
                  onChange({
                    ...form,
                    templateId: value
                  });
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择模板" />
                </SelectTrigger>
                <SelectContent>
                  {templateOptions.map((template) => (
                    <SelectItem key={template.id} value={template.id}>
                      {template.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-2">
              <span className="text-sm font-medium text-slate-600">可见性</span>
              <Select
                value={form.visibility}
                onValueChange={(value) => {
                  onChange({
                    ...form,
                    visibility: value as Visibility
                  });
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="private">私有</SelectItem>
                  <SelectItem value="unlisted">凭链接访问</SelectItem>
                  <SelectItem value="public">公开</SelectItem>
                </SelectContent>
              </Select>
            </label>

            <label className="block space-y-2">
              <span className="text-sm font-medium text-slate-600">共享方式</span>
              <Select
                value={form.shareMode}
                onValueChange={(value) => {
                  onChange({
                    ...form,
                    shareMode: value as ShareMode
                  });
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="disabled">不共享</SelectItem>
                  <SelectItem value="view">仅查看</SelectItem>
                  <SelectItem value="fork">允许复用</SelectItem>
                </SelectContent>
              </Select>
            </label>
          </div>

          <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={form.isEnabled}
              onChange={(event) => {
                onChange({
                  ...form,
                  isEnabled: event.target.checked
                });
              }}
              className="size-4 rounded border-slate-300"
            />
            启用这个生成订阅
          </label>

          {errorMessage ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {errorMessage}
            </div>
          ) : null}

          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={
                isSaving || sourceOptions.length === 0 || templateOptions.length === 0
              }
            >
              {isSaving ? "保存中..." : "保存"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

const buildSourceForm = (source?: UpstreamSource): SourceFormState => {
  if (!source) {
    return emptySourceForm();
  }

  return {
    displayName: source.displayName,
    sourceUrl: source.sourceUrl,
    visibility: source.visibility,
    shareMode: source.shareMode,
    isEnabled: source.isEnabled
  };
};

export const SubscriptionsPage = () => {
  const workspace = useWorkspace();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("upstream");
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  const [sourceDialogOpen, setSourceDialogOpen] = useState(false);
  const [sourceEditingId, setSourceEditingId] = useState<string | null>(null);
  const [sourceForm, setSourceForm] = useState<SourceFormState>(emptySourceForm);
  const [sourceErrorMessage, setSourceErrorMessage] = useState<string | null>(null);
  const [sourceSaving, setSourceSaving] = useState(false);

  const [generatedDialogOpen, setGeneratedDialogOpen] = useState(false);
  const [generatedEditingId, setGeneratedEditingId] = useState<string | null>(null);
  const [generatedForm, setGeneratedForm] = useState<GeneratedFormState>(emptyGeneratedForm);
  const [generatedErrorMessage, setGeneratedErrorMessage] = useState<string | null>(null);
  const [generatedSaving, setGeneratedSaving] = useState(false);
  const [busyActionKey, setBusyActionKey] = useState<string | null>(null);
  const [snapshotDialogOpen, setSnapshotDialogOpen] = useState(false);
  const [snapshotDialogTitle, setSnapshotDialogTitle] = useState("");
  const [snapshotItems, setSnapshotItems] = useState<
    Awaited<ReturnType<typeof workspace.listGeneratedSubscriptionSnapshots>>
  >([]);
  const [snapshotCompare, setSnapshotCompare] = useState<
    Awaited<ReturnType<typeof workspace.compareGeneratedSubscriptionSnapshots>> | null
  >(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);

  const sourceOptions = useMemo(() => {
    return workspace.sources.map((source) => ({
      id: source.id,
      label: source.displayName
    }));
  }, [workspace.sources]);

  const templateOptions = useMemo(() => {
    return workspace.templates.map((template) => ({
      id: template.id,
      label: template.displayName
    }));
  }, [workspace.templates]);

  const sortedSources = useMemo(() => {
    return [...workspace.sources].sort((left, right) => {
      return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    });
  }, [workspace.sources]);

  const sortedGeneratedSubscriptions = useMemo(() => {
    return [...workspace.generatedSubscriptions].sort((left, right) => {
      return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    });
  }, [workspace.generatedSubscriptions]);

  const sortedGeneratedDrafts = useMemo(() => {
    return [...workspace.generatedSubscriptionDrafts].sort((left, right) => {
      return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    });
  }, [workspace.generatedSubscriptionDrafts]);

  const openCreateSourceDialog = () => {
    setSourceEditingId(null);
    setSourceForm(emptySourceForm());
    setSourceErrorMessage(null);
    setSourceDialogOpen(true);
  };

  const openEditSourceDialog = (source: UpstreamSource) => {
    setSourceEditingId(source.id);
    setSourceForm(buildSourceForm(source));
    setSourceErrorMessage(null);
    setSourceDialogOpen(true);
  };

  const openCreateGeneratedDialog = async () => {
    const created = await workspace.createGeneratedSubscriptionDraft({
      displayName: "未命名生成订阅",
      upstreamSourceId: sourceOptions[0]?.id
    });

    await navigate({
      to: "/subscriptions/drafts/$draftId",
      params: {
        draftId: created.id
      }
    });
  };

  const openEditGeneratedDialog = (subscriptionId: string) => {
    const subscription = workspace.generatedSubscriptions.find((item) => item.id === subscriptionId);

    if (!subscription) {
      return;
    }

    setGeneratedEditingId(subscription.id);
    setGeneratedForm({
      displayName: subscription.displayName,
      upstreamSourceId: subscription.upstreamSourceId,
      templateId: subscription.templateId,
      visibility: subscription.visibility,
      shareMode: subscription.shareMode,
      isEnabled: subscription.isEnabled
    });
    setGeneratedErrorMessage(null);
    setGeneratedDialogOpen(true);
  };

  const handleSaveSource = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSourceSaving(true);
    setSourceErrorMessage(null);

    try {
      if (sourceEditingId) {
        await workspace.updateSource(sourceEditingId, sourceForm);
        setFeedbackMessage("外部订阅已更新。");
      } else {
        await workspace.createSource(sourceForm);
        setFeedbackMessage("新的外部订阅已创建。");
      }

      setSourceDialogOpen(false);
    } catch (error) {
      setSourceErrorMessage(error instanceof Error ? error.message : "保存失败。");
    } finally {
      setSourceSaving(false);
    }
  };

  const handleSaveGenerated = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setGeneratedSaving(true);
    setGeneratedErrorMessage(null);

    try {
      if (generatedEditingId) {
        await workspace.updateGeneratedSubscription(generatedEditingId, generatedForm);
        setFeedbackMessage("生成订阅已更新。");
      } else {
        await workspace.createGeneratedSubscription(generatedForm);
        setFeedbackMessage("新的生成订阅已创建。");
      }

      setGeneratedDialogOpen(false);
    } catch (error) {
      setGeneratedErrorMessage(error instanceof Error ? error.message : "保存失败。");
    } finally {
      setGeneratedSaving(false);
    }
  };

  const runAction = async (actionKey: string, action: () => Promise<void>, successMessage: string) => {
    setBusyActionKey(actionKey);
    setFeedbackMessage(null);

    try {
      await action();
      setFeedbackMessage(successMessage);
    } catch (error) {
      setFeedbackMessage(error instanceof Error ? error.message : "操作失败。");
    } finally {
      setBusyActionKey(null);
    }
  };

  const openSnapshotDialog = async (subscriptionId: string, displayName: string) => {
    setSnapshotDialogOpen(true);
    setSnapshotDialogTitle(displayName);
    setSnapshotLoading(true);
    setSnapshotCompare(null);

    try {
      const snapshots = await workspace.listGeneratedSubscriptionSnapshots(subscriptionId);
      setSnapshotItems(snapshots);

      if (snapshots.length >= 2) {
        const compare = await workspace.compareGeneratedSubscriptionSnapshots(
          subscriptionId,
          snapshots[1].id,
          snapshots[0].id
        );
        setSnapshotCompare(compare);
      }
    } catch (error) {
      setFeedbackMessage(error instanceof Error ? error.message : "载入快照历史失败。");
    } finally {
      setSnapshotLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="rounded-[32px] p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.18em] text-slate-400">Subscriptions</p>
            <h3 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
              统一管理来源与分发
            </h3>
            <p className="mt-2 text-sm text-slate-500">
              外部订阅负责接入远端数据，生成订阅则负责向客户端分发最终配置。
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" onClick={openCreateSourceDialog}>
              <Plus className="size-4" />
              新建外部订阅
            </Button>
            <Button
              onClick={() =>
                void runAction(
                  "generated-create-draft",
                  () => openCreateGeneratedDialog(),
                  "已创建新的生成订阅草稿。"
                )
              }
              disabled={sourceOptions.length === 0}
            >
              <Plus className="size-4" />
              新建生成订阅
            </Button>
          </div>
        </div>
      </Card>

      {feedbackMessage ? (
        <div className="rounded-[28px] border border-slate-200 bg-white/80 px-5 py-4 text-sm text-slate-600 shadow-[0_18px_45px_rgba(15,23,42,0.06)] backdrop-blur-xl">
          {feedbackMessage}
        </div>
      ) : null}

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList>
          <TabsTrigger value="upstream">外部订阅</TabsTrigger>
          <TabsTrigger value="generated">生成订阅</TabsTrigger>
        </TabsList>

        <TabsContent value="upstream">
          <div className="space-y-4">
            {sortedSources.length === 0 ? (
              <Card className="rounded-[32px] p-10 text-center text-sm text-slate-500">
                还没有外部订阅，先添加一个上游来源。
              </Card>
            ) : null}

            {sortedSources.map((source) => (
              <Card key={source.id} className="rounded-[32px] p-6">
                <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0 space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-xl font-semibold tracking-tight text-slate-950">
                        {source.displayName}
                      </h4>
                      <Badge className={syncStatusTone[source.lastSyncStatus]}>
                        {syncStatusText[source.lastSyncStatus]}
                      </Badge>
                      <Badge>{visibilityText[source.visibility]}</Badge>
                      <Badge>{shareModeText[source.shareMode]}</Badge>
                      {!source.isEnabled ? <Badge>已停用</Badge> : null}
                    </div>

                    <p className="break-all text-sm text-slate-500">{source.sourceUrl}</p>

                    <div className="grid gap-3 text-sm text-slate-500 sm:grid-cols-2 xl:grid-cols-4">
                      <p>代理数量：{source.proxyCount}</p>
                      <p>分组数量：{source.groupCount}</p>
                      <p>规则数量：{source.ruleCount}</p>
                      <p>最近同步：{formatTime(source.lastSyncAt)}</p>
                      <p>用量：{formatUsage(source.usage)}</p>
                      <p>到期时间：{formatExpire(source.usage)}</p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      disabled={busyActionKey === `source-sync-${source.id}`}
                      onClick={() =>
                        void runAction(
                          `source-sync-${source.id}`,
                          () => workspace.syncSource(source.id).then(() => undefined),
                          "外部订阅已同步。"
                        )
                      }
                    >
                      <RefreshCw className="size-4" />
                      同步
                    </Button>
                    <Button variant="ghost" onClick={() => openEditSourceDialog(source)}>
                      <PencilLine className="size-4" />
                      编辑
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={busyActionKey === `source-delete-${source.id}`}
                      onClick={() => {
                        if (!window.confirm(`确认删除外部订阅“${source.displayName}”？`)) {
                          return;
                        }

                        void runAction(
                          `source-delete-${source.id}`,
                          () => workspace.deleteSource(source.id),
                          "外部订阅已删除。"
                        );
                      }}
                    >
                      <Trash2 className="size-4" />
                      删除
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="generated">
          <div className="space-y-4">
            {sortedGeneratedDrafts.length > 0 ? (
              <Card className="rounded-[32px] p-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h4 className="text-xl font-semibold tracking-tight text-slate-950">
                      进行中的草稿
                    </h4>
                    <p className="mt-2 text-sm text-slate-500">
                      这些草稿还没有发布完成，可以继续进入向导补完。
                    </p>
                  </div>
                  <Badge>{sortedGeneratedDrafts.length} 个草稿</Badge>
                </div>

                <div className="mt-5 grid gap-4 xl:grid-cols-2">
                  {sortedGeneratedDrafts.slice(0, 6).map((draft) => (
                    <div
                      key={draft.id}
                      className="rounded-[26px] border border-slate-200 bg-slate-50/80 p-5"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-base font-semibold text-slate-950">{draft.displayName}</p>
                        <Badge>{draft.currentStep}</Badge>
                        <Badge>{draft.shareabilityStatus === "source_locked" ? "源锁定" : draft.shareabilityStatus === "shareable" ? "可共享" : "待预览"}</Badge>
                      </div>
                      <p className="mt-3 text-sm text-slate-500">
                        最近更新：{formatTime(draft.updatedAt)}
                      </p>
                      <div className="mt-4">
                        <Button
                          variant="secondary"
                          onClick={() =>
                            void navigate({
                              to: "/subscriptions/drafts/$draftId",
                              params: {
                                draftId: draft.id
                              }
                            })
                          }
                        >
                          <PencilLine className="size-4" />
                          继续编辑
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            ) : null}

            {sortedGeneratedSubscriptions.length === 0 ? (
              <Card className="rounded-[32px] p-10 text-center text-sm text-slate-500">
                还没有生成订阅，先接入一个外部订阅，然后进入向导开始构建。
              </Card>
            ) : null}

            {sortedGeneratedSubscriptions.map((subscription) => {
              const source = workspace.sources.find((item) => item.id === subscription.upstreamSourceId);
              const template = workspace.templates.find((item) => item.id === subscription.templateId);

              return (
                <Card key={subscription.id} className="rounded-[32px] p-6">
                  <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0 space-y-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-xl font-semibold tracking-tight text-slate-950">
                          {subscription.displayName}
                        </h4>
                        <Badge className={renderStatusTone[subscription.lastRenderStatus]}>
                          {renderStatusText[subscription.lastRenderStatus]}
                        </Badge>
                        <Badge className={syncStatusTone[subscription.lastSyncStatus]}>
                          {syncStatusText[subscription.lastSyncStatus]}
                        </Badge>
                        <Badge>{subscription.renderMode === "draft" ? "向导驱动" : "模板驱动"}</Badge>
                        <Badge>{visibilityText[subscription.visibility]}</Badge>
                        {!subscription.isEnabled ? <Badge>已停用</Badge> : null}
                      </div>

                      <div className="grid gap-3 text-sm text-slate-500 sm:grid-cols-2 xl:grid-cols-4">
                        <p>外部订阅：{source?.displayName ?? "已删除"}</p>
                        <p>
                          配置来源：
                          {subscription.renderMode === "draft"
                            ? "操作向导"
                            : template?.displayName ?? "已删除"}
                        </p>
                        <p>最近生成：{formatTime(subscription.lastRenderAt)}</p>
                        <p>最近同步：{formatTime(subscription.lastSyncAt)}</p>
                        <p>用量：{formatUsage(subscription.latestUsage)}</p>
                        <p>到期时间：{formatExpire(subscription.latestUsage)}</p>
                      </div>

                      {subscription.lastErrorMessage ? (
                        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                          {subscription.lastErrorMessage}
                        </div>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        disabled={busyActionKey === `generated-render-${subscription.id}`}
                        onClick={() =>
                          void runAction(
                            `generated-render-${subscription.id}`,
                            () =>
                              workspace
                                .renderGeneratedSubscription(subscription.id)
                                .then(() => undefined),
                            "生成订阅已重新生成。"
                          )
                        }
                      >
                        <RefreshCw className="size-4" />
                        立即生成
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={busyActionKey === `generated-copy-${subscription.id}`}
                        onClick={() =>
                          void runAction(
                            `generated-copy-${subscription.id}`,
                            async () => {
                              const link = await workspace.createTempLink(subscription.id);
                              await copyText(link);
                            },
                            "已复制 24 小时有效的临时拉取链接。"
                          )
                        }
                      >
                        <Copy className="size-4" />
                        复制链接
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => void openSnapshotDialog(subscription.id, subscription.displayName)}
                      >
                        <RefreshCw className="size-4" />
                        历史
                      </Button>
                      {subscription.renderMode === "draft" && subscription.draftId ? (
                        <Button
                          variant="ghost"
                          onClick={() => {
                            const nextDraftId = subscription.draftId;

                            if (!nextDraftId) {
                              return;
                            }

                            void navigate({
                              to: "/subscriptions/drafts/$draftId",
                              params: {
                                draftId: nextDraftId
                              }
                            });
                          }}
                        >
                          <PencilLine className="size-4" />
                          打开向导
                        </Button>
                      ) : (
                        <Button variant="ghost" onClick={() => openEditGeneratedDialog(subscription.id)}>
                          <PencilLine className="size-4" />
                          编辑
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        disabled={busyActionKey === `generated-delete-${subscription.id}`}
                        onClick={() => {
                          if (!window.confirm(`确认删除生成订阅“${subscription.displayName}”？`)) {
                            return;
                          }

                          void runAction(
                            `generated-delete-${subscription.id}`,
                            () => workspace.deleteGeneratedSubscription(subscription.id),
                            "生成订阅已删除。"
                          );
                        }}
                      >
                        <Trash2 className="size-4" />
                        删除
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>

      <SourceDialog
        open={sourceDialogOpen}
        title={sourceEditingId ? "编辑外部订阅" : "新建外部订阅"}
        description="接入原始 Mihomo 订阅链接，并控制它的共享方式。"
        form={sourceForm}
        isSaving={sourceSaving}
        errorMessage={sourceErrorMessage}
        onOpenChange={(nextOpen) => {
          setSourceDialogOpen(nextOpen);
          if (!nextOpen) {
            setSourceErrorMessage(null);
          }
        }}
        onSubmit={handleSaveSource}
        onChange={setSourceForm}
      />

      <GeneratedDialog
        open={generatedDialogOpen}
        title={generatedEditingId ? "编辑生成订阅" : "新建生成订阅"}
        description="选择一个外部订阅和一个模板，组合出最终可分发的配置。"
        form={generatedForm}
        isSaving={generatedSaving}
        errorMessage={generatedErrorMessage}
        sourceOptions={sourceOptions}
        templateOptions={templateOptions}
        onOpenChange={(nextOpen) => {
          setGeneratedDialogOpen(nextOpen);
          if (!nextOpen) {
            setGeneratedErrorMessage(null);
          }
        }}
        onSubmit={handleSaveGenerated}
        onChange={setGeneratedForm}
      />

      <Dialog
        open={snapshotDialogOpen}
        onOpenChange={(nextOpen) => {
          setSnapshotDialogOpen(nextOpen);
          if (!nextOpen) {
            setSnapshotItems([]);
            setSnapshotCompare(null);
            setSnapshotLoading(false);
          }
        }}
      >
        <DialogContent className="w-[min(96vw,1160px)]">
          <DialogHeader>
            <DialogTitle>{snapshotDialogTitle} · 快照历史</DialogTitle>
            <DialogDescription>
              查看最近生成结果，并对比最近两次快照的差异。
            </DialogDescription>
          </DialogHeader>

          {snapshotLoading ? (
            <div className="mt-6 rounded-[24px] border border-slate-200 bg-slate-50/80 px-5 py-10 text-center text-sm text-slate-500">
              正在载入快照历史...
            </div>
          ) : (
            <div className="mt-6 grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
              <div className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-4">
                <p className="text-sm font-semibold text-slate-950">历史快照</p>
                <ScrollArea className="mt-4 h-[560px] pr-4">
                  <div className="space-y-3">
                    {snapshotItems.map((snapshot) => (
                      <div
                        key={snapshot.id}
                        className="rounded-[20px] border border-slate-200 bg-white/90 p-4"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge>{snapshot.validationStatus === "success" ? "成功" : "失败"}</Badge>
                          <p className="text-sm font-medium text-slate-900">
                            {formatTime(snapshot.createdAt)}
                          </p>
                        </div>
                        <p className="mt-2 break-all text-xs text-slate-400">{snapshot.id}</p>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>

              <div className="space-y-4">
                <div className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="text-sm font-semibold text-slate-950">最近两次对比</p>
                    {snapshotCompare ? (
                      <>
                        <Badge>新增 {snapshotCompare.summary.addedLineCount} 行</Badge>
                        <Badge>移除 {snapshotCompare.summary.removedLineCount} 行</Badge>
                      </>
                    ) : null}
                  </div>

                  {snapshotCompare ? (
                    <div className="mt-4 grid gap-4 xl:grid-cols-2">
                      <label className="block space-y-2">
                        <span className="text-sm font-medium text-emerald-700">新增行</span>
                        <Textarea
                          readOnly
                          value={snapshotCompare.addedLines.join("\n")}
                          className="min-h-48 font-mono text-xs"
                        />
                      </label>
                      <label className="block space-y-2">
                        <span className="text-sm font-medium text-rose-700">移除行</span>
                        <Textarea
                          readOnly
                          value={snapshotCompare.removedLines.join("\n")}
                          className="min-h-48 font-mono text-xs"
                        />
                      </label>
                    </div>
                  ) : (
                    <div className="mt-4 text-sm text-slate-500">还没有足够的快照用于对比。</div>
                  )}
                </div>

                {snapshotItems[0] ? (
                  <label className="block space-y-2">
                    <span className="text-sm font-medium text-slate-600">最新快照 YAML</span>
                    <Textarea
                      readOnly
                      value={snapshotItems[0].renderedYaml}
                      className="min-h-[320px] font-mono text-xs"
                    />
                  </label>
                ) : null}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
