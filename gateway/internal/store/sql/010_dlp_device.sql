-- Migration 010: device + network forensics for DLP violations.
--
-- When a prompt is blocked/flagged we capture who and from WHERE: the client IP
-- (forwarded by the ML engine from the browser's /report connection), the full
-- browser/device fingerprint, and — where an enterprise provisions it via MDM /
-- managed extension policy — the real device name + id. device_json holds the
-- complete raw fingerprint so nothing is lost.

ALTER TABLE dlp_violations ADD COLUMN IF NOT EXISTS client_ip    TEXT NOT NULL DEFAULT '';
ALTER TABLE dlp_violations ADD COLUMN IF NOT EXISTS user_agent   TEXT NOT NULL DEFAULT '';
ALTER TABLE dlp_violations ADD COLUMN IF NOT EXISTS device_label TEXT NOT NULL DEFAULT '';
ALTER TABLE dlp_violations ADD COLUMN IF NOT EXISTS device_name  TEXT NOT NULL DEFAULT '';  -- MDM-provisioned, if any
ALTER TABLE dlp_violations ADD COLUMN IF NOT EXISTS device_id    TEXT NOT NULL DEFAULT '';  -- MDM-provisioned, if any
ALTER TABLE dlp_violations ADD COLUMN IF NOT EXISTS timezone     TEXT NOT NULL DEFAULT '';
ALTER TABLE dlp_violations ADD COLUMN IF NOT EXISTS languages    TEXT NOT NULL DEFAULT '';
ALTER TABLE dlp_violations ADD COLUMN IF NOT EXISTS screen       TEXT NOT NULL DEFAULT '';
ALTER TABLE dlp_violations ADD COLUMN IF NOT EXISTS device_json  TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_dlp_violations_ip ON dlp_violations(client_ip);

-- The flag carries the LAST seen device/IP so the admin sees where the offender
-- is right now without opening the history.
ALTER TABLE dlp_flags ADD COLUMN IF NOT EXISTS last_ip     TEXT NOT NULL DEFAULT '';
ALTER TABLE dlp_flags ADD COLUMN IF NOT EXISTS last_device TEXT NOT NULL DEFAULT '';

INSERT INTO schema_migrations(version) VALUES(10) ON CONFLICT DO NOTHING;
