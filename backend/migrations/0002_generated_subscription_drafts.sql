CREATE TABLE IF NOT EXISTS generated_subscription_drafts (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  upstream_source_id TEXT,
  display_name TEXT NOT NULL,
  current_step TEXT NOT NULL DEFAULT 'source'
    CHECK (current_step IN ('source', 'proxies', 'groups_rules', 'settings', 'preview')),
  shareability_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (shareability_status IN ('unknown', 'shareable', 'source_locked')),
  selected_source_snapshot_id TEXT,
  last_preview_yaml TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (upstream_source_id) REFERENCES upstream_sources(id) ON DELETE SET NULL,
  FOREIGN KEY (selected_source_snapshot_id) REFERENCES upstream_source_snapshots(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_generated_subscription_drafts_owner_user_id
  ON generated_subscription_drafts(owner_user_id);

CREATE TABLE IF NOT EXISTS generated_subscription_draft_steps (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL,
  step_key TEXT NOT NULL
    CHECK (step_key IN ('source', 'proxies', 'groups_rules', 'settings')),
  patch_mode TEXT
    CHECK (patch_mode IN ('patch', 'full_override')),
  editor_mode TEXT NOT NULL DEFAULT 'visual'
    CHECK (editor_mode IN ('visual', 'raw')),
  operations_json TEXT NOT NULL,
  raw_json TEXT,
  summary_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (draft_id) REFERENCES generated_subscription_drafts(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_generated_subscription_draft_steps_draft_step_key
  ON generated_subscription_draft_steps(draft_id, step_key);
