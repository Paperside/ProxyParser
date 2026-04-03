export interface SubscriptionConfig {
  name: string;
  url: string;
}

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

export interface ProxyStatusSummary {
  name: string;
  status: "success" | "failed";
  lastModified: string;
  proxyCount: number;
  groupCount: number;
  ruleCount: number;
  subscriptionUserInfo: string | null;
  error: string | null;
}

export interface ProxyStatusMeta extends ProxyStatusSummary {
  headers: Record<string, string>;
  groups: string[];
}
