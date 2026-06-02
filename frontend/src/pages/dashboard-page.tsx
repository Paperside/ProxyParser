import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Copy, RefreshCw, Server, Sparkles, Waypoints } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { copyText } from "../lib/clipboard";
import {
  formatTime,
  formatUsage,
  renderStatusText,
  renderStatusTone,
  syncStatusText,
  syncStatusTone
} from "../lib/format";
import { useWorkspace } from "../providers/workspace-provider";

const StatCard = ({
  title,
  value,
  description
}: {
  title: string;
  value: string;
  description: string;
}) => {
  return (
    <Card className="rounded-lg p-5">
      <p className="text-sm text-[#73726c]">{title}</p>
      <p className="mt-3 text-3xl font-semibold text-[#141413]">{value}</p>
      <p className="mt-2 text-sm text-[#73726c]">{description}</p>
    </Card>
  );
};

export const DashboardPage = () => {
  const workspace = useWorkspace();
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const sourceMap = useMemo(() => {
    return new Map(workspace.sources.map((source) => [source.id, source]));
  }, [workspace.sources]);

  const templateMap = useMemo(() => {
    return new Map(workspace.templates.map((template) => [template.id, template]));
  }, [workspace.templates]);

  const recentSubscriptions = useMemo(() => {
    return [...workspace.generatedSubscriptions]
      .sort((left, right) => {
        return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
      })
      .slice(0, 6);
  }, [workspace.generatedSubscriptions]);

  const handleRender = async (subscriptionId: string) => {
    setBusyId(subscriptionId);
    setFeedbackMessage(null);

    try {
      await workspace.renderGeneratedSubscription(subscriptionId);
      setFeedbackMessage("已完成一次新的生成。");
    } catch (error) {
      setFeedbackMessage(error instanceof Error ? error.message : "生成失败。");
    } finally {
      setBusyId(null);
    }
  };

  const handleCopyLink = async (subscriptionId: string) => {
    setBusyId(subscriptionId);
    setFeedbackMessage(null);

    try {
      const link = await workspace.createTempLink(subscriptionId);
      await copyText(link);
      setFeedbackMessage("已复制 24 小时有效的临时拉取链接。");
    } catch (error) {
      setFeedbackMessage(error instanceof Error ? error.message : "复制链接失败。");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-3">
        <StatCard
          title="外部订阅"
          value={String(workspace.sources.length)}
          description="当前账号可用的上游来源数量。"
        />
        <StatCard
          title="模板"
          value={String(workspace.templates.length)}
          description="用于重组和覆盖订阅的模板总数。"
        />
        <StatCard
          title="扩展订阅"
          value={String(workspace.generatedSubscriptions.length)}
          description="已经完成分组、规则和共享配置的可分发订阅。"
        />
      </section>

      {feedbackMessage ? (
        <div
          role="status"
          aria-live="polite"
          className="rounded-lg border border-[#dedcd1] border-l-[#c96442] border-l-4 bg-[#fffdf8] px-5 py-4 text-sm text-[#5f5e58] shadow-[0_1px_2px_rgba(20,20,19,0.04)]"
        >
          {feedbackMessage}
        </div>
      ) : null}

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)]">
        <Card className="rounded-lg p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-[#73726c]">
                近期生成
              </p>
              <h3 className="mt-2 text-xl font-semibold text-[#141413]">
                最近更新的扩展订阅
              </h3>
            </div>
            <Link
              to="/subscriptions"
              className="inline-flex items-center gap-2 rounded-lg border border-[#dedcd1] bg-[#fffdf8] px-4 py-2 text-sm font-medium text-[#3d3d3a] transition hover:border-[#c9c6ba] hover:text-[#141413]"
            >
              查看全部
              <ArrowUpRight className="size-4" />
            </Link>
          </div>

          <div className="mt-6 space-y-4">
            {recentSubscriptions.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[#dedcd1] bg-[#f5f4ed] px-5 py-10 text-center text-sm text-[#73726c]">
                还没有扩展订阅，进入向导粘贴外部订阅链接即可开始。
              </div>
            ) : null}

            {recentSubscriptions.map((subscription) => {
              const source = sourceMap.get(subscription.upstreamSourceId);
              const template = templateMap.get(subscription.templateId);

              return (
                <div
                  key={subscription.id}
                  className="rounded-lg border border-[#dedcd1] bg-[#f5f4ed] p-5"
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-lg font-semibold text-[#141413]">
                          {subscription.displayName}
                        </h4>
                        <Badge className={renderStatusTone[subscription.lastRenderStatus]}>
                          {renderStatusText[subscription.lastRenderStatus]}
                        </Badge>
                        <Badge className={syncStatusTone[subscription.lastSyncStatus]}>
                          {syncStatusText[subscription.lastSyncStatus]}
                        </Badge>
                      </div>
                      <div className="grid gap-2 text-sm text-[#73726c] sm:grid-cols-2">
                        <p>外部订阅：{source?.displayName ?? "已删除"}</p>
                        <p>
                          配置来源：
                          {subscription.renderMode === "draft"
                            ? "操作向导"
                            : template?.displayName ?? "已删除"}
                        </p>
                        <p>最近生成：{formatTime(subscription.lastRenderAt)}</p>
                        <p>用量：{formatUsage(subscription.latestUsage)}</p>
                      </div>
                      {subscription.lastErrorMessage ? (
                        <p className="text-sm text-[#7f2c28]">{subscription.lastErrorMessage}</p>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        disabled={busyId === subscription.id}
                        onClick={() => void handleRender(subscription.id)}
                      >
                        <RefreshCw className="size-4" />
                        立即生成
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={busyId === subscription.id}
                        onClick={() => void handleCopyLink(subscription.id)}
                      >
                        <Copy className="size-4" />
                        复制临时链接
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <div className="space-y-6">
          <Card className="rounded-lg p-6">
            <div className="flex items-start gap-4">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-[#141413] text-[#faf9f5]">
                <Waypoints className="size-5" />
              </div>
              <div>
                <h3 className="text-xl font-semibold text-[#141413]">快速开始</h3>
                <p className="mt-2 text-sm text-[#73726c]">
                  进入向导粘贴或选择外部订阅，开启自动分组，再把规则与操作沉淀为可复用模板。
                </p>
              </div>
            </div>

            <div className="mt-6 grid gap-3">
              <Link
                to="/subscriptions"
                className="flex items-center justify-between rounded-lg border border-[#dedcd1] bg-[#f5f4ed]/80 px-4 py-4 text-sm font-medium text-[#3d3d3a] transition hover:border-[#c9c6ba] hover:bg-white"
              >
                <span className="flex items-center gap-3">
                  <Server className="size-4" />
                  管理外部订阅
                </span>
                <ArrowUpRight className="size-4" />
              </Link>
              <Link
                to="/templates"
                className="flex items-center justify-between rounded-lg border border-[#dedcd1] bg-[#f5f4ed]/80 px-4 py-4 text-sm font-medium text-[#3d3d3a] transition hover:border-[#c9c6ba] hover:bg-white"
              >
                <span className="flex items-center gap-3">
                  <Sparkles className="size-4" />
                  浏览模板
                </span>
                <ArrowUpRight className="size-4" />
              </Link>
            </div>
          </Card>

          <Card className="rounded-lg p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-semibold text-[#141413]">模板市场概览</h3>
              <Badge>{workspace.marketplaceRulesets.length} 个内置规则源</Badge>
            </div>
            <div className="mt-5 space-y-3">
              {workspace.marketplaceRulesets.slice(0, 4).map((ruleset) => (
                <div
                  key={ruleset.id}
                  className="rounded-lg border border-[#dedcd1] bg-[#f5f4ed]/75 px-4 py-4"
                >
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-[#141413]">{ruleset.name}</p>
                    {ruleset.isOfficial ? (
                      <Badge className="border-[#7ab948]/40 bg-[#e9f1dc] text-[#265b19]">
                        官方
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-2 text-sm text-[#73726c]">{ruleset.description ?? "暂无说明"}</p>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </section>
    </div>
  );
};
