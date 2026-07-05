-- ProxyParser Next — 全新初始 schema（2026-07-04，无历史兼容）
-- 参见 docs/2026-07-04-proxyparser-next-technical-plan.md §3

-- ── 用户与认证 ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'zh-CN',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  is_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_passwords (
  user_id TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  last_used_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_refresh_tokens_user_id
  ON user_refresh_tokens(user_id);

-- ── 订阅源（上游） ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS upstream_sources (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_kind TEXT NOT NULL DEFAULT 'url' CHECK (source_kind IN ('url', 'uploaded_yaml')),
  uploaded_file_name TEXT,
  is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
  sync_interval_minutes INTEGER NOT NULL DEFAULT 360,
  next_sync_at TEXT,
  last_sync_status TEXT NOT NULL DEFAULT 'idle' CHECK (last_sync_status IN ('idle', 'syncing', 'success', 'failed', 'stale')),
  last_sync_at TEXT,
  last_successful_sync_at TEXT,
  last_failed_sync_at TEXT,
  last_error_message TEXT,
  last_successful_snapshot_id TEXT,
  latest_headers_json TEXT,
  latest_usage_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_upstream_sources_owner_user_id
  ON upstream_sources(owner_user_id);

CREATE TABLE IF NOT EXISTS upstream_source_sync_logs (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('syncing', 'success', 'failed', 'stale')),
  http_status INTEGER,
  error_message TEXT,
  response_headers_json TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  FOREIGN KEY (source_id) REFERENCES upstream_sources(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_upstream_source_sync_logs_source_id
  ON upstream_source_sync_logs(source_id);

CREATE TABLE IF NOT EXISTS upstream_source_snapshots (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  sync_log_id TEXT,
  raw_content TEXT NOT NULL,
  parsed_json TEXT,
  response_headers_json TEXT,
  usage_json TEXT,
  content_hash TEXT,
  etag TEXT,
  last_modified_header TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (source_id) REFERENCES upstream_sources(id) ON DELETE CASCADE,
  FOREIGN KEY (sync_log_id) REFERENCES upstream_source_sync_logs(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_upstream_source_snapshots_source_id
  ON upstream_source_snapshots(source_id);

CREATE TABLE IF NOT EXISTS source_sync_reports (
  id TEXT PRIMARY KEY,
  upstream_source_id TEXT NOT NULL,
  from_snapshot_id TEXT,
  to_snapshot_id TEXT NOT NULL,
  nodes_added TEXT NOT NULL DEFAULT '[]',
  nodes_removed TEXT NOT NULL DEFAULT '[]',
  nodes_renamed TEXT NOT NULL DEFAULT '[]',
  nodes_updated TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  FOREIGN KEY (upstream_source_id) REFERENCES upstream_sources(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_source_sync_reports_source
  ON source_sync_reports(upstream_source_id, created_at DESC);

-- ── 订阅（产品主角） ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
  build_config TEXT,                -- 已发布 BuildConfig JSON（发布前为 NULL）
  draft_build_config TEXT,          -- 草稿 BuildConfig JSON（NULL = 无未发布修改）
  active_release_id TEXT,
  publish_policy TEXT NOT NULL DEFAULT 'auto' CHECK (publish_policy IN ('auto', 'confirm')),
  pending_upstream_change INTEGER NOT NULL DEFAULT 0 CHECK (pending_upstream_change IN (0, 1)),
  health TEXT NOT NULL DEFAULT 'error' CHECK (health IN ('ok', 'warn', 'error')),
  health_reasons TEXT NOT NULL DEFAULT '[]',
  latest_headers_json TEXT,
  latest_usage_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_owner
  ON subscriptions(owner_user_id);

-- BuildConfig.sources 的物化索引：调度器由源反查订阅
CREATE TABLE IF NOT EXISTS subscription_sources (
  subscription_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  PRIMARY KEY (subscription_id, source_id),
  FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE,
  FOREIGN KEY (source_id) REFERENCES upstream_sources(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_subscription_sources_source
  ON subscription_sources(source_id);

CREATE TABLE IF NOT EXISTS releases (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  build_config TEXT NOT NULL,
  source_snapshot_ids TEXT NOT NULL DEFAULT '{}',
  rendered_yaml TEXT NOT NULL,
  rendered_hash TEXT NOT NULL,
  diff_summary TEXT NOT NULL DEFAULT '{}',
  trigger TEXT NOT NULL CHECK (trigger IN ('manual', 'upstream_sync', 'ruleset_update', 'rollback')),
  trigger_detail TEXT,
  validation TEXT NOT NULL DEFAULT '{}',
  created_by TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (subscription_id, seq),
  FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_releases_sub
  ON releases(subscription_id, seq DESC);

CREATE TABLE IF NOT EXISTS subscription_tokens (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT,
  rotated_from_id TEXT,
  revoked_at TEXT,
  last_used_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_subscription_tokens_sub
  ON subscription_tokens(subscription_id);

CREATE TABLE IF NOT EXISTS subscription_temp_tokens (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  last_used_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_subscription_temp_tokens_sub
  ON subscription_temp_tokens(subscription_id);

CREATE TABLE IF NOT EXISTS subscription_issues (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warn' CHECK (severity IN ('warn', 'error')),
  refs TEXT NOT NULL DEFAULT '{}',
  message TEXT NOT NULL,
  suggestion TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_issues_sub
  ON subscription_issues(subscription_id, resolved_at);

CREATE TABLE IF NOT EXISTS subscription_pull_logs (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL,
  token_kind TEXT NOT NULL CHECK (token_kind IN ('token', 'temp_token')),
  token_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'denied')),
  http_status INTEGER,
  served_release_id TEXT,
  client_ip TEXT,
  user_agent TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pull_logs_sub
  ON subscription_pull_logs(subscription_id, created_at DESC);

CREATE TABLE IF NOT EXISTS subscription_share_grants (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  target_user_id TEXT,
  target_email TEXT,
  mode TEXT NOT NULL CHECK (mode IN ('view', 'subscribe')),
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_share_grants_sub
  ON subscription_share_grants(subscription_id);

-- ── 自建节点敏感字段（AES-256-GCM） ────────────────────────────

CREATE TABLE IF NOT EXISTS custom_node_secrets (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  ciphertext BLOB NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ── 规则库 ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ruleset_catalog (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  source_type TEXT NOT NULL CHECK (source_type IN ('git_repo', 'http_file', 'inline')),
  source_url TEXT,
  source_repo TEXT,
  behavior TEXT NOT NULL DEFAULT 'classical' CHECK (behavior IN ('domain', 'ipcidr', 'classical')),
  recommended_target TEXT,
  is_official INTEGER NOT NULL DEFAULT 0 CHECK (is_official IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'archived')),
  latest_snapshot_hash TEXT,
  update_available INTEGER NOT NULL DEFAULT 0 CHECK (update_available IN (0, 1)),
  last_checked_at TEXT,
  last_check_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS ruleset_snapshots (
  hash TEXT PRIMARY KEY,
  catalog_id TEXT NOT NULL,
  content TEXT NOT NULL,
  behavior TEXT NOT NULL CHECK (behavior IN ('domain', 'ipcidr', 'classical')),
  entry_count INTEGER NOT NULL,
  is_public INTEGER NOT NULL DEFAULT 1 CHECK (is_public IN (0, 1)),
  fetched_at TEXT NOT NULL,
  FOREIGN KEY (catalog_id) REFERENCES ruleset_catalog(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ruleset_snapshots_catalog
  ON ruleset_snapshots(catalog_id, fetched_at DESC);

-- ── 模板 ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  slug TEXT,
  description TEXT,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'unlisted', 'public')),
  is_official INTEGER NOT NULL DEFAULT 0 CHECK (is_official IN (0, 1)),
  latest_version_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_templates_owner
  ON templates(owner_user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_templates_owner_slug
  ON templates(owner_user_id, slug)
  WHERE slug IS NOT NULL;

CREATE TABLE IF NOT EXISTS template_versions (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  version_note TEXT,
  payload_json TEXT NOT NULL,        -- TemplatePayloadV2（源无关 BuildConfig）
  extraction_report TEXT,            -- 提炼报告 JSON（recorded/dropped）
  created_at TEXT NOT NULL,
  UNIQUE (template_id, version),
  FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE
);

-- ── 事件与审计 ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  entity_kind TEXT NOT NULL CHECK (entity_kind IN ('source', 'subscription', 'ruleset')),
  entity_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_events_owner
  ON events(owner_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  summary TEXT,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor
  ON audit_logs(actor_user_id);
