import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { DiffChips, HealthDot, IssueList } from "../components/shared";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "../components/ui/dialog";
import {
  WorkspaceContext,
  deriveGroupNames,
  type WorkspaceContextValue
} from "../components/workspace/context";
import { OverviewTab } from "../components/workspace/overview-tab";
import { NodesTab } from "../components/workspace/nodes-tab";
import { GroupsTab } from "../components/workspace/groups-tab";
import { RulesTab } from "../components/workspace/rules-tab";
import { ConfigTab } from "../components/workspace/config-tab";
import { ReleasesTab } from "../components/workspace/releases-tab";
import { AccessTab } from "../components/workspace/access-tab";
import { WorkspaceRail } from "../components/workspace/rail";
import { cn } from "../lib/cn";
import type { BuildConfig } from "../lib/build-config-types";
import { usePreview, useSubscription, useSubscriptionMutations } from "../lib/hooks";

const TABS = [
  { id: "overview", label: "概览" },
  { id: "nodes", label: "节点" },
  { id: "groups", label: "代理组" },
  { id: "rules", label: "规则" },
  { id: "config", label: "配置" },
  { id: "releases", label: "版本" },
  { id: "access", label: "访问" },
  { id: "issues", label: "问题" }
] as const;

type TabId = (typeof TABS)[number]["id"];

const PublishDialog = ({
  subscriptionId,
  onClose
}: {
  subscriptionId: string;
  onClose: () => void;
}) => {
  const preview = usePreview(subscriptionId, true);
  const mutations = useSubscriptionMutations(subscriptionId);
  const [publishError, setPublishError] = useState<string | null>(null);

  const errors = preview.data?.issues.filter((issue) => issue.severity === "error") ?? [];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        wide
        title="预览并发布"
        description="确认这次要发布的变化。客户端在发布后拉取到的就是这份内容。"
      >
        {preview.isLoading ? (
          <p className="text-xs text-muted">正在渲染与校验…</p>
        ) : preview.data ? (
          <div className="flex flex-col gap-4">
            <div>
              <p className="mb-1.5 text-xs font-medium text-muted">
                与当前版本
                {preview.data.activeReleaseSeq !== null
                  ? ` v${preview.data.activeReleaseSeq} `
                  : ""}
                的差异
              </p>
              <DiffChips diff={preview.data.diffVsActive} />
            </div>
            <div className="flex gap-4 font-mono text-xs text-muted">
              <span>{preview.data.stats.nodeCount} 节点</span>
              <span>{preview.data.stats.groupCount} 组</span>
              <span>{preview.data.stats.ruleCount} 规则</span>
              <span>{preview.data.stats.providerCount} 规则集</span>
            </div>
            {preview.data.issues.length > 0 ? (
              <div>
                <p className="mb-1 text-xs font-medium text-muted">
                  {errors.length > 0
                    ? `存在 ${errors.length} 个必须处理的问题，发布将被阻断：`
                    : "提示（不阻断发布）："}
                </p>
                <IssueList issues={preview.data.issues} />
              </div>
            ) : null}
            {publishError ? (
              <pre className="overflow-x-auto rounded-md bg-err-bg px-3 py-2 font-mono text-[11px] text-err">
                {publishError}
              </pre>
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-err">预览失败：{preview.error?.message}</p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            disabled={preview.isLoading || errors.length > 0 || mutations.publish.isPending}
            onClick={() =>
              mutations.publish
                .mutateAsync()
                .then((release) => {
                  toast.success(`v${release.seq} 已发布`);
                  onClose();
                })
                .catch((error: unknown) =>
                  setPublishError(error instanceof Error ? error.message : "发布失败")
                )
            }
          >
            {mutations.publish.isPending ? "发布中…" : "确认发布"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export const SubscriptionWorkspacePage = () => {
  const params = useParams({ strict: false }) as { subscriptionId: string; tab?: string };
  const subscriptionId = params.subscriptionId;
  const tab: TabId = (TABS.some((t) => t.id === params.tab) ? params.tab : "overview") as TabId;
  const navigate = useNavigate();

  const detail = useSubscription(subscriptionId);
  const mutations = useSubscriptionMutations(subscriptionId);

  // 本地编辑副本 + 防抖保存
  const [config, setConfig] = useState<BuildConfig | null>(null);
  const [dirty, setDirty] = useState(false);
  const [syncingRulesets, setSyncingRulesets] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!detail.data) return;
    const serverConfig = detail.data.draftBuildConfig ?? detail.data.buildConfig;
    // 首次载入，或服务端配置变化且本地无未保存修改时同步
    if (loadedFor.current !== subscriptionId || (!dirty && serverConfig)) {
      setConfig(serverConfig ? (JSON.parse(JSON.stringify(serverConfig)) as BuildConfig) : null);
      loadedFor.current = subscriptionId;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.data, subscriptionId]);

  const update = (mutator: (draft: BuildConfig) => void) => {
    if (syncingRulesets) return;
    setConfig((current) => {
      if (!current) return current;
      const next = JSON.parse(JSON.stringify(current)) as BuildConfig;
      mutator(next);
      setDirty(true);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        mutations.saveDraft
          .mutateAsync(next)
          .then(() => setDirty(false))
          .catch((error: unknown) =>
            toast.error(error instanceof Error ? error.message : "草稿保存失败")
          );
      }, 600);
      return next;
    });
  };

  const syncLatestRulesets = async () => {
    if (dirty || mutations.saveDraft.isPending) {
      throw new Error("请先等待当前草稿保存完成。");
    }
    setSyncingRulesets(true);
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    try {
      const result = await mutations.syncLatestRulesets.mutateAsync();
      setDirty(false);
      const refreshed = await detail.refetch();
      const serverConfig = refreshed.data?.draftBuildConfig ?? refreshed.data?.buildConfig;
      if (!serverConfig) {
        throw new Error("规则快照已同步，但重新载入草稿失败，请刷新页面。");
      }
      setConfig(JSON.parse(JSON.stringify(serverConfig)) as BuildConfig);
      loadedFor.current = subscriptionId;
      return result;
    } finally {
      setSyncingRulesets(false);
    }
  };

  const preview = usePreview(subscriptionId, config !== null && !dirty);
  const [showPublish, setShowPublish] = useState(false);

  const knownGroupNames = useMemo(() => (config ? deriveGroupNames(config) : []), [config]);

  if (detail.isLoading || !detail.data) {
    return <div className="p-8 text-sm text-muted">载入中…</div>;
  }
  if (!config) {
    return <div className="p-8 text-sm text-muted">该订阅尚无构建配置。</div>;
  }

  const value: WorkspaceContextValue = {
    detail: detail.data,
    config,
    update,
    saving: dirty || mutations.saveDraft.isPending,
    syncingRulesets,
    syncLatestRulesets,
    preview: preview.data ?? null,
    previewLoading: preview.isFetching,
    refreshPreview: () => void preview.refetch(),
    knownGroupNames
  };

  const issueCount = detail.data.issueCount.warn + detail.data.issueCount.error;

  return (
    <WorkspaceContext.Provider value={value}>
      <div className="flex items-center gap-3 border-b border-line bg-surface px-6 py-3">
        <Link to="/subscriptions">
          <Button size="sm" variant="ghost">
            <ArrowLeft className="size-3.5" />
          </Button>
        </Link>
        <h1 className="flex items-center gap-2 text-[15px] font-semibold">
          <HealthDot health={detail.data.health} />
          {detail.data.displayName}
        </h1>
        {detail.data.activeReleaseSeq !== null ? (
          <Badge variant="mono">当前 v{detail.data.activeReleaseSeq}</Badge>
        ) : (
          <Badge variant="warn">未发布</Badge>
        )}
        {detail.data.hasDraft || dirty ? <Badge variant="warn">有未发布修改</Badge> : null}
        {syncingRulesets ? (
          <span className="text-[11px] text-faint">同步规则快照…</span>
        ) : value.saving ? (
          <span className="text-[11px] text-faint">保存中…</span>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          {detail.data.hasDraft && detail.data.buildConfig ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={syncingRulesets}
              onClick={() => {
                if (confirm("放弃全部未发布修改，回到已发布配置？")) {
                  void mutations.discardDraft.mutateAsync().then(() => {
                    loadedFor.current = null;
                    setDirty(false);
                  });
                }
              }}
            >
              放弃修改
            </Button>
          ) : null}
          <Button
            variant="primary"
            disabled={syncingRulesets}
            onClick={() => setShowPublish(true)}
          >
            预览并发布
          </Button>
        </div>
      </div>

      <div className="grid min-h-[calc(100vh-105px)] grid-cols-[168px_minmax(0,1fr)] xl:grid-cols-[168px_minmax(0,1fr)_340px]">
        <nav className="border-r border-line px-2 py-4">
          {TABS.map((item) => (
            <button
              key={item.id}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] text-muted hover:bg-surface2 hover:text-ink",
                tab === item.id && "bg-surface2 font-medium text-ink"
              )}
              onClick={() =>
                void navigate({
                  to: "/subscriptions/$subscriptionId/$tab",
                  params: { subscriptionId, tab: item.id }
                })
              }
            >
              {item.label}
              {item.id === "issues" && issueCount > 0 ? (
                <span className="ml-auto rounded-full bg-warn-bg px-1.5 font-mono text-[11px] text-warn">
                  {issueCount}
                </span>
              ) : null}
            </button>
          ))}
        </nav>

        <main
          aria-busy={syncingRulesets}
          className={cn(
            "min-w-0 px-6 py-5 transition-opacity",
            syncingRulesets && "pointer-events-none opacity-60"
          )}
        >
          {tab === "overview" ? <OverviewTab /> : null}
          {tab === "nodes" ? <NodesTab /> : null}
          {tab === "groups" ? <GroupsTab /> : null}
          {tab === "rules" ? <RulesTab /> : null}
          {tab === "config" ? <ConfigTab /> : null}
          {tab === "releases" ? <ReleasesTab /> : null}
          {tab === "access" ? <AccessTab /> : null}
          {tab === "issues" ? (
            <div className="max-w-2xl">
              <h2 className="mb-3 text-[15px] font-semibold">待处理问题</h2>
              <IssueList
                issues={detail.data.issues.map((issue) => ({
                  kind: issue.kind,
                  severity: issue.severity,
                  message: issue.message,
                  refs: issue.refs
                }))}
              />
            </div>
          ) : null}
        </main>

        <aside className="hidden border-l border-line bg-surface p-4 xl:block">
          <WorkspaceRail />
        </aside>
      </div>

      {showPublish ? (
        <PublishDialog subscriptionId={subscriptionId} onClose={() => setShowPublish(false)} />
      ) : null}
    </WorkspaceContext.Provider>
  );
};
