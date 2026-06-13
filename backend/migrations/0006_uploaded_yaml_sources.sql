ALTER TABLE upstream_sources
  ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'url'
    CHECK (source_kind IN ('url', 'uploaded_yaml'));

ALTER TABLE upstream_sources
  ADD COLUMN uploaded_file_name TEXT;
