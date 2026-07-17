CREATE TABLE IF NOT EXISTS template_version_secrets (
  template_version_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  ciphertext BLOB NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (template_version_id, node_id),
  FOREIGN KEY (template_version_id) REFERENCES template_versions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_template_version_secrets_version
  ON template_version_secrets(template_version_id);
