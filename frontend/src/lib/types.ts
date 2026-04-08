export type Visibility = "private" | "unlisted" | "public";
export type ShareMode = "disabled" | "view" | "fork";
export type SyncStatus = "idle" | "syncing" | "success" | "failed" | "stale";
export type RenderStatus = "pending" | "rendering" | "success" | "failed" | "degraded";
export type ManagedSubscriptionMode = "template" | "draft";
export type GeneratedSubscriptionDraftStepKey =
  | "source"
  | "proxies"
  | "groups_rules"
  | "settings";
export type GeneratedSubscriptionDraftCurrentStep =
  | GeneratedSubscriptionDraftStepKey
  | "preview";
export type GeneratedSubscriptionDraftShareability =
  | "unknown"
  | "shareable"
  | "source_locked";

export interface User {
  id: string;
  email: string;
  username: string;
  displayName: string;
  locale: string;
  status: "active" | "disabled";
  isAdmin: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Session {
  user: User;
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

export interface UsageInfo {
  upload: number | null;
  download: number | null;
  total: number | null;
  expire: number | null;
}

export interface ParsedConfig {
  proxies: Array<{ name: string }>;
  "proxy-groups": Array<{ name: string; type: string; proxies: string[] }>;
  rules?: string[];
}

export interface UpstreamSource {
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
  usage: UsageInfo | null;
  proxyCount: number;
  groupCount: number;
  ruleCount: number;
}

export interface UpstreamSourceDetail extends UpstreamSource {
  latestSnapshotId: string | null;
  parsedConfig: ParsedConfig | null;
}

export interface TemplatePayload {
  rulesMode: "patch" | "full_override";
  groupsMode: "patch" | "full_override";
  configMode: "patch" | "full_override";
  customProxiesPolicy: "append" | "replace_same_name" | "fail_on_conflict";
  ruleProviderRefs: string[];
  rules: string[];
  proxyGroups: Array<{ name: string; type: string; proxies: string[] }>;
  configPatch: Record<string, unknown>;
  customProxies: Array<{ name: string }>;
}

export interface Template {
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

export interface TemplateDetail extends Template {
  payload: TemplatePayload;
  exportedYaml: string | null;
  versionNote: string | null;
}

export interface GeneratedSubscription {
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
  latestUsage: UsageInfo | null;
  createdAt: string;
  updatedAt: string;
}

export interface GeneratedSubscriptionDetail extends GeneratedSubscription {
  renderedYaml: string | null;
  templateName: string | null;
  sourceName: string | null;
}

export interface GeneratedSubscriptionSnapshot {
  id: string;
  managedSubscriptionId: string;
  renderedYaml: string;
  renderedJson: string | null;
  forwardedHeadersJson: string | null;
  validationStatus: "success" | "failed";
  validationError: string | null;
  createdAt: string;
}

export interface GeneratedSubscriptionSnapshotCompare {
  baseSnapshot: GeneratedSubscriptionSnapshot;
  targetSnapshot: GeneratedSubscriptionSnapshot;
  summary: {
    addedLineCount: number;
    removedLineCount: number;
  };
  addedLines: string[];
  removedLines: string[];
}

export interface GeneratedSubscriptionDraftStep {
  id: string;
  stepKey: GeneratedSubscriptionDraftStepKey;
  patchMode: "patch" | "full_override" | null;
  editorMode: "visual" | "raw";
  operations: unknown;
  raw: unknown;
  summary: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface GeneratedSubscriptionDraft {
  id: string;
  ownerUserId: string;
  upstreamSourceId: string | null;
  displayName: string;
  currentStep: GeneratedSubscriptionDraftCurrentStep;
  shareabilityStatus: GeneratedSubscriptionDraftShareability;
  createdAt: string;
  updatedAt: string;
}

export interface GeneratedSubscriptionDraftDetail extends GeneratedSubscriptionDraft {
  selectedSourceSnapshotId: string | null;
  lastPreviewYaml: string | null;
  steps: GeneratedSubscriptionDraftStep[];
}

export interface GeneratedSubscriptionDraftPreview {
  draft: GeneratedSubscriptionDraftDetail;
  sourceSnapshotId: string;
  shareabilityStatus: Exclude<GeneratedSubscriptionDraftShareability, "unknown">;
  lockedReasons: string[];
  stats: {
    proxyCount: number;
    groupCount: number;
    ruleCount: number;
  };
  document: {
    proxies: Array<Record<string, unknown>>;
    "proxy-groups": Array<Record<string, unknown>>;
    rules?: string[];
    [key: string]: unknown;
  };
  yamlText: string;
}

export interface MarketplaceRuleset {
  id: string;
  ownerUserId: string | null;
  slug: string;
  name: string;
  description: string | null;
  sourceType: "git_repo" | "http_file" | "inline";
  sourceUrl: string | null;
  sourceRepo: string | null;
  visibility: Visibility;
  isOfficial: boolean;
  status: "active" | "disabled" | "archived";
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  latestFetchStatus: "success" | "failed" | null;
  latestFetchedAt: string | null;
  latestExpiresAt: string | null;
  hasCachedContent: boolean;
}

export interface MarketplaceTemplate {
  id: string;
  displayName: string;
  slug: string | null;
  description: string | null;
  visibility: Visibility;
  publishStatus: "draft" | "published" | "archived";
  ownerUserId: string;
  ownerDisplayName: string | null;
  isOfficial: boolean;
  sourceLabel: string | null;
  sourceUrl: string | null;
  updatedAt: string;
}

export interface AuditLogEntry {
  id: string;
  actorUserId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  summary: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
}

export interface LoginResponse {
  user: User;
  tokens: {
    accessToken: string;
    accessTokenExpiresAt: string;
    refreshToken: string;
    refreshTokenExpiresAt: string;
  };
}

export interface RegisterResponse extends LoginResponse {
  subscriptionSecret: string;
}
