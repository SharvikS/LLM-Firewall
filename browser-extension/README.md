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
| `background.js` | Calls the engine `/scan`; falls back to local on failure. |
| `content.js`    | Site adapters, send interception, blocking modal (shadow DOM). |
| `options.html/js` | Settings: enable, mode, engine URL, per-site, test. |
| `popup.html/js` | Quick on/off + engine status. |
