// 前端 API DTO 类型（与后端各 service 返回结构对应）
import type {
  BuildConfig,
  TemplateExtractionReport,
  TemplatePayloadV2
} from "./build-config-types";

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

export interface AuthTokens {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

export interface LoginResponse {
  user: User;
  tokens: AuthTokens;
}

export type RegisterResponse = LoginResponse;

export type Health = "ok" | "warn" | "error";
export type SyncStatus = "idle" | "syncing" | "success" | "failed" | "stale";

export interface UsageInfo {
  upload: number | null;
  download: number | null;
  total: number | null;
  expire: number | null;
}

// ── 订阅源 ───────────────────────────────────────────────────

export interface SourceSummary {
  id: string;
  ownerUserId: string;
  displayName: string;
  sourceUrl: string;
  sourceKind: "url" | "uploaded_yaml";
  uploadedFileName: string | null;
  isEnabled: boolean;
  syncIntervalMinutes: number;
  nextSyncAt: string | null;
  lastSyncStatus: SyncStatus;
  lastSyncAt: string | null;
  lastSuccessfulSyncAt: string | null;
  lastErrorMessage: string | null;
  usage: UsageInfo | null;
  proxyCount: number;
  groupCount: number;
  ruleCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SyncReport {
  id: string;
  upstreamSourceId: string;
  fromSnapshotId: string | null;
  toSnapshotId: string;
  nodesAdded: Array<{ id: string; name: string }>;
  nodesRemoved: Array<{ id: string; name: string }>;
  nodesRenamed: Array<{ id: string; from: string; to: string }>;
  nodesUpdated: Array<{ id: string; name: string }>;
  createdAt: string;
}

// ── 订阅 ─────────────────────────────────────────────────────

export interface SubscriptionSummary {
  id: string;
  displayName: string;
  isEnabled: boolean;
  health: Health;
  healthReasons: string[];
  publishPolicy: "auto" | "confirm";
  pendingUpstreamChange: boolean;
  hasDraft: boolean;
  mode: "rebuild" | "patch" | null;
  sourceNames: string[];
  activeReleaseSeq: number | null;
  activeReleaseAt: string | null;
  lastPullAt: string | null;
  issueCount: { warn: number; error: number };
  usage: UsageInfo | null;
  createdAt: string;
  updatedAt: string;
}

export interface Issue {
  id: string;
  subscriptionId: string;
  kind: string;
  severity: "warn" | "error";
  refs: Record<string, unknown>;
  message: string;
  suggestion: string | null;
  createdAt: string;
}

export interface SubscriptionDetail extends SubscriptionSummary {
  buildConfig: BuildConfig | null;
  draftBuildConfig: BuildConfig | null;
  activeRelease: { id: string; seq: number; createdAt: string; trigger: string } | null;
  issues: Issue[];
}

export interface DiffSummary {
  nodes: {
    added: string[];
    removed: string[];
    renamed: Array<{ from: string; to: string }>;
    updated: string[];
  };
  groups: { added: string[]; removed: string[]; membersChanged: string[] };
  ruleCountDelta: number;
  configKeysChanged: string[];
  identical: boolean;
}

export interface EvaluateIssueDto {
  kind: string;
  severity: "warn" | "error";
  message: string;
  refs: Record<string, unknown>;
}

export interface NodeIndexEntry {
  id: string;
  renderedName: string;
  sourceId: string | null;
  disabled: boolean;
  region: string | null;
  regionInferred: boolean;
  protocol: string;
  tags: string[];
}

export interface PreviewResult {
  yamlText: string;
  issues: EvaluateIssueDto[];
  stats: { nodeCount: number; groupCount: number; ruleCount: number; providerCount: number };
  nodeIndex: NodeIndexEntry[];
  diffVsActive: DiffSummary | null;
  activeReleaseSeq: number | null;
}

export interface MihomoValidationDto {
  available: boolean;
  passed: boolean | null;
  exitCode: number | null;
  output: string | null;
  durationMs: number | null;
}

export interface ReleaseSummary {
  id: string;
  seq: number;
  trigger: "manual" | "upstream_sync" | "ruleset_update" | "rollback";
  triggerDetail: string | null;
  diffSummary: DiffSummary | Record<string, never>;
  validation: { structuralErrors: number; mihomo: MihomoValidationDto | null };
  createdBy: string | null;
  createdAt: string;
  isActive: boolean;
}

export interface ReleaseDetail extends Omit<ReleaseSummary, "isActive"> {
  renderedYaml: string;
}

export interface TokenInfo {
  id: string;
  subscriptionId: string;
  label: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  expiresAt?: string;
}

export interface IssuedToken extends TokenInfo {
  token: string;
  url: string;
}

export interface PullLogEntry {
  id: string;
  token_kind: string;
  status: string;
  http_status: number;
  served_release_id: string | null;
  client_ip: string | null;
  user_agent: string | null;
  error_message: string | null;
  created_at: string;
}

export interface AccessInfo {
  tokens: TokenInfo[];
  tempTokens: TokenInfo[];
  pullLogs: PullLogEntry[];
}

export interface TraceResultDto {
  verdict: "hit" | "maybe" | "final" | "no-rules";
  matched: { ruleText: string; index: number; via: string | null } | null;
  target: string | null;
  groupChain: string[];
  maybeNotes: string[];
}

export interface CreateSubscriptionResponse {
  subscription: SubscriptionDetail;
  token: IssuedToken;
}

// ── 规则库 ───────────────────────────────────────────────────

export interface RulesetCatalogEntry {
  id: string;
  ownerUserId: string | null;
  slug: string;
  name: string;
  description: string | null;
  sourceUrl: string | null;
  behavior: "domain" | "ipcidr" | "classical";
  recommendedTarget: string | null;
  isOfficial: boolean;
  status: string;
  latestSnapshotHash: string | null;
  updateAvailable: boolean;
  lastCheckedAt: string | null;
  lastCheckError: string | null;
}

export interface RulesetDiff {
  fromHash: string | null;
  toHash: string;
  addedCount: number;
  removedCount: number;
  addedSample: string[];
  removedSample: string[];
  toEntryCount: number;
}

export interface PasteParseReportDto {
  entries: Array<{ type: string; value: string; extra?: string }>;
  totalLines: number;
  duplicatesRemoved: number;
  normalizedCount: number;
  strippedTargets: number;
  skippedMatch: number;
  invalid: Array<{ line: string; reason: string }>;
}

// ── 模板 ─────────────────────────────────────────────────────

export interface TemplateSummary {
  id: string;
  ownerUserId: string;
  displayName: string;
  slug: string | null;
  description: string | null;
  visibility: "private" | "unlisted" | "public";
  isOfficial: boolean;
  latestVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateDetail extends TemplateSummary {
  payload: TemplatePayloadV2 | null;
  extractionReport: TemplateExtractionReport | null;
}

// ── 事件 ─────────────────────────────────────────────────────

export interface EventEntry {
  id: string;
  entityKind: "source" | "subscription" | "ruleset";
  entityId: string;
  kind: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface InstanceHealth {
  database: { path: string; migrationCount: number; tableCount: number; rulesetCatalogCount: number };
  scheduler: { lastTickAt: string | null };
  mihomoGate: { available: boolean };
  publicBaseUrl: string;
}
