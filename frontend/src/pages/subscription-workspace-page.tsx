import { Link, useBlocker, useNavigate, useParams } from "@tanstack/react-router";
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
import {
  usePreparePublishCandidate,
  useSubscription,
  useSubscriptionMutations,
  useValidatePublishCandidate,
  useWorkspaceIndex
} from "../lib/hooks";

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
  expectedDraftRevision,
  onClose
}: {
  subscriptionId: string;
  expectedDraftRevision: number;
  onClose: () => void;
}) => {
  const prepareCandidate = usePreparePublishCandidate(subscriptionId);
  const candidateForValidation =
    prepareCandidate.data?.phase === "rendered"
      ? prepareCandidate.data.candidateId
      : null;
  const validateCandidate = useValidatePublishCandidate(
    subscriptionId,
    candidateForValidation
  );
  const mutations = useSubscriptionMutations(subscriptionId);
  const [publishError, setPublishError] = useState<string | null>(null);

  const prepared = validateCandidate.data ?? prepareCandidate.data ?? null;
  const currentCandidate =
    prepared?.draftRevision === expectedDraftRevision ? prepared : null;
  const errors = currentCandidate?.issues.filter((issue) => issue.severity === "error") ?? [];
  const preparationError = prepareCandidate.error instanceof Error
    ? prepareCandidate.error.message
    : null;
  const validationError = validateCandidate.error instanceof Error
    ? validateCandidate.error.message
    : null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        wide
        title="预览并发布"
        description="确认这次要发布的变化。客户端在发布后拉取到的就是这份内容。"
      >
        {prepareCandidate.isPending && !currentCandidate ? (
          <p className="text-xs text-muted">正在生成不可变候选版本…</p>
        ) : preparationError ? (
          <p className="text-xs text-err">候选版本生成失败：{preparationError}</p>
        ) : currentCandidate ? (
          <div className="flex flex-col gap-4">
            <div>
              <p className="mb-1.5 text-xs font-medium text-muted">
                与当前版本
                {currentCandidate.activeReleaseSeq !== null
                  ? ` v${currentCandidate.activeReleaseSeq} `
                  : ""}
                的差异
              </p>
              <DiffChips diff={currentCandidate.diffVsActive} />
            </div>
            <div className="flex gap-4 font-mono text-xs text-muted">
              <span>{currentCandidate.stats.nodeCount} 节点</span>
              <span>{currentCandidate.stats.groupCount} 组</span>
              <span>{currentCandidate.stats.ruleCount} 规则</span>
              <span>{currentCandidate.stats.providerCount} 规则集</span>
            </div>
            {currentCandidate.issues.length > 0 ? (
              <div>
                <p className="mb-1 text-xs font-medium text-muted">
                  {errors.length > 0
                    ? `存在 ${errors.length} 个必须处理的问题，发布将被阻断：`
                    : "提示（不阻断发布）："}
                </p>
                <IssueList issues={currentCandidate.issues} />
              </div>
            ) : null}
            <div className="rounded-md border border-line bg-bg px-3 py-2 text-xs">
              {currentCandidate.phase === "structural_failed" ? (
                <p className="text-err">结构校验未通过，未运行 Mihomo。</p>
              ) : validateCandidate.isPending || currentCandidate.phase === "validating" ? (
                <p className="text-muted">渲染完成，Mihomo 内核正在校验这份候选文件…</p>
              ) : validationError ? (
                <p className="text-err">Mihomo 校验请求失败：{validationError}</p>
              ) : currentCandidate.phase === "validated" && currentCandidate.mihomo?.passed ? (
                <p className="text-ok">
                  Mihomo 内核校验通过
                  {currentCandidate.mihomo.durationMs !== null
                    ? `（${currentCandidate.mihomo.durationMs}ms）`
                    : ""}
                </p>
              ) : currentCandidate.phase === "validation_failed" ? (
                <div className="flex flex-col gap-2 text-err">
                  <p>Mihomo 内核校验失败，不能发布。</p>
                  {currentCandidate.mihomo?.output ? (
                    <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[11px]">
                      {currentCandidate.mihomo.output}
                    </pre>
                  ) : null}
                </div>
              ) : (
                <p className="text-muted">等待 Mihomo 内核校验…</p>
              )}
            </div>
            {publishError ? (
              <pre className="overflow-x-auto rounded-md bg-err-bg px-3 py-2 font-mono text-[11px] text-err">
                {publishError}
              </pre>
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-muted">草稿版本已变化，正在等待最新预览…</p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            disabled={
              prepareCandidate.isPending ||
              validateCandidate.isPending ||
              !currentCandidate ||
              currentCandidate.phase !== "validated" ||
              currentCandidate.mihomo?.passed !== true ||
              errors.length > 0 ||
              mutations.publish.isPending
            }
            onClick={() =>
              mutations.publish
                .mutateAsync({
                  subscriptionId,
                  candidateId: currentCandidate!.candidateId,
                  expectedDraftRevision: currentCandidate!.draftRevision,
                  expectedRenderedHash: currentCandidate!.renderedHash
                })
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

interface PendingDraftSave {
  buildConfig: BuildConfig;
  editRevision: number;
}

interface DraftSaveFailure {
  kind: "retryable" | "conflict" | "discard";
  message: string;
}

const cloneBuildConfig = (config: BuildConfig) =>
  JSON.parse(JSON.stringify(config)) as BuildConfig;

const buildConfigsEqual = (left: BuildConfig | null, right: BuildConfig) =>
  left !== null && JSON.stringify(left) === JSON.stringify(right);

const SubscriptionWorkspace = ({
  subscriptionId,
  tab
}: {
  subscriptionId: string;
  tab: TabId;
}) => {
  const navigate = useNavigate();

  const detail = useSubscription(subscriptionId);
  const mutations = useSubscriptionMutations(subscriptionId);

  // 本地编辑副本 + 防抖保存
  const [config, setConfig] = useState<BuildConfig | null>(null);
  const [dirty, setDirty] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [saveFailure, setSaveFailure] = useState<DraftSaveFailure | null>(null);
  const [syncingRulesets, setSyncingRulesets] = useState(false);
  const [discardingDraft, setDiscardingDraft] = useState(false);
  const configRef = useRef<BuildConfig | null>(null);
  const editRevision = useRef(0);
  const savedRevision = useRef(0);
  const draftRevision = useRef<number | null>(null);
  const dirtyRef = useRef(false);
  const pendingSaveCount = useRef(0);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDebouncedSave = useRef<PendingDraftSave | null>(null);
  const syncingRulesetsRef = useRef(false);
  const discardingDraftRef = useRef(false);
  const saveConflictRef = useRef(false);
  const mountedSubscriptionId = useRef<string | null>(subscriptionId);
  const loadedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!detail.data) return;
    if (
      draftRevision.current !== null &&
      detail.data.draftRevision < draftRevision.current
    ) {
      return;
    }
    const serverConfig = detail.data.draftBuildConfig ?? detail.data.buildConfig;
    // 元信息更新等操作会让详情查询 refetch。服务端 revision 与配置都未变化时保留
    // 当前对象身份，避免右侧按需生成的预览被误判为失效。
    if (
      loadedFor.current === subscriptionId &&
      !dirtyRef.current &&
      draftRevision.current === detail.data.draftRevision &&
      serverConfig !== null &&
      buildConfigsEqual(configRef.current, serverConfig)
    ) {
      return;
    }
    // 首次载入，或服务端配置变化且本地无未保存修改时同步
    if (loadedFor.current !== subscriptionId || (!dirtyRef.current && serverConfig)) {
      const nextConfig = serverConfig ? cloneBuildConfig(serverConfig) : null;
      configRef.current = nextConfig;
      setConfig(nextConfig);
      savedRevision.current = editRevision.current;
      draftRevision.current = detail.data.draftRevision;
      dirtyRef.current = false;
      setDirty(false);
      saveConflictRef.current = false;
      setSaveFailure(null);
      loadedFor.current = subscriptionId;
    }
  }, [detail.data, subscriptionId]);

  const enqueueDraftSave = (pending: PendingDraftSave) => {
    pendingSaveCount.current += 1;
    if (mountedSubscriptionId.current === subscriptionId) {
      setSavingDraft(true);
    }

    const save = async () => {
      let expectedDraftRevision: number | null = null;
      try {
        if (saveConflictRef.current || discardingDraftRef.current) return;
        expectedDraftRevision = draftRevision.current;
        if (expectedDraftRevision === null) {
          throw new Error("草稿版本尚未载入，请刷新页面后重试。");
        }
        const saved = await mutations.saveDraft.mutateAsync({
          subscriptionId,
          buildConfig: pending.buildConfig,
          expectedDraftRevision
        });
        draftRevision.current = saved.draftRevision;
        if (mountedSubscriptionId.current === subscriptionId) {
          savedRevision.current = Math.max(
            savedRevision.current,
            pending.editRevision
          );
          const stillDirty = savedRevision.current < editRevision.current;
          dirtyRef.current = stillDirty;
          setDirty(stillDirty);
          saveConflictRef.current = false;
          setSaveFailure(null);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "草稿保存失败";
        let refreshed: Awaited<ReturnType<typeof detail.refetch>> | null = null;
        try {
          refreshed = await detail.refetch();
        } catch {
          // refetch 的失败会沿用原始保存错误，保留可重试路径。
        }

        if (refreshed?.isSuccess && refreshed.data) {
          const serverConfig =
            refreshed.data.draftBuildConfig ?? refreshed.data.buildConfig;

          // 请求可能已经写入，只是在响应返回前断线。服务端已是目标配置时，
          // 认领它的 revision，让队列里的下一次编辑可以继续安全保存。
          if (buildConfigsEqual(serverConfig, pending.buildConfig)) {
            draftRevision.current = refreshed.data.draftRevision;
            savedRevision.current = Math.max(
              savedRevision.current,
              pending.editRevision
            );
            if (mountedSubscriptionId.current === subscriptionId) {
              const stillDirty = savedRevision.current < editRevision.current;
              dirtyRef.current = stillDirty;
              setDirty(stillDirty);
              saveConflictRef.current = false;
              setSaveFailure(null);
            }
            return;
          }

          if (
            expectedDraftRevision !== null &&
            refreshed.data.draftRevision > expectedDraftRevision
          ) {
            saveConflictRef.current = true;
            if (mountedSubscriptionId.current === subscriptionId) {
              const conflictMessage =
                "服务端草稿已被其他操作更新。请重新载入最新草稿后再编辑。";
              setSaveFailure({ kind: "conflict", message: conflictMessage });
              toast.error(conflictMessage);
            }
            return;
          }
        }

        saveConflictRef.current = false;
        if (mountedSubscriptionId.current === subscriptionId) {
          setSaveFailure({ kind: "retryable", message });
          toast.error(message);
        }
      } finally {
        pendingSaveCount.current -= 1;
        if (
          pendingSaveCount.current === 0 &&
          mountedSubscriptionId.current === subscriptionId
        ) {
          setSavingDraft(false);
        }
      }
    };

    // 无论上一轮成功或失败，下一轮都只在它落定后开始，避免较旧的 PUT 后到并覆盖新草稿。
    saveQueue.current = saveQueue.current.then(save, save);
  };

  const flushDebouncedSave = () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const pending = pendingDebouncedSave.current;
    pendingDebouncedSave.current = null;
    if (pending) {
      enqueueDraftSave(pending);
    }
  };

  useEffect(() => {
    mountedSubscriptionId.current = subscriptionId;
    return () => {
      mountedSubscriptionId.current = null;
      // 路由切走时不丢掉最后 600ms 内的编辑；保存继续执行，但不再更新旧 UI。
      flushDebouncedSave();
    };
  }, []);

  const hasPendingLocalDraft = () =>
    dirtyRef.current || saveTimer.current !== null || pendingSaveCount.current > 0;

  useBlocker({
    shouldBlockFn: ({ next }) => {
      if (!hasPendingLocalDraft()) return false;
      const workspaceBase = `/subscriptions/${subscriptionId}`;
      if (
        next.pathname === workspaceBase ||
        next.pathname.startsWith(`${workspaceBase}/`)
      ) {
        return false;
      }
      return !confirm("草稿仍有本地修改或保存尚未完成，确定要离开吗？");
    },
    enableBeforeUnload: hasPendingLocalDraft
  });

  const update = (mutator: (draft: BuildConfig) => void) => {
    if (
      syncingRulesetsRef.current ||
      discardingDraftRef.current ||
      saveConflictRef.current
    ) {
      return false;
    }
    const current = configRef.current;
    if (!current) return false;

    const next = cloneBuildConfig(current);
    mutator(next);
    const revision = editRevision.current + 1;
    editRevision.current = revision;
    dirtyRef.current = true;
    configRef.current = next;
    setConfig(next);
    setDirty(true);
    setSaveFailure(null);

    if (saveTimer.current) clearTimeout(saveTimer.current);
    pendingDebouncedSave.current = { buildConfig: next, editRevision: revision };
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      const pending = pendingDebouncedSave.current;
      pendingDebouncedSave.current = null;
      if (pending) enqueueDraftSave(pending);
    }, 600);
    return true;
  };

  const retryDraftSave = () => {
    if (
      pendingSaveCount.current > 0 ||
      saveTimer.current !== null ||
      syncingRulesetsRef.current ||
      discardingDraftRef.current ||
      saveConflictRef.current
    ) {
      return;
    }
    const current = configRef.current;
    if (!current) return;
    setSaveFailure(null);
    enqueueDraftSave({
      buildConfig: cloneBuildConfig(current),
      editRevision: editRevision.current
    });
  };

  const reloadServerDraft = async () => {
    if (
      pendingSaveCount.current > 0 ||
      saveTimer.current !== null ||
      syncingRulesetsRef.current ||
      discardingDraftRef.current
    ) {
      return;
    }
    if (!confirm("重新载入会放弃当前浏览器中尚未保存的修改，继续吗？")) {
      return;
    }
    try {
      const refreshed = await detail.refetch();
      if (!refreshed.isSuccess || !refreshed.data) {
        throw new Error("重新载入服务端草稿失败，请检查网络后重试。");
      }
      const serverConfig = refreshed.data.draftBuildConfig ?? refreshed.data.buildConfig;
      const nextConfig = serverConfig ? cloneBuildConfig(serverConfig) : null;
      configRef.current = nextConfig;
      setConfig(nextConfig);
      draftRevision.current = refreshed.data.draftRevision;
      savedRevision.current = editRevision.current;
      dirtyRef.current = false;
      setDirty(false);
      saveConflictRef.current = false;
      setSaveFailure(null);
      loadedFor.current = subscriptionId;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "重新载入草稿失败");
    }
  };

  const syncLatestRulesets = async () => {
    if (
      dirtyRef.current ||
      pendingSaveCount.current > 0 ||
      saveTimer.current !== null ||
      discardingDraftRef.current ||
      saveConflictRef.current
    ) {
      throw new Error("请先等待当前草稿保存完成。");
    }
    if (syncingRulesetsRef.current) {
      throw new Error("规则快照正在同步，请稍候。");
    }
    syncingRulesetsRef.current = true;
    setSyncingRulesets(true);
    const targetSubscriptionId = subscriptionId;
    try {
      const expectedDraftRevision = draftRevision.current;
      if (expectedDraftRevision === null) {
        throw new Error("草稿版本尚未载入，请刷新页面后重试。");
      }
      const result = await mutations.syncLatestRulesets.mutateAsync(expectedDraftRevision);
      if (mountedSubscriptionId.current !== targetSubscriptionId) {
        return result;
      }
      const nextConfig = cloneBuildConfig(result.buildConfig);
      configRef.current = nextConfig;
      setConfig(nextConfig);
      draftRevision.current = result.draftRevision;
      savedRevision.current = editRevision.current;
      dirtyRef.current = false;
      setDirty(false);
      saveConflictRef.current = false;
      setSaveFailure(null);
      loadedFor.current = subscriptionId;
      return result;
    } finally {
      syncingRulesetsRef.current = false;
      if (mountedSubscriptionId.current === targetSubscriptionId) {
        setSyncingRulesets(false);
      }
    }
  };

  const discardDraft = async () => {
    if (
      pendingSaveCount.current > 0 ||
      syncingRulesetsRef.current ||
      discardingDraftRef.current ||
      mutations.discardDraft.isPending
    ) {
      return;
    }
    discardingDraftRef.current = true;
    setDiscardingDraft(true);
    setSaveFailure(null);
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    pendingDebouncedSave.current = null;

    try {
      const expectedDraftRevision = draftRevision.current;
      if (expectedDraftRevision === null) {
        throw new Error("草稿版本尚未载入，请刷新页面后重试。");
      }
      const discarded = await mutations.discardDraft.mutateAsync({
        subscriptionId,
        expectedDraftRevision
      });
      if (mountedSubscriptionId.current !== subscriptionId) return;
      const serverConfig = discarded.draftBuildConfig ?? discarded.buildConfig;
      const nextConfig = serverConfig ? cloneBuildConfig(serverConfig) : null;
      configRef.current = nextConfig;
      setConfig(nextConfig);
      draftRevision.current = discarded.draftRevision;
      savedRevision.current = editRevision.current;
      dirtyRef.current = false;
      setDirty(false);
      saveConflictRef.current = false;
      setSaveFailure(null);
      loadedFor.current = subscriptionId;
    } catch (error) {
      if (mountedSubscriptionId.current === subscriptionId) {
        const message = error instanceof Error ? error.message : "放弃草稿失败";
        setSaveFailure({ kind: "discard", message });
        toast.error(message);
      }
    } finally {
      discardingDraftRef.current = false;
      if (mountedSubscriptionId.current === subscriptionId) {
        setDiscardingDraft(false);
      }
    }
  };

  const workspaceIndex = useWorkspaceIndex(subscriptionId, config !== null && !dirty);
  const [showPublish, setShowPublish] = useState(false);

  const knownGroupNames = useMemo(() => (config ? deriveGroupNames(config) : []), [config]);

  if (detail.isLoading || !detail.data) {
    return <div className="p-8 text-sm text-muted">载入中…</div>;
  }
  if (!config) {
    return <div className="p-8 text-sm text-muted">该订阅尚无构建配置。</div>;
  }

  const saveConflict = saveFailure?.kind === "conflict";
  const workspaceLocked = syncingRulesets || discardingDraft || saveConflict;
  const currentDraftRevision = draftRevision.current ?? detail.data.draftRevision;
  const currentWorkspaceIndex =
    !dirty &&
    !savingDraft &&
    workspaceIndex.data?.draftRevision === currentDraftRevision
      ? workspaceIndex.data
      : null;

  const value: WorkspaceContextValue = {
    detail: detail.data,
    config,
    update,
    editingLocked: workspaceLocked,
    saving: dirty || savingDraft,
    syncingRulesets,
    discardingDraft,
    draftRevision: currentDraftRevision,
    syncLatestRulesets,
    workspaceIndex: currentWorkspaceIndex,
    workspaceIndexLoading: workspaceIndex.isFetching || dirty || savingDraft,
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
        {discardingDraft ? (
          <span className="text-[11px] text-faint">放弃草稿…</span>
        ) : syncingRulesets ? (
          <span className="text-[11px] text-faint">同步规则快照…</span>
        ) : saveFailure ? (
          <span className="text-[11px] text-err">
            {saveConflict
              ? "草稿冲突"
              : saveFailure.kind === "discard"
                ? "放弃失败"
                : "保存失败"}
          </span>
        ) : value.saving ? (
          <span className="text-[11px] text-faint">保存中…</span>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          {(detail.data.hasDraft || dirty) && detail.data.buildConfig ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={
                savingDraft ||
                syncingRulesets ||
                discardingDraft ||
                saveConflict ||
                mutations.discardDraft.isPending
              }
              onClick={() => {
                if (confirm("放弃全部未发布修改，回到已发布配置？")) {
                  void discardDraft();
                }
              }}
            >
              {discardingDraft ? "放弃中…" : "放弃修改"}
            </Button>
          ) : null}
          <Button
            variant="primary"
            disabled={value.saving || syncingRulesets || discardingDraft || saveConflict}
            onClick={() => setShowPublish(true)}
          >
            预览并发布
          </Button>
        </div>
      </div>

      {saveFailure ? (
        <div className="flex items-center gap-3 border-b border-err/30 bg-err-bg px-6 py-2 text-xs text-err">
          <span className="min-w-0 flex-1 truncate">
            {saveConflict
              ? saveFailure.message
              : saveFailure.kind === "discard"
                ? `放弃草稿失败：${saveFailure.message}`
                : `草稿保存失败：${saveFailure.message}`}
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={savingDraft || syncingRulesets || discardingDraft}
            onClick={() => void reloadServerDraft()}
          >
            重新载入
          </Button>
          {saveFailure.kind === "retryable" ? (
            <Button
              size="sm"
              variant="danger"
              disabled={savingDraft || syncingRulesets || discardingDraft}
              onClick={retryDraftSave}
            >
              重试保存
            </Button>
          ) : null}
          {saveFailure.kind === "discard" ? (
            <Button
              size="sm"
              variant="danger"
              disabled={savingDraft || syncingRulesets || discardingDraft}
              onClick={() => void discardDraft()}
            >
              重试放弃
            </Button>
          ) : null}
        </div>
      ) : null}

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
          aria-busy={syncingRulesets || discardingDraft}
          inert={workspaceLocked ? true : undefined}
          className={cn(
            "min-w-0 px-6 py-5 transition-opacity",
            workspaceLocked && "opacity-60"
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
        <PublishDialog
          subscriptionId={subscriptionId}
          expectedDraftRevision={value.draftRevision}
          onClose={() => setShowPublish(false)}
        />
      ) : null}
    </WorkspaceContext.Provider>
  );
};

export const SubscriptionWorkspacePage = () => {
  const params = useParams({ strict: false }) as { subscriptionId: string; tab?: string };
  const subscriptionId = params.subscriptionId;
  const tab: TabId = (
    TABS.some((item) => item.id === params.tab) ? params.tab : "overview"
  ) as TabId;

  return (
    <SubscriptionWorkspace
      key={subscriptionId}
      subscriptionId={subscriptionId}
      tab={tab}
    />
  );
};
