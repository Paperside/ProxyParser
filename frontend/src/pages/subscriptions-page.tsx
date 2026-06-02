import { useNavigate } from "@tanstack/react-router";
import { Plus, Copy, KeyRound, PencilLine, RefreshCw, Share2, Trash2 } from "lucide-react";
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
import { Textarea } from "../components/ui/textarea";
import { API_BASE_URL } from "../lib/api";
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
import type {
  GeneratedSubscription,
  ShareMode,
  SubscriptionShareGrant,
  SubscriptionTempTokenSummary,
  UpstreamSource,
  Visibility
} from "../lib/types";
import { useAuth } from "../providers/auth-provider";
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
            <span className="text-sm font-medium text-[#5f5e58]">名称</span>
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
            <span className="text-sm font-medium text-[#5f5e58]">订阅链接</span>
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
              <span className="text-sm font-medium text-[#5f5e58]">可见性</span>
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
              <span className="text-sm font-medium text-[#5f5e58]">共享方式</span>
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

          <label className="flex items-center gap-3 rounded-lg border border-[#dedcd1] bg-[#f5f4ed]/80 px-4 py-3 text-sm text-[#5f5e58]">
            <input
              type="checkbox"
              checked={form.isEnabled}
              onChange={(event) => {
                onChange({
                  ...form,
                  isEnabled: event.target.checked
                });
              }}
              className="size-4 rounded border-[#c9c6ba] accent-[#c96442]"
            />
            启用这个订阅来源
          </label>

          {errorMessage ? (
            <div
              role="alert"
              className="rounded-lg border border-[#cd5c58]/50 bg-[#f7ecec] px-4 py-3 text-sm text-[#7f2c28]"
            >
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
            <span className="text-sm font-medium text-[#5f5e58]">名称</span>
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
              <span className="text-sm font-medium text-[#5f5e58]">外部订阅</span>
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
              <span className="text-sm font-medium text-[#5f5e58]">模板</span>
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
              <span className="text-sm font-medium text-[#5f5e58]">可见性</span>
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
              <span className="text-sm font-medium text-[#5f5e58]">共享方式</span>
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

          <label className="flex items-center gap-3 rounded-lg border border-[#dedcd1] bg-[#f5f4ed]/80 px-4 py-3 text-sm text-[#5f5e58]">
            <input
              type="checkbox"
              checked={form.isEnabled}
              onChange={(event) => {
                onChange({
                  ...form,
                  isEnabled: event.target.checked
                });
              }}
              className="size-4 rounded border-[#c9c6ba] accent-[#c96442]"
            />
            启用这个扩展订阅
          </label>

          {errorMessage ? (
            <div
              role="alert"
              className="rounded-lg border border-[#cd5c58]/50 bg-[#f7ecec] px-4 py-3 text-sm text-[#7f2c28]"
            >
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

export const SubscriptionsPage = ({
  section
}: {
  section: "upstream" | "generated";
}) => {
  const workspace = useWorkspace();
  const auth = useAuth();
  const navigate = useNavigate();
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
  const [accessDialogOpen, setAccessDialogOpen] = useState(false);
  const [accessSubscription, setAccessSubscription] = useState<GeneratedSubscription | null>(null);
  const [tempTokens, setTempTokens] = useState<SubscriptionTempTokenSummary[]>([]);
  const [shareGrants, setShareGrants] = useState<SubscriptionShareGrant[]>([]);
  const [accessLoading, setAccessLoading] = useState(false);

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
      displayName: "未命名扩展订阅",
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
        setFeedbackMessage("扩展订阅已更新。");
      } else {
        await workspace.createGeneratedSubscription(generatedForm);
        setFeedbackMessage("新的扩展订阅已创建。");
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

  const loadAccessState = async (subscription: GeneratedSubscription) => {
    setAccessLoading(true);

    try {
      const [nextTempTokens, nextShareGrants] = await Promise.all([
        workspace.listTempTokens(subscription.id),
        workspace.listShareGrants(subscription.id)
      ]);
      setTempTokens(nextTempTokens);
      setShareGrants(nextShareGrants);
    } catch (error) {
      setFeedbackMessage(error instanceof Error ? error.message : "载入访问控制失败。");
    } finally {
      setAccessLoading(false);
    }
  };

  const openAccessDialog = async (subscription: GeneratedSubscription) => {
    setAccessSubscription(subscription);
    setAccessDialogOpen(true);
    setTempTokens([]);
    setShareGrants([]);
    await loadAccessState(subscription);
  };

  const copyLongSubscriptionLink = async (subscription: GeneratedSubscription) => {
    let secret = auth.revealedSubscriptionSecret;

    if (!secret) {
      const shouldRotate = window.confirm(
        "当前没有可显示的长期 Key。是否生成新的长期 Key？这会使旧长期 Key 失效。"
      );

      if (!shouldRotate) {
        throw new Error("已取消生成长期 Key。");
      }

      secret = await workspace.rotateSubscriptionSecret(subscription.id);
    }

    await copyText(`${API_BASE_URL}/subscribe/${subscription.id}?token=${encodeURIComponent(secret)}`);
  };

  const createCustomTempLink = async (subscription: GeneratedSubscription) => {
    const rawHours = window.prompt("短期 Key 有效小时数", "24");

    if (rawHours === null) {
      throw new Error("已取消创建短期 Key。");
    }

    const hours = Number(rawHours);
    const normalizedHours = Number.isFinite(hours) && hours > 0 ? hours : 24;
    const link = await workspace.createTempLink(
      subscription.id,
      Math.round(normalizedHours * 60 * 60)
    );
    await copyText(link);
    await loadAccessState(subscription);
  };

  const resetLongKeyAndCopy = async (subscription: GeneratedSubscription) => {
    if (!window.confirm("确认重置长期 Key？旧的长期订阅链接会立即失效。")) {
      throw new Error("已取消重置长期 Key。");
    }

    const secret = await workspace.rotateSubscriptionSecret(subscription.id);
    await copyText(`${API_BASE_URL}/subscribe/${subscription.id}?token=${encodeURIComponent(secret)}`);
  };

  return (
    <div className="space-y-6">
      <Card className="rounded-lg p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-medium text-[#73726c]">订阅</p>
            <h3 className="mt-2 text-2xl font-semibold text-[#141413]">
              统一管理来源与分发
            </h3>
            <p className="mt-2 text-sm text-[#73726c]">
              外部订阅负责接入远端数据，扩展订阅负责重组、分流、共享并向客户端分发最终配置。
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            {section === "upstream" ? (
              <Button onClick={openCreateSourceDialog}>
                <Plus className="size-4" />
                新建外部订阅
              </Button>
            ) : (
              <Button
                onClick={() =>
                  void runAction(
                    "generated-create-draft",
                    () => openCreateGeneratedDialog(),
                    "已创建新的扩展订阅草稿。"
                  )
                }
              >
                <Plus className="size-4" />
                新建扩展订阅
              </Button>
            )}
          </div>
        </div>
      </Card>

      {feedbackMessage ? (
        <div
          role="status"
          aria-live="polite"
          className="rounded-lg border border-[#dedcd1] border-l-[#c96442] border-l-4 bg-[#fffdf8] px-5 py-4 text-sm text-[#5f5e58] shadow-[0_1px_2px_rgba(20,20,19,0.04)]"
        >
          {feedbackMessage}
        </div>
      ) : null}

      {section === "upstream" ? (
        <div className="space-y-4">
          {sortedSources.length === 0 ? (
            <Card className="rounded-lg p-10 text-center text-sm text-[#73726c]">
              还没有外部订阅，先添加一个上游来源。
            </Card>
          ) : null}

          {sortedSources.map((source) => (
            <Card key={source.id} className="rounded-lg p-6">
              <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                <div className="min-w-0 space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-xl font-semibold text-[#141413]">
                      {source.displayName}
                    </h4>
                    <Badge className={syncStatusTone[source.lastSyncStatus]}>
                      {syncStatusText[source.lastSyncStatus]}
                    </Badge>
                    <Badge>{visibilityText[source.visibility]}</Badge>
                    <Badge>{shareModeText[source.shareMode]}</Badge>
                    {!source.isEnabled ? <Badge>已停用</Badge> : null}
                  </div>

                  <p className="break-all text-sm text-[#73726c]">{source.sourceUrl}</p>

                  <div className="grid gap-3 text-sm text-[#73726c] sm:grid-cols-2 xl:grid-cols-4">
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
      ) : (
        <div className="space-y-4">
          {sortedGeneratedDrafts.length > 0 ? (
            <Card className="rounded-lg p-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h4 className="text-xl font-semibold text-[#141413]">
                    进行中的草稿
                  </h4>
                  <p className="mt-2 text-sm text-[#73726c]">
                    这些草稿还没有发布完成，可以继续进入向导补完。
                  </p>
                </div>
                <Badge>{sortedGeneratedDrafts.length} 个草稿</Badge>
              </div>

              <div className="mt-5 grid gap-4 xl:grid-cols-2">
                {sortedGeneratedDrafts.slice(0, 6).map((draft) => (
                  <div
                    key={draft.id}
                    className="rounded-lg border border-[#dedcd1] bg-[#f5f4ed]/80 p-5"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-base font-semibold text-[#141413]">{draft.displayName}</p>
                      <Badge>{draft.currentStep}</Badge>
                      <Badge>
                        {draft.shareabilityStatus === "source_locked"
                          ? "源锁定"
                          : draft.shareabilityStatus === "shareable"
                            ? "可共享"
                            : "待预览"}
                      </Badge>
                    </div>
                    <p className="mt-3 text-sm text-[#73726c]">
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
            <Card className="rounded-lg p-10 text-center text-sm text-[#73726c]">
              还没有扩展订阅，可以直接进入向导粘贴外部订阅链接并开始构建。
            </Card>
          ) : null}

          {sortedGeneratedSubscriptions.map((subscription) => {
            const source = workspace.sources.find((item) => item.id === subscription.upstreamSourceId);
            const template = workspace.templates.find((item) => item.id === subscription.templateId);

            return (
              <Card key={subscription.id} className="rounded-lg p-6">
                <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0 space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-xl font-semibold text-[#141413]">
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

                    <div className="grid gap-3 text-sm text-[#73726c] sm:grid-cols-2 xl:grid-cols-4">
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
                      <div className="rounded-lg border border-[#cd5c58]/50 bg-[#f7ecec] px-4 py-3 text-sm text-[#7f2c28]">
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
                          "扩展订阅已重新生成。"
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
                          () => createCustomTempLink(subscription),
                          "已复制短期 Key 拉取链接。"
                        )
                      }
                    >
                      <KeyRound className="size-4" />
                      短期 Key
                    </Button>
                    <Button variant="ghost" onClick={() => void openAccessDialog(subscription)}>
                      <Share2 className="size-4" />
                      共享与 Key
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
                        if (!window.confirm(`确认删除扩展订阅“${subscription.displayName}”？`)) {
                          return;
                        }

                        void runAction(
                          `generated-delete-${subscription.id}`,
                          () => workspace.deleteGeneratedSubscription(subscription.id),
                          "扩展订阅已删除。"
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
      )}

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
        title={generatedEditingId ? "编辑扩展订阅" : "新建扩展订阅"}
        description="选择外部订阅和模板，组合出最终可分发的配置。"
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
        open={accessDialogOpen}
        onOpenChange={(nextOpen) => {
          setAccessDialogOpen(nextOpen);
          if (!nextOpen) {
            setAccessSubscription(null);
            setTempTokens([]);
            setShareGrants([]);
          }
        }}
      >
        <DialogContent className="w-[min(96vw,980px)]">
          <DialogHeader>
            <DialogTitle>{accessSubscription?.displayName ?? "扩展订阅"} · 共享与 Key</DialogTitle>
            <DialogDescription>
              管理短期 Key、长期 Key 和订阅共享范围。长期 Key 属于当前账号，重置后旧长期链接会失效。
            </DialogDescription>
          </DialogHeader>

          {accessSubscription ? (
            <div className="mt-6 space-y-6">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <Button
                  variant="secondary"
                  onClick={() =>
                    void runAction(
                      `access-copy-long-${accessSubscription.id}`,
                      () => copyLongSubscriptionLink(accessSubscription),
                      "已复制长期 Key 拉取链接。"
                    )
                  }
                >
                  <Copy className="size-4" />
                  长期链接
                </Button>
                <Button
                  variant="ghost"
                  onClick={() =>
                    void runAction(
                      `access-reset-long-${accessSubscription.id}`,
                      () => resetLongKeyAndCopy(accessSubscription),
                      "长期 Key 已重置，新链接已复制。"
                    )
                  }
                >
                  <RefreshCw className="size-4" />
                  重置长期 Key
                </Button>
                <Button
                  variant="secondary"
                  onClick={() =>
                    void runAction(
                      `access-temp-${accessSubscription.id}`,
                      () => createCustomTempLink(accessSubscription),
                      "短期 Key 链接已复制。"
                    )
                  }
                >
                  <KeyRound className="size-4" />
                  新建短期 Key
                </Button>
                <Button
                  variant="ghost"
                  onClick={() =>
                    void runAction(
                      `access-share-public-${accessSubscription.id}`,
                      async () => {
                        await workspace.upsertShareGrant(accessSubscription.id, {
                          scope: "public",
                          mode: "subscribe"
                        });
                        await workspace.updateGeneratedSubscription(accessSubscription.id, {
                          visibility: "public",
                          shareMode: "view"
                        });
                        await loadAccessState(accessSubscription);
                      },
                      "已共享给所有用户。"
                    )
                  }
                >
                  <Share2 className="size-4" />
                  共享所有人
                </Button>
                <Button
                  variant="ghost"
                  onClick={() =>
                    void runAction(
                      `access-share-user-${accessSubscription.id}`,
                      async () => {
                        const email = window.prompt("输入要共享的用户邮箱");

                        if (!email?.trim()) {
                          throw new Error("已取消共享用户。");
                        }

                        await workspace.upsertShareGrant(accessSubscription.id, {
                          scope: "user",
                          mode: "subscribe",
                          targetEmail: email.trim()
                        });
                        await loadAccessState(accessSubscription);
                      },
                      "已共享给指定用户。"
                    )
                  }
                >
                  <Share2 className="size-4" />
                  共享用户
                </Button>
              </div>

              {accessLoading ? (
                <div className="rounded-lg border border-[#dedcd1] bg-[#f5f4ed]/80 px-5 py-8 text-center text-sm text-[#73726c]">
                  正在载入访问控制...
                </div>
              ) : (
                <div className="grid gap-6 xl:grid-cols-2">
                  <div className="rounded-lg border border-[#dedcd1] bg-[#f5f4ed]/80 p-5">
                    <div className="flex items-center justify-between">
                      <h4 className="text-lg font-semibold text-[#141413]">短期 Key</h4>
                      <Badge>{tempTokens.length} 个记录</Badge>
                    </div>
                    <ScrollArea className="mt-4 h-[320px] pr-4">
                      <div className="space-y-3">
                        {tempTokens.length === 0 ? (
                          <p className="rounded-lg border border-dashed border-[#dedcd1] bg-[#fffdf8] px-4 py-8 text-center text-sm text-[#73726c]">
                            还没有短期 Key。
                          </p>
                        ) : null}
                        {tempTokens.map((token) => {
                          const isRevoked = Boolean(token.revokedAt);
                          const isExpired = new Date(token.expiresAt).getTime() <= Date.now();

                          return (
                            <div
                              key={token.id}
                              className="rounded-lg border border-[#dedcd1] bg-[#fffdf8] p-4"
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge
                                  className={
                                    isRevoked || isExpired
                                      ? "border-[#dedcd1] bg-[#f5f4ed] text-[#73726c]"
                                      : "border-[#7ab948]/40 bg-[#e9f1dc] text-[#265b19]"
                                  }
                                >
                                  {isRevoked ? "已失效" : isExpired ? "已过期" : "有效"}
                                </Badge>
                                <p className="text-sm font-medium text-[#141413]">
                                  {token.label ?? token.id}
                                </p>
                              </div>
                              <div className="mt-3 space-y-1 text-xs text-[#73726c]">
                                <p>创建：{formatTime(token.createdAt)}</p>
                                <p>过期：{formatTime(token.expiresAt)}</p>
                                <p>最近使用：{formatTime(token.lastUsedAt)}</p>
                              </div>
                              {!isRevoked ? (
                                <div className="mt-4">
                                  <Button
                                    variant="ghost"
                                    onClick={() =>
                                      void runAction(
                                        `access-revoke-temp-${token.id}`,
                                        async () => {
                                          await workspace.revokeTempToken(accessSubscription.id, token.id);
                                          await loadAccessState(accessSubscription);
                                        },
                                        "短期 Key 已失效。"
                                      )
                                    }
                                  >
                                    <Trash2 className="size-4" />
                                    立即失效
                                  </Button>
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </ScrollArea>
                  </div>

                  <div className="rounded-lg border border-[#dedcd1] bg-[#f5f4ed]/80 p-5">
                    <div className="flex items-center justify-between">
                      <h4 className="text-lg font-semibold text-[#141413]">共享授权</h4>
                      <Badge>{shareGrants.length} 个记录</Badge>
                    </div>
                    <ScrollArea className="mt-4 h-[320px] pr-4">
                      <div className="space-y-3">
                        {shareGrants.length === 0 ? (
                          <p className="rounded-lg border border-dashed border-[#dedcd1] bg-[#fffdf8] px-4 py-8 text-center text-sm text-[#73726c]">
                            当前仅自己可管理。
                          </p>
                        ) : null}
                        {shareGrants.map((grant) => (
                          <div
                            key={grant.id}
                            className="rounded-lg border border-[#dedcd1] bg-[#fffdf8] p-4"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge>
                                {grant.scope === "public"
                                  ? "所有用户"
                                  : grant.scope === "user"
                                    ? "指定用户"
                                    : "凭链接"}
                              </Badge>
                              <Badge>{grant.mode === "subscribe" ? "可订阅" : grant.mode}</Badge>
                              {grant.revokedAt ? <Badge>已撤销</Badge> : null}
                            </div>
                            <p className="mt-3 text-sm text-[#5f5e58]">
                              {grant.targetEmail ?? grant.targetUserId ?? "全局共享"}
                            </p>
                            <p className="mt-2 text-xs text-[#73726c]">
                              更新：{formatTime(grant.updatedAt)}
                            </p>
                            {!grant.revokedAt ? (
                              <div className="mt-4">
                                <Button
                                  variant="ghost"
                                  onClick={() =>
                                    void runAction(
                                      `access-revoke-share-${grant.id}`,
                                      async () => {
                                        await workspace.revokeShareGrant(
                                          accessSubscription.id,
                                          grant.id
                                        );
                                        await loadAccessState(accessSubscription);
                                      },
                                      "共享授权已撤销。"
                                    )
                                  }
                                >
                                  <Trash2 className="size-4" />
                                  撤销共享
                                </Button>
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

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
            <div className="mt-6 rounded-lg border border-[#dedcd1] bg-[#f5f4ed]/80 px-5 py-10 text-center text-sm text-[#73726c]">
              正在载入快照历史...
            </div>
          ) : (
            <div className="mt-6 grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
              <div className="rounded-lg border border-[#dedcd1] bg-[#f5f4ed]/80 p-4">
                <p className="text-sm font-semibold text-[#141413]">历史快照</p>
                <ScrollArea className="mt-4 h-[560px] pr-4">
                  <div className="space-y-3">
                    {snapshotItems.map((snapshot) => (
                      <div
                        key={snapshot.id}
                        className="rounded-lg border border-[#dedcd1] bg-[#fffdf8] p-4"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge>{snapshot.validationStatus === "success" ? "成功" : "失败"}</Badge>
                          <p className="text-sm font-medium text-[#141413]">
                            {formatTime(snapshot.createdAt)}
                          </p>
                        </div>
                        <p className="mt-2 break-all text-xs text-[#9c9a92]">{snapshot.id}</p>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>

              <div className="space-y-4">
                <div className="rounded-lg border border-[#dedcd1] bg-[#f5f4ed]/80 p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="text-sm font-semibold text-[#141413]">最近两次对比</p>
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
                        <span className="text-sm font-medium text-[#265b19]">新增行</span>
                        <Textarea
                          readOnly
                          value={snapshotCompare.addedLines.join("\n")}
                          className="min-h-48 font-mono text-xs"
                        />
                      </label>
                      <label className="block space-y-2">
                        <span className="text-sm font-medium text-[#7f2c28]">移除行</span>
                        <Textarea
                          readOnly
                          value={snapshotCompare.removedLines.join("\n")}
                          className="min-h-48 font-mono text-xs"
                        />
                      </label>
                    </div>
                  ) : (
                    <div className="mt-4 text-sm text-[#73726c]">还没有足够的快照用于对比。</div>
                  )}
                </div>

                {snapshotItems[0] ? (
                  <label className="block space-y-2">
                    <span className="text-sm font-medium text-[#5f5e58]">最新快照 YAML</span>
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
