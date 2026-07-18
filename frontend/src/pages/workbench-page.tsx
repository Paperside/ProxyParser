import { Link } from "@tanstack/react-router";
import { ArrowUpToLine, CircleAlert, RefreshCw, Sparkles } from "lucide-react";

import { CopyLinkButton, HealthDot } from "../components/shared";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardTitle } from "../components/ui/card";
import { eventKindLabel, formatRelative, usageSummary } from "../lib/format";
import { useEvents, useSubscriptions } from "../lib/hooks";
import type { EventEntry } from "../lib/types";

const EventIcon = ({ kind }: { kind: string }) => {
  const cls = "size-3.5";
  if (kind === "release.published") return <ArrowUpToLine className={`${cls} text-ok`} />;
  if (kind === "release.blocked" || kind === "source.sync_failed")
    return <CircleAlert className={`${cls} text-warn`} />;
  if (kind === "ruleset.update_available") return <Sparkles className={`${cls} text-accent`} />;
  return <RefreshCw className={`${cls} text-muted`} />;
};

const eventDetail = (event: EventEntry): string => {
  const p = event.payload as Record<string, unknown>;
  switch (event.kind) {
    case "release.published": {
      const diff = p.diff as Record<string, number> | undefined;
      const parts: string[] = [];
      if (diff) {
        if (diff.nodesAdded) parts.push(`+${diff.nodesAdded} 节点`);
        if (diff.nodesRemoved) parts.push(`-${diff.nodesRemoved} 节点`);
        if (diff.nodesRenamed) parts.push(`${diff.nodesRenamed} 个改名`);
        if (diff.nodesUpdated) parts.push(`${diff.nodesUpdated} 个凭据轮换`);
        if (diff.ruleCountDelta) parts.push(`规则 ${diff.ruleCountDelta > 0 ? "+" : ""}${diff.ruleCountDelta}`);
      }
      return `${String(p.displayName ?? "")} 发布 v${String(p.seq ?? "?")}${parts.length ? " · " + parts.join("，") : ""}`;
    }
    case "release.blocked":
      return `${String(p.displayName ?? "")} 发布被阻断：${String(p.reason ?? p.firstError ?? "")}`;
    case "subscription.pending_change":
      return `${String(p.displayName ?? "")} 有待确认的上游变化（来自 ${String(p.sourceName ?? "")}）`;
    case "source.synced":
      return `${String(p.displayName ?? "")}：+${String(p.added ?? 0)} / -${String(p.removed ?? 0)} / 改名 ${String(p.renamed ?? 0)} / 更新 ${String(p.updated ?? 0)}，共 ${String(p.nodeCount ?? "?")} 节点`;
    case "source.sync_failed":
      return `${String(p.displayName ?? "")}：${String(p.error ?? "")}`;
    case "ruleset.update_available":
      return `${String(p.name ?? p.slug ?? "")} 有新内容（${String(p.entryCount ?? "?")} 条），等待你确认更新`;
    default:
      return event.kind;
  }
};

export const WorkbenchPage = () => {
  const subscriptions = useSubscriptions();
  const events = useEvents();

  const warnSubs = (subscriptions.data ?? []).filter((sub) => sub.health !== "ok");

  return (
    <div className="mx-auto max-w-[1180px] px-5 pb-16 pt-6">
      <div className="mb-5 flex items-start gap-4">
        <div>
          <h1 className="text-lg font-semibold">工作台</h1>
          <p className="text-xs text-muted">
            {subscriptions.data
              ? `${subscriptions.data.length} 个订阅 · ${warnSubs.length === 0 ? "全部正常" : `${warnSubs.length} 个需要注意`}`
              : "载入中…"}
          </p>
        </div>
        <div className="ml-auto">
          <Link to="/subscriptions/new">
            <Button variant="primary">新建订阅</Button>
          </Link>
        </div>
      </div>

      {warnSubs.length > 0 ? (
        <div className="mb-5 flex items-center gap-2.5 rounded-[10px] border border-warn/30 bg-warn-bg px-3.5 py-2.5 text-[13px]">
          <span className="health-dot" data-health="warn" />
          <span>
            {warnSubs.length} 个订阅需要处理：
            {warnSubs
              .map((sub) => `${sub.displayName}（${sub.healthReasons[0] ?? "异常"}）`)
              .join("；")}
          </span>
          <Link to="/subscriptions" className="ml-auto shrink-0">
            <Button size="sm">查看</Button>
          </Link>
        </div>
      ) : null}

      <div className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-2">
        {(subscriptions.data ?? []).slice(0, 4).map((sub) => {
          const usage = usageSummary(sub.usage);
          return (
            <Card
              key={sub.id}
              role="group"
              aria-label={`订阅 ${sub.displayName}`}
              className="flex flex-col gap-2"
            >
              <div className="flex items-center gap-2 text-sm font-semibold">
                <HealthDot health={sub.health} />
                {sub.displayName}
                {sub.activeReleaseSeq !== null ? (
                  <Badge variant="mono">v{sub.activeReleaseSeq}</Badge>
                ) : (
                  <Badge variant="warn">未发布</Badge>
                )}
                {sub.hasDraft ? <Badge variant="warn">有未发布修改</Badge> : null}
              </div>
              <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-[11.5px] text-faint">
                <span>来源 {sub.sourceNames.join(" + ") || "—"}</span>
                <span>最近发布 {formatRelative(sub.activeReleaseAt)}</span>
                <span>最近拉取 {formatRelative(sub.lastPullAt)}</span>
                {usage ? <span>流量已用 {usage.percent}%</span> : null}
              </div>
              <div className="mt-1 flex gap-2">
                <Link to="/subscriptions/$subscriptionId" params={{ subscriptionId: sub.id }}>
                  <Button size="sm">打开</Button>
                </Link>
                <CopyLinkButton subscriptionId={sub.id} size="sm" />
              </div>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardTitle>
          最近事件 <span className="text-xs font-normal text-faint">同步、发布与规则源动态</span>
        </CardTitle>
        {events.data && events.data.length > 0 ? (
          <div className="flex flex-col">
            {events.data.map((event) => (
              <div
                key={event.id}
                className="flex gap-3 border-b border-line py-2.5 last:border-b-0"
              >
                <span className="mt-0.5 grid size-6 flex-none place-items-center rounded-md border border-line bg-surface2">
                  <EventIcon kind={event.kind} />
                </span>
                <div className="min-w-0">
                  <p className="text-[12.5px]">
                    <span className="font-medium">{eventKindLabel[event.kind] ?? event.kind}</span>
                    <span className="text-muted"> — {eventDetail(event)}</span>
                  </p>
                  <p className="text-[11px] text-faint">{formatRelative(event.createdAt)}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-faint">暂无事件。添加订阅源并创建订阅后，这里会记录一切变化。</p>
        )}
      </Card>
    </div>
  );
};
