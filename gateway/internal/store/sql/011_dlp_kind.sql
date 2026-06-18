-- Migration 011: attachment scanning for DLP violations.
--
-- The browser extension now scans file & image uploads (not just typed text):
-- kind distinguishes a 'text' prompt from a 'file' or 'image' attachment, and
-- filename records the attachment name so the admin sees exactly what was
-- blocked. Defaults keep every existing (text) violation valid.

ALTER TABLE dlp_violations ADD COLUMN IF NOT EXISTS kind     TEXT NOT NULL DEFAULT 'text';
ALTER TABLE dlp_violations ADD COLUMN IF NOT EXISTS filename TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_dlp_violations_kind ON dlp_violations(kind);

INSERT INTO schema_migrations(version) VALUES(11) ON CONFLICT DO NOTHING;
