# TITAN LLM Firewall — Browser DLP extension

Stops sensitive data from being typed/pasted into **ChatGPT, Claude, Gemini, and
Perplexity web UIs** — the leak path that an API gateway can't see, because the
browser talks straight to the provider over TLS.

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

## UI / tech stack

The popup, options page, and the in-page blocking modal are built with the same
stack as the admin portal — **React 19, Tailwind CSS v4, Framer Motion, and
Lucide React** — bundled for Manifest V3 with **Vite + @crxjs/vite-plugin**. The
look is a premium dark aesthetic (glassmorphism surfaces on the `#0d1014` base,
the brand-blue accent, and micro-animations on hover/tap). The blocking modal is
a React component rendered into a **shadow root** with its Tailwind stylesheet
injected inline, so the host page's CSS can neither break it nor leak into it.

The core enforcement layer is unchanged: the send/paste **interception logic**,
the **background service worker**, and the **local fallback regexes** all carry
over verbatim — only restructured from `globalThis` IIFEs into ES modules.

## Install (developer / unpacked)

Build first (`npm install && npm run build`), then load the build output:

**Chrome / Edge**
1. Go to `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode**.
3. **Load unpacked** → select the `browser-extension/dist/` folder.

**Firefox** (run `npm run build:firefox` first)
1. Go to `about:debugging#/runtime/this-firefox`.
2. **Load Temporary Add-on…** → select `dist-firefox/manifest.json`.
   (Temporary add-ons are removed on restart; package with `web-ext` for a
   persistent install. Firefox ≥128 is required for the module background.)

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

- **Selectors drift.** The chat UIs change their DOM often. Each site adapter
  (in `src/content/index.jsx`) lists several selector candidates with a generic fallback.
  On top of that, the extension fetches a **centrally-managed selector map** from
  the engine's `GET /selectors`, caches it, and merges it *over* the bundled
  ones — so ops can fix a drift server-side (or via the `SELECTORS_JSON` env on
  the engine) **without re-publishing the extension**. A stale/absent engine
  just degrades to the shipped selectors.
- **Coverage is the composer.** It scans what you type/paste into the message
  box on send. It does not inspect file uploads or images.
- This is endpoint-side DLP. For full coverage pair it with the gateway
  (API traffic) — together they cover both the SDK path and the browser path.

## Files

| Path | Role |
|------|------|
| `manifest.config.js` | MV3 manifest authored for crxjs (icons, CSP, content scripts, SW). |
| `vite.config.js` | Vite build: React + Tailwind v4 + crxjs. |
| `src/lib/config.js` | Shared defaults + `dlpGetConfig()` / `dlpGetInstallId()`. |
| `src/lib/detectors.js` | Local-fallback regex detectors (`localScan`). |
| `src/lib/hooks.js` | React hooks: config, stats, engine status, active-site. |
| `src/lib/api.js` | Normalized `browser`/`chrome` API handle. |
| `src/background.js` | Calls the engine `/scan` (local fallback); relays `/report`, caches `/selectors`, badge + activity tally. |
| `src/content/index.jsx` | Site adapters, send/paste interception, mounts the React modal. |
| `src/content/Modal.jsx` | React blocking modal (shadow DOM, Framer Motion). |
| `src/popup/` | Popup React app — quick on/off, stats, recent activity, engine status. |
| `src/options/` | Options React app — mode, strict, paste-scan, engine URL, per-site. |
| `src/ui/primitives.jsx` | Shared design-system components (Logo, Card, Toggle, Button, Segmented, Chip). |
| `src/styles/theme.css` | Tailwind import, design tokens, glassmorphism + animation utilities. |
| `icons/` | Brand icons (16/32/48/128), generated by `scripts/gen-icons.js`. |
| `scripts/` | `gen-icons.js`, `make-firefox.js` (FF manifest), `zip.js` (package). |
| `tests/` | Jest unit tests for the local detectors. |

## Development

```bash
cd browser-extension
npm install
npm run dev        # Vite dev server with HMR (load dist/ as unpacked)
npm run lint       # eslint (js + jsx)
npm test           # jest unit tests for src/lib/detectors.js
npm run icons      # regenerate icons/ from scripts/gen-icons.js
npm run build      # Vite + crxjs → dist/ (Chrome MV3)
npm run build:firefox  # derive dist-firefox/ (Firefox MV3 manifest)
npm run package    # build + firefox + zip → chrome-extension.zip / firefox-extension.zip
```

CI (`.github/workflows/extension.yml`) runs lint → test → build → firefox →
package and uploads both zips as artifacts on every push to `main` that touches
the extension.
