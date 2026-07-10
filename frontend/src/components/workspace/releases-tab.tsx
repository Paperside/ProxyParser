import { useState } from "react";
import { toast } from "sonner";

import { formatRelative, triggerLabel } from "../../lib/format";
import { useRelease, useReleases, useSubscriptionMutations } from "../../lib/hooks";
import { DiffChips, SectionTitle } from "../shared";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Dialog, DialogContent } from "../ui/dialog";
import { Textarea } from "../ui/textarea";
import { useWorkspace } from "./context";

const YamlDialog = ({
  subscriptionId,
  releaseId,
  onClose
}: {
  subscriptionId: string;
  releaseId: string;
  onClose: () => void;
}) => {
  const release = useRelease(subscriptionId, releaseId);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent wide title={release.data ? `v${release.data.seq} 的渲染产物` : "载入中…"}>
        <Textarea readOnly value={release.data?.renderedYaml ?? ""} className="min-h-[50vh]" />
      </DialogContent>
    </Dialog>
  );
};

export const ReleasesTab = () => {
  const {
    detail,
    saving,
    syncingRulesets,
    discardingDraft,
    draftRevision
  } = useWorkspace();
  const releases = useReleases(detail.id);
  const mutations = useSubscriptionMutations(detail.id);
  const [viewingYaml, setViewingYaml] = useState<string | null>(null);
  const rollbackBlocked =
    detail.hasDraft || saving || syncingRulesets || discardingDraft;

  return (
    <div className="max-w-3xl">
      <SectionTitle
        title="版本"
        desc="每次发布生成一个不可变版本，客户端只会拉到这里的内容。回滚即把历史版本重新发布。"
      />

      <Card className="mb-4">
        <p className="mb-2 text-xs font-medium text-muted">发布策略</p>
        <div className="flex flex-col gap-2 text-[12.5px]">
          {(
            [
              ["auto", "自动发布", "上游节点变化时自动生成并发布新版本；校验不通过则保留当前版本并提醒你。推荐——机场轮换凭据时不掉线。"],
              ["confirm", "确认后发布", "任何变化都先生成待发布草稿，看过差异后由你手动发布。"]
            ] as const
          ).map(([value, label, desc]) => (
            <label key={value} className="flex cursor-pointer items-start gap-2.5">
              <input
                type="radio"
                name="publish-policy"
                className="mt-1"
                checked={detail.publishPolicy === value}
                onChange={() =>
                  mutations.updateMeta
                    .mutateAsync({ publishPolicy: value })
                    .then(() => toast.success("发布策略已更新"))
                    .catch((error: unknown) =>
                      toast.error(error instanceof Error ? error.message : "更新失败")
                    )
                }
              />
              <span>
                <strong>{label}</strong>
                <span className="block text-xs text-muted">{desc}</span>
              </span>
            </label>
          ))}
        </div>
      </Card>

      {rollbackBlocked ? (
        <p className="mb-3 rounded-md bg-warn-bg px-3 py-2 text-xs text-warn">
          当前不能回滚：请等待保存、同步或放弃操作完成，并先发布或放弃未发布草稿。
        </p>
      ) : null}

      <div className="flex flex-col">
        {(releases.data ?? []).map((release) => (
          <div key={release.id} className="flex gap-3.5 border-b border-line py-3.5 last:border-b-0">
            <span
              className={`mt-1 size-2.5 flex-none rounded-full border-2 ${
                release.isActive ? "border-ok bg-ok" : "border-line-strong bg-bg"
              }`}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <strong className="font-mono text-[13px]">v{release.seq}</strong>
                {release.isActive ? <Badge variant="ok">当前服务中</Badge> : null}
                <Badge>
                  {triggerLabel[release.trigger] ?? release.trigger}
                  {release.triggerDetail ? ` · ${release.triggerDetail}` : ""}
                </Badge>
                <span className="text-[11px] text-faint">
                  {formatRelative(release.createdAt)}
                  {release.createdBy === "system" ? " · 系统" : ""}
                </span>
                <span className="ml-auto flex gap-1.5">
                  <Button size="sm" variant="ghost" onClick={() => setViewingYaml(release.id)}>
                    查看 YAML
                  </Button>
                  {!release.isActive ? (
                    <Button
                      size="sm"
                      disabled={rollbackBlocked || mutations.rollback.isPending}
                      title={
                        rollbackBlocked
                          ? "请先发布或放弃当前草稿，再回滚历史版本。"
                          : undefined
                      }
                      onClick={() => {
                        if (rollbackBlocked) {
                          toast.error("请先发布或放弃当前草稿，再回滚历史版本。");
                          return;
                        }
                        if (confirm(`回滚到 v${release.seq}？将生成一个内容与 v${release.seq} 一致的新版本。`)) {
                          mutations.rollback
                            .mutateAsync({
                              subscriptionId: detail.id,
                              releaseId: release.id,
                              expectedDraftRevision: draftRevision
                            })
                            .then((next) => toast.success(`已回滚：v${next.seq} 现在与 v${release.seq} 一致`))
                            .catch((error: unknown) =>
                              toast.error(error instanceof Error ? error.message : "回滚失败")
                            );
                        }
                      }}
                    >
                      {mutations.rollback.isPending ? "回滚中…" : "回滚到此版本"}
                    </Button>
                  ) : null}
                </span>
              </div>
              <div className="mt-1.5">
                <DiffChips diff={release.diffSummary} />
              </div>
              {release.validation.mihomo ? (
                <p className="mt-1 text-[11px] text-faint">
                  校验：结构 ✓ · mihomo 内核{" "}
                  {release.validation.mihomo.available
                    ? release.validation.mihomo.passed
                      ? `✓（${release.validation.mihomo.durationMs}ms）`
                      : "✗"
                    : "未启用"}
                </p>
              ) : null}
            </div>
          </div>
        ))}
        {releases.data && releases.data.length === 0 ? (
          <p className="py-6 text-center text-xs text-faint">还没有发布过版本。点右上角「预览并发布」。</p>
        ) : null}
      </div>

      {viewingYaml ? (
        <YamlDialog subscriptionId={detail.id} releaseId={viewingYaml} onClose={() => setViewingYaml(null)} />
      ) : null}
    </div>
  );
};
