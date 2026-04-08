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

CREATE TABLE IF NOT EXISTS user_subscription_secrets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  secret_hash TEXT NOT NULL,
  rotated_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_subscription_temp_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  managed_subscription_id TEXT,
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  last_used_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_subscription_temp_tokens_user_id
  ON user_subscription_temp_tokens(user_id);

CREATE TABLE IF NOT EXISTS upstream_sources (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'clash_url' CHECK (source_type IN ('clash_url')),
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'unlisted', 'public')),
  share_mode TEXT NOT NULL DEFAULT 'disabled' CHECK (share_mode IN ('disabled', 'view', 'fork')),
  is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
  last_sync_status TEXT NOT NULL DEFAULT 'idle' CHECK (last_sync_status IN ('idle', 'syncing', 'success', 'failed', 'stale')),
  last_sync_at TEXT,
  last_successful_sync_at TEXT,
  last_failed_sync_at TEXT,
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

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  slug TEXT,
  description TEXT,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'unlisted', 'public')),
  share_mode TEXT NOT NULL DEFAULT 'disabled' CHECK (share_mode IN ('disabled', 'view', 'fork')),
  publish_status TEXT NOT NULL DEFAULT 'draft' CHECK (publish_status IN ('draft', 'published', 'archived')),
  latest_version_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_templates_owner_user_id
  ON templates(owner_user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_templates_owner_slug
  ON templates(owner_user_id, slug)
  WHERE slug IS NOT NULL;

CREATE TABLE IF NOT EXISTS template_versions (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  version_note TEXT,
  payload_json TEXT NOT NULL,
  exported_yaml TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_template_versions_template_id_version
  ON template_versions(template_id, version);

CREATE TABLE IF NOT EXISTS managed_subscriptions (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  upstream_source_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'unlisted', 'public')),
  share_mode TEXT NOT NULL DEFAULT 'disabled' CHECK (share_mode IN ('disabled', 'view', 'fork')),
  is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
  current_snapshot_id TEXT,
  last_successful_snapshot_id TEXT,
  last_sync_status TEXT NOT NULL DEFAULT 'idle' CHECK (last_sync_status IN ('idle', 'syncing', 'success', 'failed', 'stale')),
  last_render_status TEXT NOT NULL DEFAULT 'pending' CHECK (last_render_status IN ('pending', 'rendering', 'success', 'failed', 'degraded')),
  last_sync_at TEXT,
  last_render_at TEXT,
  last_error_message TEXT,
  latest_headers_json TEXT,
  latest_usage_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (upstream_source_id) REFERENCES upstream_sources(id) ON DELETE CASCADE,
  FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_managed_subscriptions_owner_user_id
  ON managed_subscriptions(owner_user_id);

CREATE INDEX IF NOT EXISTS idx_managed_subscriptions_upstream_source_id
  ON managed_subscriptions(upstream_source_id);

CREATE TABLE IF NOT EXISTS managed_subscription_snapshots (
  id TEXT PRIMARY KEY,
  managed_subscription_id TEXT NOT NULL,
  upstream_source_snapshot_id TEXT,
  template_version_id TEXT,
  rendered_yaml TEXT NOT NULL,
  rendered_json TEXT,
  forwarded_headers_json TEXT,
  validation_status TEXT NOT NULL DEFAULT 'success' CHECK (validation_status IN ('success', 'failed')),
  validation_error TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (managed_subscription_id) REFERENCES managed_subscriptions(id) ON DELETE CASCADE,
  FOREIGN KEY (upstream_source_snapshot_id) REFERENCES upstream_source_snapshots(id) ON DELETE SET NULL,
  FOREIGN KEY (template_version_id) REFERENCES template_versions(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_managed_subscription_snapshots_subscription_id
  ON managed_subscription_snapshots(managed_subscription_id);

CREATE TABLE IF NOT EXISTS managed_subscription_pull_logs (
  id TEXT PRIMARY KEY,
  managed_subscription_id TEXT NOT NULL,
  token_kind TEXT NOT NULL CHECK (token_kind IN ('user_secret', 'temp_token')),
  temp_token_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'degraded', 'denied')),
  http_status INTEGER,
  sync_attempted INTEGER NOT NULL DEFAULT 0 CHECK (sync_attempted IN (0, 1)),
  served_snapshot_id TEXT,
  client_ip TEXT,
  user_agent TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (managed_subscription_id) REFERENCES managed_subscriptions(id) ON DELETE CASCADE,
  FOREIGN KEY (temp_token_id) REFERENCES user_subscription_temp_tokens(id) ON DELETE SET NULL,
  FOREIGN KEY (served_snapshot_id) REFERENCES managed_subscription_snapshots(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_managed_subscription_pull_logs_subscription_id
  ON managed_subscription_pull_logs(managed_subscription_id);

CREATE TABLE IF NOT EXISTS ruleset_catalog (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  source_type TEXT NOT NULL CHECK (source_type IN ('git_repo', 'http_file', 'inline')),
  source_url TEXT,
  source_repo TEXT,
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('private', 'unlisted', 'public')),
  is_official INTEGER NOT NULL DEFAULT 0 CHECK (is_official IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'archived')),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS ruleset_cache_entries (
  id TEXT PRIMARY KEY,
  catalog_item_id TEXT NOT NULL,
  content_text TEXT NOT NULL,
  content_hash TEXT,
  etag TEXT,
  last_modified_header TEXT,
  fetch_status TEXT NOT NULL CHECK (fetch_status IN ('success', 'failed')),
  error_message TEXT,
  fetched_at TEXT NOT NULL,
  expires_at TEXT,
  FOREIGN KEY (catalog_item_id) REFERENCES ruleset_catalog(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ruleset_cache_entries_catalog_item_id
  ON ruleset_cache_entries(catalog_item_id);

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

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_user_id
  ON audit_logs(actor_user_id);
