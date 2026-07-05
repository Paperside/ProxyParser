import type { Health, SyncStatus, UsageInfo } from "./types";

export const formatTime = (value: string | null | undefined) => {
  if (!value) return "—";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
};

// "刚刚 / 4 分钟前 / 3 小时前 / 昨天 / 6/30"
export const formatRelative = (value: string | null | undefined) => {
  if (!value) return "—";
  const then = new Date(value).getTime();
  const diffMs = Date.now() - then;
  if (diffMs < 60_000) return "刚刚";
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)} 分钟前`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)} 小时前`;
  if (diffMs < 2 * 86_400_000) return "昨天";
  if (diffMs < 7 * 86_400_000) return `${Math.floor(diffMs / 86_400_000)} 天前`;
  return new Date(value).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
};

export const formatBytes = (value: number | null) => {
  if (value === null || Number.isNaN(value)) return "未知";
  if (value < 1024) return `${value.toFixed(0)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let next = value / 1024;
  let index = 0;
  while (next >= 1024 && index < units.length - 1) {
    next /= 1024;
    index += 1;
  }
  return `${next.toFixed(next >= 100 ? 0 : 1)} ${units[index]}`;
};

export const usageSummary = (usage: UsageInfo | null) => {
  if (!usage || usage.total === null) return null;
  const used = (usage.upload ?? 0) + (usage.download ?? 0);
  const percent = usage.total > 0 ? Math.round((used / usage.total) * 100) : 0;
  const expireDays =
    usage.expire !== null
      ? Math.max(0, Math.ceil((usage.expire * 1000 - Date.now()) / 86_400_000))
      : null;
  return { used, percent, expireDays, total: usage.total };
};

export const healthLabel: Record<Health, string> = {
  ok: "正常",
  warn: "注意",
  error: "故障"
};

export const syncStatusLabel: Record<SyncStatus, string> = {
  idle: "未同步",
  syncing: "同步中",
  success: "正常",
  failed: "失败",
  stale: "过期"
};

export const triggerLabel: Record<string, string> = {
  manual: "手动",
  upstream_sync: "上游同步",
  ruleset_update: "规则源更新",
  rollback: "回滚"
};

export const eventKindLabel: Record<string, string> = {
  "release.published": "发布新版本",
  "release.blocked": "发布被阻断",
  "subscription.pending_change": "待确认的上游变化",
  "source.synced": "订阅源同步成功",
  "source.sync_failed": "订阅源同步失败",
  "ruleset.update_available": "规则源有更新"
};
