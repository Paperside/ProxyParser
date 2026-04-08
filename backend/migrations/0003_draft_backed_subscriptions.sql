ALTER TABLE templates
  ADD COLUMN is_internal INTEGER NOT NULL DEFAULT 0 CHECK (is_internal IN (0, 1));

ALTER TABLE managed_subscriptions
  ADD COLUMN render_mode TEXT NOT NULL DEFAULT 'template' CHECK (render_mode IN ('template', 'draft'));

ALTER TABLE managed_subscriptions
  ADD COLUMN draft_id TEXT REFERENCES generated_subscription_drafts(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_managed_subscriptions_draft_id
  ON managed_subscriptions(draft_id)
  WHERE draft_id IS NOT NULL;
