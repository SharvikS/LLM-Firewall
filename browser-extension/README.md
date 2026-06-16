# TITAN LLM Firewall — Browser DLP extension

Stops sensitive data from being typed/pasted into **ChatGPT, Claude, and Gemini
web UIs** — the leak path that an API gateway can't see, because the browser
talks straight to the provider over TLS.

The extension hooks the chat composer, and the moment you hit **Send** (or press
Enter) it scans your prompt. If it finds PII, secrets, or a risky prompt it
**blocks the send and offers one-click "Redact & send"** (replacing the
sensitive spans with mask tokens). Nothing leaves the browser until it's clean.

## How detection works

Each send is scanned by the **TITAN ML engine** (`POST /scan` on port 8001) —
the same Presidio PII, secret, prompt-injection, and toxicity detectors the
gateway uses, so blocks honor your dashboard governance config and are
consistent with the proxy path. If the engine is unreachable the extension
falls back to **bundled local regex rules** (emails, SSNs, Luhn-checked cards,
AWS/OpenAI/GitHub keys, JWTs, private keys, and a few jailbreak heuristics) so
the machine is never left unprotected. The popup shows which path is live.

Enforcement mode is configurable (Settings):

- **Block & offer redact** (default) — safest; you choose to redact or edit.
- **Auto-redact and send** — silently masks and sends.
- **Warn only** — shows a warning but lets you send anyway.

### Hardening (make it bulletproof)

Two extra defenses, both in Settings:

- **Strict mode (fail-closed).** Normally, if the firewall engine is unreachable
  the extension falls back to lighter local regex rules (fail-open). With strict
  mode on, an unreachable engine **blocks the send entirely** — nothing
  unverified ever leaves the browser. Turn this on when you need a hard
  guarantee that no prompt goes out without a full server-side scan.
- **Scan on paste.** The send check is the backstop; this is the front line.
  Pasted text is scanned the moment it lands, so a pasted secret is caught (and
  blocked or masked) before you even reach the Send button.

### Repeat-offender flagging (central)

Every block/redaction/override is attributed to a stable per-install identity
(plus the detected account email, best-effort) and reported to the firewall.
When the same user crosses the violation threshold (**default 3**, set via
`DLP_FLAG_THRESHOLD` on the gateway) the firewall **raises a flag on the admin
portal** (the **DLP Flags** tab, with a live count badge in the sidebar) and
fires a high-priority SOC alert. Admins can drill into a user's full violation
history and acknowledge the flag once handled.

### Device & IP forensics (who / where)

Every violation is logged with the originating **device and network context** so
an admin knows exactly who and where:

- **Client IP** — stamped by the ML engine from the browser's `/report`
  connection (the authoritative first server hop, forwarded to the gateway as
  `X-Forwarded-For`). The page can't spoof it.
- **Device fingerprint** — OS, browser, platform, timezone, screen, languages,
  CPU cores, and RAM, with a derived `OS · Browser · Platform` label. The full
  raw blob is retained too.
- **Real device name/ID** — browsers can't expose the OS hostname or local IP
  (privacy sandbox), so for true device identity an enterprise provisions
  `deviceName` / `deviceId` via **managed extension policy (MDM)**; the extension
  reads `storage.managed` and includes them when present.

All of this shows on the **DLP Flags** tab (per-violation history + the flag's
last-seen device/IP) and the **Browser DLP** monitoring tab. As always, only
metadata is sent — never the prompt text or the sensitive values.

## Connected to the firewall (central visibility)

The extension is not a silo. Every block, redaction, and override is reported
back through the engine to the **gateway's unified observability plane**, so an
endpoint-side block in the browser shows up right next to an API-side block:

- **Dashboard → Events** lists browser events (`Browser Block` / `Browser
  Redact` / `Browser Override`) in the same live feed as gateway traffic.
- **Audit log + ClickHouse analytics** persist them for compliance.
- **SOC alerting** (Slack/Teams/SIEM webhooks) fires on browser blocks too,
  with the same risk-threshold and anti-storm coalescing.

Reporting carries verdict metadata only — **never the prompt text, PII values,
or secrets**. The popup also shows a local activity tally (blocked / redacted /
override counts + recent events) that works even when the engine is offline.

The path is `extension → engine POST /report → gateway POST /internal/dlp-event`
(server-to-server, so no cross-origin from the chat page). It is best-effort and
fail-open: if the gateway is down the scan/block still works and the event is
tallied locally. Optionally set `BROWSER_EVENT_TOKEN` on both the engine and the
gateway to require a shared secret on the ingest endpoint.

## Install (developer / unpacked)

The extension is a single Manifest V3 codebase that loads in all three engines.

**Chrome / Edge**
1. Go to `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode**.
3. **Load unpacked** → select this `browser-extension/` folder.

**Firefox**
1. Go to `about:debugging#/runtime/this-firefox`.
2. **Load Temporary Add-on…** → select `manifest.json` in this folder.
   (Temporary add-ons are removed on restart; package with `web-ext` for a
   persistent install.)

Then open the extension's **Settings** and confirm the engine URL
(`http://localhost:8001/scan` by default) — click **Test connection**.

## Running the engine

Start the ML engine so `/scan` is available:

```bash
cd ml_engine
venv/Scripts/python.exe -m analyzer.server   # gRPC + HTTP side-channel on :8001
```

`/scan` returns only a verdict and masked text — never your configured secrets
or upstream keys. CORS is open so the extension can reach it.

## Caveats

- **Selectors drift.** ChatGPT/Claude/Gemini change their DOM often. Each site
  adapter (in `content.js`) lists several selector candidates with a generic
  fallback, but a major redesign may need the selectors updated.
- **Coverage is the composer.** It scans what you type/paste into the message
  box on send. It does not inspect file uploads or images.
- This is endpoint-side DLP. For full coverage pair it with the gateway
  (API traffic) — together they cover both the SDK path and the browser path.

## Files

| File | Role |
|------|------|
| `manifest.json` | MV3 manifest (Chrome/Edge `service_worker` + Firefox `scripts`). |
| `config.js`     | Shared defaults + `dlpGetConfig()`. |
| `detectors.js`  | Local-fallback regex detectors (`LocalDLP.localScan`). |
| `background.js` | Calls the engine `/scan` (local fallback); relays events to `/report` + keeps the local activity tally. |
| `content.js`    | Site adapters, send interception, blocking modal (shadow DOM), reports the final user action. |
| `options.html/js` | Settings: enable, mode, engine URL, per-site, test. |
| `popup.html/js` | Quick on/off, engine status, and recent-activity view. |
