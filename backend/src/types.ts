export interface SubscriptionConfig {
  name: string;
  url: string;
}

export type Visibility = "private" | "unlisted" | "public";
export type ShareMode = "disabled" | "view" | "fork";
export type SyncStatus = "idle" | "syncing" | "success" | "failed" | "stale";
export type RenderStatus = "pending" | "rendering" | "success" | "failed" | "degraded";
export type ManagedSubscriptionMode = "template" | "draft";
export type TemplateSectionMode = "patch" | "full_override";
export type CustomProxyPolicy = "append" | "replace_same_name" | "fail_on_conflict";

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

export interface SubscriptionUsageInfo {
  upload: number | null;
  download: number | null;
  total: number | null;
  expire: number | null;
}

export interface UpstreamSourceSummary {
  id: string;
  ownerUserId: string;
  displayName: string;
  sourceUrl: string;
  visibility: Visibility;
  shareMode: ShareMode;
  isEnabled: boolean;
  lastSyncStatus: SyncStatus;
  lastSyncAt: string | null;
  lastSuccessfulSyncAt: string | null;
  lastFailedSyncAt: string | null;
  createdAt: string;
  updatedAt: string;
  headers: Record<string, string>;
  usage: SubscriptionUsageInfo | null;
  proxyCount: number;
  groupCount: number;
  ruleCount: number;
}

export interface UpstreamSourceDetail extends UpstreamSourceSummary {
  latestSnapshotId: string | null;
  parsedConfig: ClashProxyDocument | null;
}

export interface TemplatePayload {
  rulesMode: TemplateSectionMode;
  groupsMode: TemplateSectionMode;
  configMode: TemplateSectionMode;
  customProxiesPolicy: CustomProxyPolicy;
  ruleProviderRefs: string[];
  rules: string[];
  proxyGroups: ProxyGroupEntry[];
  configPatch: Record<string, unknown>;
  customProxies: ProxyNode[];
}

export interface TemplateSummary {
  id: string;
  ownerUserId: string;
  ownerDisplayName: string | null;
  isOfficial: boolean;
  displayName: string;
  slug: string | null;
  description: string | null;
  sourceTemplateId: string | null;
  sourceLabel: string | null;
  sourceUrl: string | null;
  visibility: Visibility;
  shareMode: ShareMode;
  publishStatus: "draft" | "published" | "archived";
  latestVersionId: string | null;
  latestVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateDetail extends TemplateSummary {
  payload: TemplatePayload;
  exportedYaml: string | null;
  versionNote: string | null;
}

export interface ManagedSubscriptionSummary {
  id: string;
  ownerUserId: string;
  upstreamSourceId: string;
  templateId: string;
  draftId: string | null;
  renderMode: ManagedSubscriptionMode;
  displayName: string;
  visibility: Visibility;
  shareMode: ShareMode;
  isEnabled: boolean;
  currentSnapshotId: string | null;
  lastSuccessfulSnapshotId: string | null;
  lastSyncStatus: SyncStatus;
  lastRenderStatus: RenderStatus;
  lastSyncAt: string | null;
  lastRenderAt: string | null;
  lastErrorMessage: string | null;
  latestHeaders: Record<string, string>;
  latestUsage: SubscriptionUsageInfo | null;
  createdAt: string;
  updatedAt: string;
}

export interface ManagedSubscriptionDetail extends ManagedSubscriptionSummary {
  renderedYaml: string | null;
  templateName: string | null;
  sourceName: string | null;
}
