// 跨模块共享的基础类型（Next 版本精简后）。
// BuildConfig 相关类型在 lib/build-config/types.ts。

export type SyncStatus = "idle" | "syncing" | "success" | "failed" | "stale";

export interface ProxyNode {
  name: string;
  [key: string]: unknown;
}

export interface ProxyGroupEntry {
  name: string;
  type: string;
  proxies: string[];
  [key: string]: unknown;
}

export interface ClashProxyDocument {
  proxies: ProxyNode[];
  "proxy-groups": ProxyGroupEntry[];
  rules?: string[];
  [key: string]: unknown;
}

export interface ProxyFetchResult {
  status: "success" | "failed";
  data?: ClashProxyDocument | null;
  headers?: Record<string, string>;
  lastModified: Date;
  errMsg?: string;
}

export interface SubscriptionUsageInfo {
  upload: number | null;
  download: number | null;
  total: number | null;
  expire: number | null;
}
