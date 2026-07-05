import { Link } from "@tanstack/react-router";

import { CopyLinkButton, EmptyState, HealthDot } from "../components/shared";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { formatRelative } from "../lib/format";
import { useSubscriptions } from "../lib/hooks";

export const SubscriptionsPage = () => {
  const subscriptions = useSubscriptions();

  return (
    <div className="mx-auto max-w-[1180px] px-5 pb-16 pt-6">
      <div className="mb-5 flex items-start gap-4">
        <div>
          <h1 className="text-lg font-semibold">订阅</h1>
          <p className="text-xs text-muted">
            客户端拉取的成品配置。每个订阅有独立链接、版本历史与发布策略。
          </p>
        </div>
        <div className="ml-auto">
          <Link to="/subscriptions/new">
            <Button variant="primary">新建订阅</Button>
          </Link>
        </div>
      </div>

      {subscriptions.data && subscriptions.data.length === 0 ? (
        <EmptyState
          title="还没有订阅"
          description="粘贴一条机场订阅链接，选择起点方案，3 分钟内拿到属于你的稳定订阅链接。"
          action={
            <Link to="/subscriptions/new">
              <Button variant="primary">开始创建</Button>
            </Link>
          }
        />
      ) : (
        <Card className="p-0">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="text-left text-[11.5px] text-faint">
                <th className="border-b border-line px-3 py-2 font-medium">名称</th>
                <th className="border-b border-line px-3 py-2 font-medium">当前版本</th>
                <th className="border-b border-line px-3 py-2 font-medium">来源</th>
                <th className="border-b border-line px-3 py-2 font-medium">发布策略</th>
                <th className="border-b border-line px-3 py-2 font-medium">最近拉取</th>
                <th className="border-b border-line px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {(subscriptions.data ?? []).map((sub) => (
                <tr key={sub.id} className="hover:bg-surface2/45">
                  <td className="border-b border-line px-3 py-2">
                    <div className="flex items-center gap-2">
                      <HealthDot health={sub.health} />
                      <Link
                        to="/subscriptions/$subscriptionId"
                        params={{ subscriptionId: sub.id }}
                        className="font-semibold hover:text-accent"
                      >
                        {sub.displayName}
                      </Link>
                      {sub.hasDraft ? <Badge variant="warn">草稿</Badge> : null}
                      {sub.pendingUpstreamChange ? (
                        <Badge variant="accent">上游有变化待确认</Badge>
                      ) : null}
                    </div>
                    {sub.issueCount.error + sub.issueCount.warn > 0 ? (
                      <p className="ml-4 mt-0.5 text-[11px] text-warn">
                        {sub.issueCount.error + sub.issueCount.warn} 个待处理问题
                      </p>
                    ) : null}
                  </td>
                  <td className="border-b border-line px-3 py-2">
                    {sub.activeReleaseSeq !== null ? (
                      <span className="inline-flex items-center gap-2">
                        <Badge variant="mono">v{sub.activeReleaseSeq}</Badge>
                        <span className="text-faint">{formatRelative(sub.activeReleaseAt)}</span>
                      </span>
                    ) : (
                      <Badge variant="warn">未发布</Badge>
                    )}
                  </td>
                  <td className="border-b border-line px-3 py-2 text-muted">
                    {sub.sourceNames.join(" + ") || "—"}
                  </td>
                  <td className="border-b border-line px-3 py-2">
                    <Badge>{sub.publishPolicy === "auto" ? "自动发布" : "确认后发布"}</Badge>
                  </td>
                  <td className="border-b border-line px-3 py-2 text-muted">
                    {formatRelative(sub.lastPullAt)}
                  </td>
                  <td className="border-b border-line px-3 py-2 text-right">
                    <span className="inline-flex gap-1.5">
                      <CopyLinkButton subscriptionId={sub.id} size="sm" variant="ghost" label="复制链接" />
                      <Link to="/subscriptions/$subscriptionId" params={{ subscriptionId: sub.id }}>
                        <Button size="sm" variant="ghost">
                          编辑
                        </Button>
                      </Link>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <p className="mt-3.5 text-xs text-faint">
        提示：订阅链接永远返回你已发布的版本。上游或规则源的变化只有在生成新版本后才会到达客户端。
      </p>
    </div>
  );
};
