import type { RenderStatus, ShareMode, SyncStatus, UsageInfo, Visibility } from "./types";

export const formatTime = (value: string | null) => {
  if (!value) {
    return "暂无";
  }

  return new Date(value).toLocaleString("zh-CN", {
    hour12: false
  });
};

export const formatRelativeDate = (value: string) => {
  return new Date(value).toLocaleDateString("zh-CN", {
    month: "numeric",
    day: "numeric"
  });
};

export const formatBytes = (value: number | null) => {
  if (value === null || Number.isNaN(value)) {
    return "未知";
  }

  if (value < 1024) {
    return `${value.toFixed(0)} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let nextValue = value / 1024;
  let unitIndex = 0;

  while (nextValue >= 1024 && unitIndex < units.length - 1) {
    nextValue /= 1024;
    unitIndex += 1;
  }

  return `${nextValue.toFixed(nextValue >= 100 ? 0 : 2)} ${units[unitIndex]}`;
};

export const formatUsage = (usage: UsageInfo | null) => {
  if (!usage) {
    return "未提供";
  }

  const used = (usage.upload ?? 0) + (usage.download ?? 0);

  if (usage.total === null) {
    return `${formatBytes(used)} / 未知`;
  }

  return `${formatBytes(used)} / ${formatBytes(usage.total)}`;
};

export const formatExpire = (usage: UsageInfo | null) => {
  if (!usage?.expire) {
    return "未提供";
  }

  return new Date(usage.expire * 1000).toLocaleString("zh-CN", {
    hour12: false
  });
};

export const syncStatusText: Record<SyncStatus, string> = {
  idle: "未同步",
  syncing: "同步中",
  success: "同步成功",
  failed: "同步失败",
  stale: "缓存过旧"
};

export const renderStatusText: Record<RenderStatus, string> = {
  pending: "待生成",
  rendering: "生成中",
  success: "可用",
  failed: "生成失败",
  degraded: "已回退"
};

export const visibilityText: Record<Visibility, string> = {
  private: "私有",
  unlisted: "凭链接访问",
  public: "公开"
};

export const shareModeText: Record<ShareMode, string> = {
  disabled: "不共享",
  view: "仅查看",
  fork: "允许复用"
};

export const publishStatusText: Record<"draft" | "published" | "archived", string> = {
  draft: "草稿",
  published: "已发布",
  archived: "已归档"
};

export const syncStatusTone: Record<SyncStatus, string> = {
  idle: "border-[#dedcd1] bg-[#f5f4ed] text-[#73726c]",
  syncing: "border-[#d1a041]/40 bg-[#f6eedf] text-[#5a4815]",
  success: "border-[#7ab948]/40 bg-[#e9f1dc] text-[#265b19]",
  failed: "border-[#cd5c58]/50 bg-[#f7ecec] text-[#7f2c28]",
  stale: "border-[#a87829]/40 bg-[#f6eedf] text-[#5a4815]"
};

export const renderStatusTone: Record<RenderStatus, string> = {
  pending: "border-[#dedcd1] bg-[#f5f4ed] text-[#73726c]",
  rendering: "border-[#80aadd]/45 bg-[#d6e4f6] text-[#3266ad]",
  success: "border-[#7ab948]/40 bg-[#e9f1dc] text-[#265b19]",
  failed: "border-[#cd5c58]/50 bg-[#f7ecec] text-[#7f2c28]",
  degraded: "border-[#a87829]/40 bg-[#f6eedf] text-[#5a4815]"
};
