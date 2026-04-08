ALTER TABLE templates
  ADD COLUMN source_template_id TEXT REFERENCES templates(id) ON DELETE SET NULL;

ALTER TABLE templates
  ADD COLUMN source_label TEXT;

ALTER TABLE templates
  ADD COLUMN source_url TEXT;
