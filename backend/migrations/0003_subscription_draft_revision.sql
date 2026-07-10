-- Optimistic concurrency token for whole-document BuildConfig draft writes.
ALTER TABLE subscriptions
  ADD COLUMN draft_revision INTEGER NOT NULL DEFAULT 0;
