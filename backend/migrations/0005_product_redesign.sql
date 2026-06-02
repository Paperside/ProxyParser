ALTER TABLE templates
  ADD COLUMN shareability_status TEXT NOT NULL DEFAULT 'unknown'
  CHECK (shareability_status IN ('unknown', 'shareable', 'source_locked', 'sanitized'));

ALTER TABLE templates
  ADD COLUMN sanitized_from_template_id TEXT REFERENCES templates(id) ON DELETE SET NULL;

ALTER TABLE templates
  ADD COLUMN locked_reasons_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE user_subscription_temp_tokens
  ADD COLUMN label TEXT;

CREATE TABLE IF NOT EXISTS subscription_share_grants (
  id TEXT PRIMARY KEY,
  managed_subscription_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  target_user_id TEXT,
  target_email TEXT,
  scope TEXT NOT NULL CHECK (scope IN ('user', 'public', 'unlisted')),
  mode TEXT NOT NULL CHECK (mode IN ('view', 'fork', 'subscribe')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (managed_subscription_id) REFERENCES managed_subscriptions(id) ON DELETE CASCADE,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_subscription_share_grants_subscription_id
  ON subscription_share_grants(managed_subscription_id);

CREATE INDEX IF NOT EXISTS idx_subscription_share_grants_target_user_id
  ON subscription_share_grants(target_user_id);
