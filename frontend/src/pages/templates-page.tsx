import { Copy, ExternalLink, Layers3, PencilLine, Plus, RefreshCw, Trash2 } from "lucide-react";
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
import {
  formatRelativeDate,
  publishStatusText,
  shareModeText,
  visibilityText
} from "../lib/format";
import type { ShareMode, TemplateDetail, TemplatePayload, Visibility } from "../lib/types";
import { useWorkspace } from "../providers/workspace-provider";

type TemplateEditorState = {
  displayName: string;
  slug: string;
  description: string;
  visibility: Visibility;
  shareMode: ShareMode;
  publishStatus: "draft" | "published" | "archived";
  versionNote: string;
  rulesMode: "patch" | "full_override";
  groupsMode: "patch" | "full_override";
  configMode: "patch" | "full_override";
  customProxiesPolicy: "append" | "replace_same_name" | "fail_on_conflict";
  ruleProviderRefsText: string;
  rulesText: string;
  proxyGroupsJson: string;
  configPatchJson: string;
  customProxiesJson: string;
  exportedYaml: string;
};

const emptyTemplateForm = (): TemplateEditorState => ({
  displayName: "",
  slug: "",
  description: "",
  visibility: "private",
  shareMode: "disabled",
  publishStatus: "draft",
  versionNote: "",
  rulesMode: "patch",
  groupsMode: "patch",
  configMode: "patch",
  customProxiesPolicy: "append",
  ruleProviderRefsText: "",
  rulesText: "",
  proxyGroupsJson: "[]",
  configPatchJson: "{}",
  customProxiesJson: "[]",
  exportedYaml: ""
});

const formatJson = (value: unknown) => {
  return JSON.stringify(value, null, 2);
};

const normalizeLines = (value: string) => {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
};

const buildTemplateForm = (detail?: TemplateDetail): TemplateEditorState => {
  if (!detail) {
    return emptyTemplateForm();
  }

  return {
    displayName: detail.displayName,
    slug: detail.slug ?? "",
    description: detail.description ?? "",
    visibility: detail.visibility,
    shareMode: detail.shareMode,
    publishStatus: detail.publishStatus,
    versionNote: detail.versionNote ?? "",
    rulesMode: detail.payload.rulesMode,
    groupsMode: detail.payload.groupsMode,
    configMode: detail.payload.configMode,
    customProxiesPolicy: detail.payload.customProxiesPolicy,
    ruleProviderRefsText: detail.payload.ruleProviderRefs.join("\n"),
    rulesText: detail.payload.rules.join("\n"),
    proxyGroupsJson: formatJson(detail.payload.proxyGroups),
    configPatchJson: formatJson(detail.payload.configPatch),
    customProxiesJson: formatJson(detail.payload.customProxies),
    exportedYaml: detail.exportedYaml ?? ""
  };
};

const parseTemplatePayload = (form: TemplateEditorState): TemplatePayload => {
  let proxyGroupsValue: unknown;
  let configPatchValue: unknown;
  let customProxiesValue: unknown;

  try {
    proxyGroupsValue = JSON.parse(form.proxyGroupsJson);
  } catch {
    throw new Error("规则组 JSON 不是合法格式。");
  }

  try {
    configPatchValue = JSON.parse(form.configPatchJson);
  } catch {
    throw new Error("配置 JSON 不是合法格式。");
  }

  try {
    customProxiesValue = JSON.parse(form.customProxiesJson);
  } catch {
    throw new Error("自定义节点 JSON 不是合法格式。");
  }

  if (!Array.isArray(proxyGroupsValue)) {
    throw new Error("规则组 JSON 必须是数组。");
  }

  if (typeof configPatchValue !== "object" || configPatchValue === null || Array.isArray(configPatchValue)) {
    throw new Error("配置 JSON 必须是对象。");
  }

  if (!Array.isArray(customProxiesValue)) {
    throw new Error("自定义节点 JSON 必须是数组。");
  }

  return {
    rulesMode: form.rulesMode,
    groupsMode: form.groupsMode,
    configMode: form.configMode,
    customProxiesPolicy: form.customProxiesPolicy,
    ruleProviderRefs: normalizeLines(form.ruleProviderRefsText),
    rules: normalizeLines(form.rulesText),
    proxyGroups: proxyGroupsValue as TemplatePayload["proxyGroups"],
    configPatch: configPatchValue as TemplatePayload["configPatch"],
    customProxies: customProxiesValue as TemplatePayload["customProxies"]
  };
};

const TemplateDialog = ({
  open,
  form,
  isSaving,
  isLoadingDetail,
  errorMessage,
  editingId,
  onOpenChange,
  onSubmit,
  onChange
}: {
  open: boolean;
  form: TemplateEditorState;
  isSaving: boolean;
  isLoadingDetail: boolean;
  errorMessage: string | null;
  editingId: string | null;
  onOpenChange: (nextOpen: boolean) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onChange: (nextForm: TemplateEditorState) => void;
}) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(96vw,1180px)]">
        <DialogHeader>
          <DialogTitle>{editingId ? "编辑模板" : "新建模板"}</DialogTitle>
          <DialogDescription>
            管理规则、分组、配置与自定义节点，决定最终生成订阅的重构方式。
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="mt-6 h-[min(78vh,820px)] pr-4">
          {isLoadingDetail ? (
            <div className="rounded-[24px] border border-slate-200 bg-slate-50/80 px-5 py-10 text-center text-sm text-slate-500">
              正在载入模板详情...
            </div>
          ) : (
            <form className="space-y-6 pb-2" onSubmit={onSubmit}>
              <section className="grid gap-4 md:grid-cols-2">
                <label className="block space-y-2">
                  <span className="text-sm font-medium text-slate-600">模板名称</span>
                  <Input
                    required
                    value={form.displayName}
                    onChange={(event) => {
                      onChange({
                        ...form,
                        displayName: event.target.value
                      });
                    }}
                    placeholder="例如：流媒体增强 / 极简直连"
                  />
                </label>

                <label className="block space-y-2">
                  <span className="text-sm font-medium text-slate-600">Slug</span>
                  <Input
                    value={form.slug}
                    onChange={(event) => {
                      onChange({
                        ...form,
                        slug: event.target.value
                      });
                    }}
                    placeholder="market-friendly-slug"
                  />
                </label>

                <label className="block space-y-2 md:col-span-2">
                  <span className="text-sm font-medium text-slate-600">描述</span>
                  <Textarea
                    value={form.description}
                    onChange={(event) => {
                      onChange({
                        ...form,
                        description: event.target.value
                      });
                    }}
                    placeholder="简要说明这个模板适合什么场景。"
                  />
                </label>
              </section>

              <section className="grid gap-4 md:grid-cols-3">
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

                <label className="block space-y-2">
                  <span className="text-sm font-medium text-slate-600">发布状态</span>
                  <Select
                    value={form.publishStatus}
                    onValueChange={(value) => {
                      onChange({
                        ...form,
                        publishStatus: value as TemplateEditorState["publishStatus"]
                      });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">草稿</SelectItem>
                      <SelectItem value="published">发布到市场</SelectItem>
                      <SelectItem value="archived">归档</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
              </section>

              <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <label className="block space-y-2">
                  <span className="text-sm font-medium text-slate-600">规则模式</span>
                  <Select
                    value={form.rulesMode}
                    onValueChange={(value) => {
                      onChange({
                        ...form,
                        rulesMode: value as TemplateEditorState["rulesMode"]
                      });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="patch">Patch</SelectItem>
                      <SelectItem value="full_override">Full Override</SelectItem>
                    </SelectContent>
                  </Select>
                </label>

                <label className="block space-y-2">
                  <span className="text-sm font-medium text-slate-600">分组模式</span>
                  <Select
                    value={form.groupsMode}
                    onValueChange={(value) => {
                      onChange({
                        ...form,
                        groupsMode: value as TemplateEditorState["groupsMode"]
                      });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="patch">Patch</SelectItem>
                      <SelectItem value="full_override">Full Override</SelectItem>
                    </SelectContent>
                  </Select>
                </label>

                <label className="block space-y-2">
                  <span className="text-sm font-medium text-slate-600">配置模式</span>
                  <Select
                    value={form.configMode}
                    onValueChange={(value) => {
                      onChange({
                        ...form,
                        configMode: value as TemplateEditorState["configMode"]
                      });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="patch">Patch</SelectItem>
                      <SelectItem value="full_override">Full Override</SelectItem>
                    </SelectContent>
                  </Select>
                </label>

                <label className="block space-y-2">
                  <span className="text-sm font-medium text-slate-600">自定义节点冲突策略</span>
                  <Select
                    value={form.customProxiesPolicy}
                    onValueChange={(value) => {
                      onChange({
                        ...form,
                        customProxiesPolicy: value as TemplateEditorState["customProxiesPolicy"]
                      });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="append">追加</SelectItem>
                      <SelectItem value="replace_same_name">同名替换</SelectItem>
                      <SelectItem value="fail_on_conflict">冲突时报错</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
              </section>

              <section className="grid gap-4 xl:grid-cols-2">
                <label className="block space-y-2">
                  <span className="text-sm font-medium text-slate-600">规则源引用</span>
                  <Textarea
                    value={form.ruleProviderRefsText}
                    onChange={(event) => {
                      onChange({
                        ...form,
                        ruleProviderRefsText: event.target.value
                      });
                    }}
                    className="min-h-40 font-mono text-xs"
                    placeholder="每行一个规则源标识"
                  />
                </label>

                <label className="block space-y-2">
                  <span className="text-sm font-medium text-slate-600">规则列表</span>
                  <Textarea
                    value={form.rulesText}
                    onChange={(event) => {
                      onChange({
                        ...form,
                        rulesText: event.target.value
                      });
                    }}
                    className="min-h-40 font-mono text-xs"
                    placeholder="每行一条 Mihomo 规则"
                  />
                </label>
              </section>

              <section className="grid gap-4 xl:grid-cols-2">
                <label className="block space-y-2">
                  <span className="text-sm font-medium text-slate-600">规则组 JSON</span>
                  <Textarea
                    value={form.proxyGroupsJson}
                    onChange={(event) => {
                      onChange({
                        ...form,
                        proxyGroupsJson: event.target.value
                      });
                    }}
                    className="min-h-64 font-mono text-xs"
                  />
                </label>

                <label className="block space-y-2">
                  <span className="text-sm font-medium text-slate-600">配置 JSON</span>
                  <Textarea
                    value={form.configPatchJson}
                    onChange={(event) => {
                      onChange({
                        ...form,
                        configPatchJson: event.target.value
                      });
                    }}
                    className="min-h-64 font-mono text-xs"
                  />
                </label>

                <label className="block space-y-2">
                  <span className="text-sm font-medium text-slate-600">自定义节点 JSON</span>
                  <Textarea
                    value={form.customProxiesJson}
                    onChange={(event) => {
                      onChange({
                        ...form,
                        customProxiesJson: event.target.value
                      });
                    }}
                    className="min-h-64 font-mono text-xs"
                  />
                </label>

                <label className="block space-y-2">
                  <span className="text-sm font-medium text-slate-600">版本备注</span>
                  <Textarea
                    value={form.versionNote}
                    onChange={(event) => {
                      onChange({
                        ...form,
                        versionNote: event.target.value
                      });
                    }}
                    className="min-h-40"
                    placeholder="记录这次模板变更的意图。"
                  />
                </label>
              </section>

              {form.exportedYaml ? (
                <section className="space-y-2">
                  <span className="text-sm font-medium text-slate-600">当前导出预览</span>
                  <Textarea value={form.exportedYaml} readOnly className="min-h-72 font-mono text-xs" />
                </section>
              ) : null}

              {errorMessage ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {errorMessage}
                </div>
              ) : null}

              <div className="flex justify-end">
                <Button type="submit" disabled={isSaving}>
                  {isSaving ? "保存中..." : "保存模板"}
                </Button>
              </div>
            </form>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
};

export const TemplatesPage = () => {
  const workspace = useWorkspace();
  const [activeTab, setActiveTab] = useState("mine");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<TemplateEditorState>(emptyTemplateForm);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [busyActionId, setBusyActionId] = useState<string | null>(null);
  const [rulesetForm, setRulesetForm] = useState({
    name: "",
    slug: "",
    description: "",
    sourceUrl: "",
    visibility: "private" as Visibility,
    behavior: "classical" as "domain" | "ipcidr" | "classical"
  });

  const sortedTemplates = useMemo(() => {
    return [...workspace.templates].sort((left, right) => {
      return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    });
  }, [workspace.templates]);

  const customRulesets = useMemo(() => {
    return workspace.marketplaceRulesets.filter((ruleset) => !ruleset.isOfficial);
  }, [workspace.marketplaceRulesets]);

  const officialRulesets = useMemo(() => {
    return workspace.marketplaceRulesets.filter((ruleset) => ruleset.isOfficial);
  }, [workspace.marketplaceRulesets]);

  const openCreateDialog = () => {
    setEditingId(null);
    setForm(emptyTemplateForm());
    setErrorMessage(null);
    setDialogOpen(true);
  };

  const openEditDialog = async (templateId: string) => {
    setDialogOpen(true);
    setEditingId(templateId);
    setIsLoadingDetail(true);
    setErrorMessage(null);

    try {
      const detail = await workspace.getTemplateDetail(templateId);
      setForm(buildTemplateForm(detail));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "模板详情载入失败。");
    } finally {
      setIsLoadingDetail(false);
    }
  };

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSaving(true);
    setErrorMessage(null);

    try {
      const payload = parseTemplatePayload(form);
      const requestBody = {
        displayName: form.displayName,
        slug: form.slug || undefined,
        description: form.description || undefined,
        visibility: form.visibility,
        shareMode: form.shareMode,
        publishStatus: form.publishStatus,
        versionNote: form.versionNote || undefined,
        payload
      };

      if (editingId) {
        await workspace.updateTemplate(editingId, requestBody);
        setDialogOpen(false);
        setFeedbackMessage("模板已更新。");
      } else {
        await workspace.createTemplate(requestBody);
        setDialogOpen(false);
        setFeedbackMessage("模板已创建。");
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "保存失败。");
    } finally {
      setIsSaving(false);
    }
  };

  const runDelete = async (templateId: string, displayName: string) => {
    if (!window.confirm(`确认删除模板“${displayName}”？`)) {
      return;
    }

    setBusyActionId(templateId);
    setFeedbackMessage(null);

    try {
      await workspace.deleteTemplate(templateId);
      setFeedbackMessage("模板已删除。");
    } catch (error) {
      setFeedbackMessage(error instanceof Error ? error.message : "删除失败。");
    } finally {
      setBusyActionId(null);
    }
  };

  const handleForkTemplate = async (templateId: string, displayName: string) => {
    setBusyActionId(`fork-${templateId}`);
    setFeedbackMessage(null);

    try {
      await workspace.forkTemplate(templateId);
      setFeedbackMessage(`已将模板“${displayName}”复制到我的模板。`);
      setActiveTab("mine");
    } catch (error) {
      setFeedbackMessage(error instanceof Error ? error.message : "复制模板失败。");
    } finally {
      setBusyActionId(null);
    }
  };

  const handleCreateRuleset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusyActionId("create-ruleset");
    setFeedbackMessage(null);

    try {
      await workspace.createRuleset(rulesetForm);
      setRulesetForm({
        name: "",
        slug: "",
        description: "",
        sourceUrl: "",
        visibility: "private",
        behavior: "classical"
      });
      setFeedbackMessage("第三方规则源已导入并加入你的规则目录。");
    } catch (error) {
      setFeedbackMessage(error instanceof Error ? error.message : "导入规则源失败。");
    } finally {
      setBusyActionId(null);
    }
  };

  const runRulesetAction = async (
    actionId: string,
    action: () => Promise<void>,
    successMessage: string
  ) => {
    setBusyActionId(actionId);
    setFeedbackMessage(null);

    try {
      await action();
      setFeedbackMessage(successMessage);
    } catch (error) {
      setFeedbackMessage(error instanceof Error ? error.message : "操作失败。");
    } finally {
      setBusyActionId(null);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="rounded-[32px] p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.18em] text-slate-400">Templates</p>
            <h3 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
              让配置重构可复用
            </h3>
            <p className="mt-2 text-sm text-slate-500">
              模板定义规则、规则组、配置覆盖与自定义节点，是生成订阅的核心能力。
            </p>
          </div>

          <Button onClick={openCreateDialog}>
            <Plus className="size-4" />
            新建模板
          </Button>
        </div>
      </Card>

      {feedbackMessage ? (
        <div className="rounded-[28px] border border-slate-200 bg-white/80 px-5 py-4 text-sm text-slate-600 shadow-[0_18px_45px_rgba(15,23,42,0.06)] backdrop-blur-xl">
          {feedbackMessage}
        </div>
      ) : null}

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList>
          <TabsTrigger value="mine">我的模板</TabsTrigger>
          <TabsTrigger value="market">模板市场</TabsTrigger>
        </TabsList>

        <TabsContent value="mine">
          <div className="space-y-4">
            {sortedTemplates.length === 0 ? (
              <Card className="rounded-[32px] p-10 text-center text-sm text-slate-500">
                还没有模板，创建一个模板来定义你的规则与配置重构方案。
              </Card>
            ) : null}

            {sortedTemplates.map((template) => (
              <Card key={template.id} className="rounded-[32px] p-6">
                <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-xl font-semibold tracking-tight text-slate-950">
                        {template.displayName}
                      </h4>
                      <Badge>{publishStatusText[template.publishStatus]}</Badge>
                      <Badge>{visibilityText[template.visibility]}</Badge>
                      <Badge>{shareModeText[template.shareMode]}</Badge>
                      <Badge>版本 {template.latestVersion}</Badge>
                    </div>
                    <p className="text-sm text-slate-500">{template.description ?? "暂无说明"}</p>
                    <div className="grid gap-2 text-sm text-slate-500 sm:grid-cols-2 xl:grid-cols-3">
                      <p>Slug：{template.slug ?? "未设置"}</p>
                      <p>最近更新：{formatRelativeDate(template.updatedAt)}</p>
                      <p>版本号：{template.latestVersion}</p>
                    </div>
                    {template.sourceLabel ? (
                      <p className="text-sm text-slate-500">
                        来源：{template.sourceLabel}
                        {template.sourceUrl ? (
                          <>
                            {" · "}
                            <a
                              href={template.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-slate-700 underline-offset-4 hover:underline"
                            >
                              查看来源
                            </a>
                          </>
                        ) : null}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" onClick={() => void openEditDialog(template.id)}>
                      <PencilLine className="size-4" />
                      编辑
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={busyActionId === template.id}
                      onClick={() => void runDelete(template.id, template.displayName)}
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

        <TabsContent value="market">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <Card className="rounded-[32px] p-6">
              <div className="flex items-center gap-3">
                <div className="flex size-11 items-center justify-center rounded-2xl bg-slate-950 text-white">
                  <Layers3 className="size-5" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold tracking-tight text-slate-950">社区模板</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    来自公开模板库，适合作为你自己的模板参考。
                  </p>
                </div>
              </div>

              <div className="mt-6 space-y-4">
                {workspace.marketplaceTemplates.length === 0 ? (
                  <div className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50/80 px-4 py-8 text-center text-sm text-slate-500">
                    当前还没有公开模板。
                  </div>
                ) : null}

                {workspace.marketplaceTemplates.map((template) => (
                  <div
                    key={template.id}
                    className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-4"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-slate-950">{template.displayName}</p>
                      {template.isOfficial ? (
                        <Badge className="border-sky-200 bg-sky-50 text-sky-700">官方</Badge>
                      ) : null}
                      <Badge>{publishStatusText[template.publishStatus]}</Badge>
                      <Badge>{visibilityText[template.visibility]}</Badge>
                    </div>
                    <p className="mt-2 text-sm text-slate-500">
                      {template.description ?? "暂无说明"}
                    </p>
                    <p className="mt-3 text-sm text-slate-500">
                      作者：{template.ownerDisplayName ?? template.ownerUserId}
                    </p>
                    {template.sourceLabel ? (
                      <p className="mt-2 text-sm text-slate-500">
                        来源：{template.sourceLabel}
                        {template.sourceUrl ? (
                          <>
                            {" · "}
                            <a
                              href={template.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-slate-700 underline-offset-4 hover:underline"
                            >
                              查看
                            </a>
                          </>
                        ) : null}
                      </p>
                    ) : null}
                    <p className="mt-3 text-xs uppercase tracking-[0.16em] text-slate-400">
                      {template.slug ?? "未设置 Slug"}
                    </p>
                    <div className="mt-4">
                      <Button
                        variant="secondary"
                        disabled={busyActionId === `fork-${template.id}`}
                        onClick={() => void handleForkTemplate(template.id, template.displayName)}
                      >
                        <Copy className="size-4" />
                        复制到我的模板
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="rounded-[32px] p-6">
              <div className="flex items-center gap-3">
                <div className="flex size-11 items-center justify-center rounded-2xl bg-slate-950 text-white">
                  <ExternalLink className="size-5" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold tracking-tight text-slate-950">内置规则源</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    官方规则源会定时同步；你也可以导入第三方规则源，在向导和模板里直接引用。
                  </p>
                </div>
              </div>

              <form className="mt-6 space-y-4 rounded-[24px] border border-slate-200 bg-slate-50/80 p-4" onSubmit={handleCreateRuleset}>
                <div className="grid gap-4 xl:grid-cols-2">
                  <label className="block space-y-2">
                    <span className="text-sm font-medium text-slate-600">规则源名称</span>
                    <Input
                      required
                      value={rulesetForm.name}
                      onChange={(event) =>
                        setRulesetForm((current) => ({
                          ...current,
                          name: event.target.value
                        }))
                      }
                      placeholder="例如：自定义 OpenAI 规则"
                    />
                  </label>
                  <label className="block space-y-2">
                    <span className="text-sm font-medium text-slate-600">Slug</span>
                    <Input
                      value={rulesetForm.slug}
                      onChange={(event) =>
                        setRulesetForm((current) => ({
                          ...current,
                          slug: event.target.value
                        }))
                      }
                      placeholder="my-openai-ruleset"
                    />
                  </label>
                  <label className="block space-y-2 xl:col-span-2">
                    <span className="text-sm font-medium text-slate-600">规则源地址</span>
                    <Input
                      required
                      value={rulesetForm.sourceUrl}
                      onChange={(event) =>
                        setRulesetForm((current) => ({
                          ...current,
                          sourceUrl: event.target.value
                        }))
                      }
                      placeholder="https://example.com/rules.yaml"
                    />
                  </label>
                  <label className="block space-y-2 xl:col-span-2">
                    <span className="text-sm font-medium text-slate-600">描述</span>
                    <Textarea
                      value={rulesetForm.description}
                      onChange={(event) =>
                        setRulesetForm((current) => ({
                          ...current,
                          description: event.target.value
                        }))
                      }
                      placeholder="说明这个规则源适合什么场景。"
                    />
                  </label>
                  <label className="block space-y-2">
                    <span className="text-sm font-medium text-slate-600">行为类型</span>
                    <Select
                      value={rulesetForm.behavior}
                      onValueChange={(value) =>
                        setRulesetForm((current) => ({
                          ...current,
                          behavior: value as typeof current.behavior
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="classical">classical</SelectItem>
                        <SelectItem value="domain">domain</SelectItem>
                        <SelectItem value="ipcidr">ipcidr</SelectItem>
                      </SelectContent>
                    </Select>
                  </label>
                  <label className="block space-y-2">
                    <span className="text-sm font-medium text-slate-600">可见性</span>
                    <Select
                      value={rulesetForm.visibility}
                      onValueChange={(value) =>
                        setRulesetForm((current) => ({
                          ...current,
                          visibility: value as Visibility
                        }))
                      }
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
                </div>

                <Button type="submit" disabled={busyActionId === "create-ruleset"}>
                  <Plus className="size-4" />
                  导入第三方规则源
                </Button>
              </form>

              <div className="mt-6 space-y-6">
                {customRulesets.length > 0 ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h4 className="text-lg font-semibold text-slate-950">我的规则源</h4>
                      <Badge>{customRulesets.length} 个</Badge>
                    </div>
                    {customRulesets.map((ruleset) => (
                      <div
                        key={ruleset.id}
                        className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-4"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium text-slate-950">{ruleset.name}</p>
                          <Badge>{visibilityText[ruleset.visibility]}</Badge>
                          <Badge>{ruleset.metadata.behavior ? String(ruleset.metadata.behavior) : "classical"}</Badge>
                          {ruleset.latestFetchStatus ? (
                            <Badge>{ruleset.latestFetchStatus === "success" ? "已缓存" : "同步失败"}</Badge>
                          ) : null}
                        </div>
                        <p className="mt-2 text-sm text-slate-500">
                          {ruleset.description ?? "暂无说明"}
                        </p>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <Button
                            variant="secondary"
                            disabled={busyActionId === `ruleset-sync-${ruleset.id}`}
                            onClick={() =>
                              void runRulesetAction(
                                `ruleset-sync-${ruleset.id}`,
                                () => workspace.syncRuleset(ruleset.id).then(() => undefined),
                                "规则源已重新同步。"
                              )
                            }
                          >
                            <RefreshCw className="size-4" />
                            立即同步
                          </Button>
                          <Button
                            variant="ghost"
                            disabled={busyActionId === `ruleset-delete-${ruleset.id}`}
                            onClick={() =>
                              void runRulesetAction(
                                `ruleset-delete-${ruleset.id}`,
                                () => workspace.deleteRuleset(ruleset.id),
                                "规则源已删除。"
                              )
                            }
                          >
                            <Trash2 className="size-4" />
                            删除
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}

                {officialRulesets.map((ruleset) => (
                  <div
                    key={ruleset.id}
                    className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-4"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-slate-950">{ruleset.name}</p>
                      {ruleset.isOfficial ? (
                        <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">
                          官方
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-2 text-sm text-slate-500">{ruleset.description ?? "暂无说明"}</p>
                    <div className="mt-4 flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.16em] text-slate-400">
                      <span>{ruleset.slug}</span>
                      <span>{ruleset.sourceType}</span>
                      {ruleset.latestFetchedAt ? <span>{formatRelativeDate(ruleset.latestFetchedAt)}</span> : null}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      <TemplateDialog
        open={dialogOpen}
        form={form}
        isSaving={isSaving}
        isLoadingDetail={isLoadingDetail}
        errorMessage={errorMessage}
        editingId={editingId}
        onOpenChange={(nextOpen) => {
          setDialogOpen(nextOpen);
          if (!nextOpen) {
            setErrorMessage(null);
            setIsLoadingDetail(false);
          }
        }}
        onSubmit={handleSave}
        onChange={setForm}
      />
    </div>
  );
};
