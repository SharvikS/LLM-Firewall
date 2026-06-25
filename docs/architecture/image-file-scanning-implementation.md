# Image & File Scanning — Full Implementation Plan
### TITAN LLM Firewall | Browser DLP Extension + ML Engine

> **Status, 2026-06-25:** This file is a preserved implementation plan. The
> feature is already implemented in the current codebase, but not with the exact
> file split proposed below. The source of truth is:
>
> - `ml_engine/analyzer/extract.py` for text extraction, magic-byte image
>   sniffing, OCR, timeouts, and file-type policy.
> - `ml_engine/analyzer/server.py` for `scan_file` verdict composition.
> - `ml_engine/analyzer/embed.py` for `POST /scan-file`.
> - `browser-extension/src/background.js` and `browser-extension/src/content/index.jsx`
>   for attachment interception, engine calls, local fallback, and reporting.
>
> Keep the sections below as design background, not as an open checklist.

---

## Table of Contents

1. [Overview & Architecture](#1-overview--architecture)
2. [Phase 0 — Prerequisites & Dependencies](#2-phase-0--prerequisites--dependencies)
3. [Phase 1 — ML Engine: File Scanner Module](#3-phase-1--ml-engine-file-scanner-module)
4. [Phase 2 — ML Engine: Image Scanner Module](#4-phase-2--ml-engine-image-scanner-module)
5. [Phase 3 — ML Engine: New HTTP Endpoints](#5-phase-3--ml-engine-new-http-endpoints)
6. [Phase 4 — Browser Extension: DOM Attachment Detection](#6-phase-4--browser-extension-dom-attachment-detection)
7. [Phase 5 — Browser Extension: Background Script Routing](#7-phase-5--browser-extension-background-script-routing)
8. [Phase 6 — Browser Extension: Offline Fallback Handling](#8-phase-6--browser-extension-offline-fallback-handling)
9. [Phase 7 — Browser Extension: Local Detector Stub](#9-phase-7--browser-extension-local-detector-stub)
10. [Phase 8 — UI: Modal & Popup Updates](#10-phase-8--ui-modal--popup-updates)
11. [Phase 9 — Testing Strategy](#11-phase-9--testing-strategy)
12. [Phase 10 — Deployment & Configuration Checklist](#12-phase-10--deployment--configuration-checklist)
13. [Data Flow Diagram](#13-data-flow-diagram)
14. [Verdict Shape Contract](#14-verdict-shape-contract)

---

## 1. Overview & Architecture

### The Problem

The current extension only intercepts **typed and pasted text** via `getText(composer)`. When a user attaches an image (e.g., a screenshot of credentials) or a file (e.g., a PDF of internal code), the data flows straight to the LLM — completely bypassing every detector in the stack.

### The Solution

Extend the interception pipeline with two new detection paths that plug into the **same verdict shape** as the existing `/scan` text endpoint, so all calling code treats them identically.

```
User attaches file/image
        │
        ▼
content.js — detectAttachments()
        │  reads File objects from DOM inputs
        │  converts to base64
        ▼
background.js — DLP_SCAN_FILE / DLP_SCAN_IMAGE handler
        │  POSTs to /scan-file or /scan-image on the ML engine
        ▼
embed.py — new routes
        │
   ┌────┴────┐
   │         │
file_scanner  image_scanner
(PyMuPDF,    (pytesseract,
 python-docx, Pillow, OCR)
 openpyxl)
   │         │
   └────┬────┘
        │  extracted plain text
        ▼
existing scan_text() pipeline
(Presidio PII + secret_scanner + injection_detector + toxicity)
        │
        ▼
{decision, risk, reason, categories, pii, secrets, masked_text}
        │
        ▼
content.js — worst verdict wins → block / warn / allow send
```

> **NOTE:** The verdict shape is **identical** to what `/scan` already returns. The extension's existing `handleSendAttempt` function requires zero changes to its decision logic — it just awaits an array of verdicts (one per text + one per attachment) and picks the highest-risk one.

---

## 2. Phase 0 — Prerequisites & Dependencies

### 2.1 System Dependencies

These must be installed on the machine or Docker image running the ML engine **before** the Python packages.

```bash
# macOS (dev)
brew install tesseract tesseract-lang

# Ubuntu/Debian (production Docker)
apt-get install -y tesseract-ocr tesseract-ocr-eng libtesseract-dev
```

> **WARNING:** `pytesseract` is a Python wrapper — it requires the Tesseract binary to be in `PATH`. The Docker `Dockerfile` must be updated to install it at the OS layer.

### 2.2 Python Dependencies

**File:** `ml_engine/requirements.txt`

Add the following lines:

```
# Image scanning
pytesseract>=0.3.10
Pillow>=10.3.0

# File scanning
PyMuPDF>=1.24.0
python-docx>=1.1.0
openpyxl>=3.1.0

# Optional: better OCR accuracy (GPU-accelerated, heavier)
# easyocr>=1.7.0
```

Run inside the venv:
```bash
cd ml_engine
venv/bin/pip install pytesseract Pillow PyMuPDF python-docx openpyxl
```

### 2.3 Docker Update

**File:** `ml_engine/Dockerfile`

Add before the `RUN pip install` layer:
```dockerfile
RUN apt-get update && apt-get install -y \
    tesseract-ocr \
    tesseract-ocr-eng \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
  && rm -rf /var/lib/apt/lists/*
```

---

## 3. Phase 1 — ML Engine: File Scanner Module

**New file:** `ml_engine/analyzer/file_scanner.py`

### 3.1 Responsibilities

- Accept a raw file payload (bytes) and a MIME type / filename.
- Route to the appropriate extractor based on MIME type.
- Return the extracted plain text as a single string.
- Handle errors gracefully (corrupted file, password-protected PDF, etc.) — never crash the server.

### 3.2 Supported Formats & Extractors

| Format | MIME Types | Library | Method |
|--------|-----------|---------|--------|
| PDF | `application/pdf` | `PyMuPDF` (fitz) | `fitz.open()` → iterate pages → `page.get_text()` |
| Word (.docx) | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | `python-docx` | `Document(BytesIO(data))` → iterate paragraphs + tables |
| Excel (.xlsx) | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | `openpyxl` | `load_workbook(BytesIO(data))` → iterate sheets → cells |
| CSV | `text/csv` | stdlib `csv` | Read rows, join cell values |
| Plain text / code | `text/plain`, `text/javascript`, `text/x-python`, etc. | stdlib | Decode as UTF-8 with error fallback |
| JSON | `application/json` | stdlib `json` | `json.dumps()` with indent for readability |
| Images embedded in files | detected during extraction | recurse to `image_scanner` | Extract image bytes → OCR |

### 3.3 Implementation Spec

```python
# ml_engine/analyzer/file_scanner.py

@dataclass
class FileExtractResult:
    text: str                  # full extracted plain text
    page_count: int            # pages / sheets / 0 for flat files
    embedded_images: int       # count of images found inside (PDFs etc.)
    extraction_error: str      # non-empty if extraction partially failed

def extract_text(file_bytes: bytes, mime_type: str, filename: str = "") -> FileExtractResult:
    """
    Top-level dispatcher. Routes to the right extractor.
    Always returns a FileExtractResult — never raises.
    """

def _extract_pdf(data: bytes) -> FileExtractResult: ...
def _extract_docx(data: bytes) -> FileExtractResult: ...
def _extract_xlsx(data: bytes) -> FileExtractResult: ...
def _extract_csv(data: bytes) -> FileExtractResult: ...
def _extract_text(data: bytes) -> FileExtractResult: ...
```

### 3.4 Size & Safety Limits

- **Max file size:** Reject anything over **10 MB** at this layer (return `extraction_error`, do not process).
- **Max extracted text:** Truncate at **500,000 characters** before passing to `scan_text()` to prevent memory spikes.
- **Timeout:** Wrap extraction in a `concurrent.futures.ThreadPoolExecutor` call with a 15-second timeout. If it times out, return an error result so the endpoint still responds.

---

## 4. Phase 2 — ML Engine: Image Scanner Module

**New file:** `ml_engine/analyzer/image_scanner.py`

### 4.1 Responsibilities

- Accept raw image bytes (JPEG, PNG, WEBP, GIF, BMP) or a base64-encoded string.
- Run OCR to extract visible text.
- Return extracted text for downstream scanning.
- Optionally generate a semantic description (caption) for non-text images (diagrams, screenshots of UIs).

### 4.2 OCR Pipeline

```
raw bytes / base64
        │
        ▼
Pillow — Image.open() → convert to RGB
        │
        ▼
Preprocessing (optional, improves OCR accuracy):
  - Resize if too small (min 300 DPI equivalent)
  - Convert to greyscale
  - Apply threshold (binarize)
        │
        ▼
pytesseract.image_to_string(image, lang='eng')
        │
        ▼
extracted_text (may be empty for logos/photos with no text)
```

### 4.3 Implementation Spec

```python
# ml_engine/analyzer/image_scanner.py

@dataclass
class ImageScanResult:
    extracted_text: str        # OCR output (empty string if no text found)
    ocr_confidence: float      # 0.0–1.0, from pytesseract confidence data
    image_format: str          # "JPEG", "PNG", etc.
    width: int
    height: int
    extraction_error: str      # non-empty if OCR failed

def extract_text_from_image(image_bytes: bytes) -> ImageScanResult:
    """
    Main entry point. Accepts raw bytes.
    Always returns ImageScanResult — never raises.
    """

def extract_text_from_base64(b64_string: str) -> ImageScanResult:
    """
    Convenience wrapper for the HTTP endpoint which receives base64 JSON.
    Decodes → calls extract_text_from_image.
    """
```

### 4.4 Confidence Threshold

- If `ocr_confidence < 0.3` AND `len(extracted_text) < 20 chars`, treat as a **non-text image** (photo, diagram, logo). Return `decision: allow` with `reason: "Image contains no readable text"`.
- Do **not** block non-text images unless there is a future VLM integration for content classification.

### 4.5 Size & Safety Limits

- **Max image size:** Reject images over **5 MB** before attempting OCR.
- **Max dimensions:** Downscale images larger than 4096x4096 before OCR to cap memory.
- **Supported formats:** JPEG, PNG, WEBP, GIF (first frame), BMP. Reject SVG and TIFF at the route level.

---

## 5. Phase 3 — ML Engine: New HTTP Endpoints

**Modified file:** `ml_engine/analyzer/embed.py`

### 5.1 New Route: `POST /scan-image`

**Request:** `Content-Type: application/json`
```json
{
  "image_b64": "<base64 encoded image bytes>",
  "filename": "screenshot.png",
  "mime_type": "image/png"
}
```

**Handler logic:**
1. Decode base64 → raw bytes.
2. Validate size (≤ 5 MB) and MIME type. Return `400` on violation.
3. Call `image_scanner.extract_text_from_base64(image_b64)`.
4. If `extraction_error` is set → return `{ decision: "allow", reason: "image_unreadable" }` (fail-open for unreadable images).
5. If `extracted_text` is empty → return `{ decision: "allow", reason: "no_text_in_image" }`.
6. Call existing `_scan_fn(extracted_text)` (the same `scan_text` method used by `/scan`).
7. Enrich the verdict with `source: "image_ocr"` and `filename`.
8. Return verdict JSON.

**Response shape:**
```json
{
  "decision": "redact",
  "risk": 60,
  "reason": "PII: EMAIL_ADDRESS",
  "categories": ["pii"],
  "pii": ["EMAIL_ADDRESS"],
  "secrets": [],
  "masked_text": "My email is <EMAIL_ADDRESS>",
  "source": "image_ocr",
  "filename": "screenshot.png"
}
```

### 5.2 New Route: `POST /scan-file`

**Request:** `Content-Type: application/json` with base64:
```json
{
  "file_b64": "<base64 encoded file bytes>",
  "filename": "report.pdf",
  "mime_type": "application/pdf"
}
```

**Handler logic:**
1. Parse file bytes from base64.
2. Validate size (≤ 10 MB). Return `413` on violation.
3. Call `file_scanner.extract_text(file_bytes, mime_type, filename)`.
4. If `extraction_error` set and text is empty → return `{ decision: "allow", reason: "file_unreadable" }`.
5. Call `_scan_fn(extracted_text)`.
6. Enrich verdict with `source: "file_extract"`, `filename`, `page_count`.
7. Return verdict JSON.

### 5.3 Update `/health` Response

Add capabilities field to the health check response:
```json
{
  "ok": true,
  "capabilities": {
    "text_scan": true,
    "image_scan": true,
    "file_scan": true
  }
}
```

---

## 6. Phase 4 — Browser Extension: DOM Attachment Detection

**Modified file:** `browser-extension/src/content/content.js`

### 6.1 Add Attachment Selectors to ADAPTERS

```javascript
const ADAPTERS = {
  chatgpt: {
    // ... existing selectors ...
    fileInput: ['input[type="file"]'],
    attachmentPreviews: [
      'div[data-testid*="attachment"]',
      'div[class*="attachment"]',
      'div[class*="file-preview"]',
    ],
  },
  claude: {
    fileInput: ['input[type="file"]'],
    attachmentPreviews: ['div[class*="attachment"]', '[data-testid*="file"]'],
  },
  gemini: {
    fileInput: ['input[type="file"]'],
    attachmentPreviews: ['div[class*="attachment"]', 'div[class*="file-chip"]'],
  },
};
```

### 6.2 Add `detectAttachments()` Function

```javascript
async function detectAttachments() {
  const attachments = [];
  for (const sel of (adapter.fileInput || [])) {
    const inputs = document.querySelectorAll(sel);
    for (const input of inputs) {
      if (input.files && input.files.length > 0) {
        for (const file of input.files) {
          attachments.push(file);
        }
      }
    }
  }
  return attachments; // Array of File objects
}
```

### 6.3 Add `fileToBase64()` with Size Gate

```javascript
function fileToBase64(file, maxMB = 10) {
  return new Promise((resolve, reject) => {
    if (file.size > maxMB * 1024 * 1024) {
      reject(new Error(
        `File too large: ${file.name} (${(file.size / 1e6).toFixed(1)} MB). Max is ${maxMB} MB.`
      ));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const b64 = reader.result.split(',')[1]; // strip "data:mime;base64," prefix
      resolve(b64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
```

### 6.4 Add `scanImage()` and `scanFile()` in content.js

```javascript
function scanImage(b64, filename, mimeType) {
  return new Promise((resolve) => {
    api.runtime.sendMessage(
      { type: 'DLP_SCAN_IMAGE', image_b64: b64, filename, mime_type: mimeType },
      (resp) => {
        if (api.runtime.lastError || !resp) {
          resolve(globalThis.LocalDLP.localScanImage(filename));
          return;
        }
        resolve(resp);
      }
    );
  });
}

function scanFile(b64, filename, mimeType) {
  return new Promise((resolve) => {
    api.runtime.sendMessage(
      { type: 'DLP_SCAN_FILE', file_b64: b64, filename, mime_type: mimeType },
      (resp) => {
        if (api.runtime.lastError || !resp) {
          resolve(globalThis.LocalDLP.localScanFile(filename, mimeType));
          return;
        }
        resolve(resp);
      }
    );
  });
}
```

### 6.5 Update `handleSendAttempt()` — Aggregate All Verdicts

```javascript
async function handleSendAttempt(e) {
  if (bypass) return;
  if (!config.enabled || !config.sites[adapter.key]) return;
  if (busy) { e.preventDefault(); e.stopImmediatePropagation(); return; }

  const composer = getComposer();
  const text = getText(composer).trim();
  const attachments = await detectAttachments();

  if (!text && attachments.length === 0) return; // nothing to scan

  e.preventDefault();
  e.stopImmediatePropagation();
  busy = true;

  try {
    const scanPromises = [];

    if (text) scanPromises.push(scan(text));

    for (const file of attachments) {
      try {
        const b64 = await fileToBase64(file, config.maxScanFileSizeMB || 10);
        scanPromises.push(
          file.type.startsWith('image/')
            ? scanImage(b64, file.name, file.type)
            : scanFile(b64, file.name, file.type)
        );
      } catch (sizeErr) {
        scanPromises.push(Promise.resolve({
          decision: 'block', risk: 80,
          reason: sizeErr.message,
          categories: ['file_too_large'],
          pii: [], secrets: [], masked_text: '', source: 'local',
        }));
      }
    }

    const verdicts = await Promise.all(scanPromises);

    // Rank: block=3, warn=2.5, redact=2, allow=1
    const rank = { block: 3, warn: 2.5, redact: 2, allow: 1 };
    const worst = verdicts.reduce((acc, v) =>
      (rank[v.decision] || 0) > (rank[acc.decision] || 0) ? v : acc
    );

    if (worst.decision === 'allow') {
      await doSend(null);
      return;
    }

    // Existing modal logic handles block, warn, redact
    const choice = await showModal(worst, config.mode);
    if (choice === 'redact' && worst.decision === 'redact') {
      report(worst, 'redacted');
      await doSend(worst.masked_text);
    } else {
      report(worst, worst.decision === 'block' ? 'blocked' : 'cancelled');
    }

  } finally {
    busy = false;
  }
}
```

### 6.6 Handle Image Paste from Clipboard

Extend the existing paste listener to also catch pasted images:

```javascript
document.addEventListener('paste', (e) => {
  // ... existing text paste handling ...

  // Also check for image items in clipboard
  if (!config.scanImages) return;
  const items = e.clipboardData?.items || [];
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      e.stopImmediatePropagation();
      busy = true;
      const blob = item.getAsFile();
      fileToBase64(blob, config.maxScanFileSizeMB || 10)
        .then(b64 => scanImage(b64, 'pasted-image', item.type))
        .then(async (verdict) => {
          try {
            if (verdict.decision === 'allow') {
              // Re-insert the image into clipboard (no easy way; just allow the paste)
              // Best we can do: do nothing (allow default paste behavior)
              return;
            }
            const choice = await showModal(verdict, config.mode);
            if (choice !== 'send') {
              report(verdict, verdict.decision === 'block' ? 'blocked' : 'cancelled');
            }
          } finally { busy = false; }
        })
        .catch(() => { busy = false; });
      break;
    }
  }
}, true);
```

---

## 7. Phase 5 — Browser Extension: Background Script Routing

**Modified file:** `browser-extension/src/background.js`

### 7.1 Add `scanImage()` Async Function

```javascript
async function scanImage(b64, filename, mimeType, cfg) {
  const ctrl = new AbortController();
  // Images take longer to process — use 4x the normal text timeout
  const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs * 4);
  try {
    const url = cfg.engineUrl.replace(/\/scan$/, '/scan-image');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_b64: b64, filename, mime_type: mimeType }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error('engine HTTP ' + res.status);
    const verdict = await res.json();
    verdict.source = 'image_ocr';
    return verdict;
  } finally {
    clearTimeout(timer);
  }
}
```

### 7.2 Add `scanFile()` Async Function

```javascript
async function scanFile(b64, filename, mimeType, cfg) {
  const ctrl = new AbortController();
  // Files can be large — use 6x the normal text timeout
  const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs * 6);
  try {
    const url = cfg.engineUrl.replace(/\/scan$/, '/scan-file');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_b64: b64, filename, mime_type: mimeType }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error('engine HTTP ' + res.status);
    const verdict = await res.json();
    verdict.source = 'file_extract';
    return verdict;
  } finally {
    clearTimeout(timer);
  }
}
```

### 7.3 Add Message Handlers to `onMessage` Listener

```javascript
// Inside the existing api.runtime.onMessage.addListener callback:

if (msg && msg.type === 'DLP_SCAN_IMAGE') {
  globalThis.dlpGetConfig().then(cfg =>
    scanImage(msg.image_b64, msg.filename, msg.mime_type, cfg)
      .catch(() => ({
        decision: 'warn', risk: 50,
        reason: 'Image cannot be scanned — engine unreachable.',
        categories: ['unverified'], pii: [], secrets: [],
        masked_text: '', source: 'local', degraded: true,
      }))
  ).then(sendResponse);
  return true;
}

if (msg && msg.type === 'DLP_SCAN_FILE') {
  globalThis.dlpGetConfig().then(cfg =>
    scanFile(msg.file_b64, msg.filename, msg.mime_type, cfg)
      .catch(() => ({
        decision: 'warn', risk: 50,
        reason: 'File cannot be scanned — engine unreachable.',
        categories: ['unverified'], pii: [], secrets: [],
        masked_text: '', source: 'local', degraded: true,
      }))
  ).then(sendResponse);
  return true;
}
```

### 7.4 Update `bumpStats()` for New Action Types

```javascript
async function bumpStats(event) {
  const { dlpStats } = await api.storage.local.get('dlpStats');
  const stats = dlpStats || { blocked: 0, redacted: 0, overridden: 0, recent: [] };
  const a = event.action;
  if (['blocked', 'cancelled', 'file_blocked', 'image_blocked'].includes(a)) stats.blocked += 1;
  else if (['redacted', 'auto_redacted'].includes(a)) stats.redacted += 1;
  else if (a === 'sent_anyway') stats.overridden += 1;
  stats.recent.unshift({
    site: event.site, action: a, decision: event.decision,
    reason: event.reason, source: event.source, at: Date.now(),
  });
  stats.recent = stats.recent.slice(0, 20);
  await api.storage.local.set({ dlpStats: stats });
}
```

---

## 8. Phase 6 — Browser Extension: Offline Fallback Handling

### 8.1 Offline Behavior Matrix

| `strict` Setting | Engine Status | Attachment | Result |
|-----------------|-------------|-----------|--------|
| `false` | Online | Any | Scan normally |
| `false` | Offline | Any | Warn modal — cannot scan offline; let user decide |
| `true` | Offline | Any | Block send — cannot verify = do not allow |
| `false` | Online | File > 10 MB | Block — too large to scan |
| `true` | Online | File > 10 MB | Block — too large to scan |

### 8.2 Strict Mode Override in `handleSendAttempt()`

After aggregating all verdicts and getting `worst`:

```javascript
// If engine was offline (degraded) and strict mode is on, escalate warn → block
if (config.strict && worst.degraded && worst.decision === 'warn') {
  worst.decision = 'block';
  worst.reason = 'Engine offline — strict policy blocks unverified attachments.';
  worst.risk = 85;
}
```

---

## 9. Phase 7 — Browser Extension: Local Detector Stub

**Modified file:** `browser-extension/src/lib/detectors.js`

Add to the `globalThis.LocalDLP` object:

```javascript
localScanImage: function(filename) {
  return {
    decision: 'warn',
    risk: 45,
    reason: 'Image scanning requires a live engine connection. Contents unverified.',
    categories: ['unverified'],
    pii: [], secrets: [], masked_text: '',
    source: 'local',
    degraded: true,
    filename: filename || 'unknown',
  };
},

localScanFile: function(filename, mimeType) {
  return {
    decision: 'warn',
    risk: 45,
    reason: 'File scanning requires a live engine connection. Contents unverified.',
    categories: ['unverified'],
    pii: [], secrets: [], masked_text: '',
    source: 'local',
    degraded: true,
    filename: filename || 'unknown',
  };
},
```

---

## 10. Phase 8 — UI: Modal & Popup Updates

### 10.1 New Modal Scenarios

**Scenario: Attachment Unverified (offline + degraded)**
- Title: `⚠️ Attachment could not be scanned`
- Body: `The firewall engine is offline. Your attached file/image could not be checked for sensitive content.`
- Chips: Show `UNVERIFIED` chip in a new `unverified` style (grey/amber)
- Buttons: `Cancel (safe)` | `Send anyway (risky)`

**Scenario: File Too Large**
- Title: `🚫 Attachment too large to scan`
- Body: `Your file exceeds the 10 MB scan limit and cannot be verified safe.`
- Buttons: `Remove attachment` (single button, no send option)

### 10.2 Add New Chip Style to Modal CSS

In the shadow DOM style block inside `showModal()`:

```css
.chip.unverified { background:#1a1a1a; border-color:#4a4a4a; color:#9aa3b2; }
.chip.file { background:#0e1a2a; border-color:#1a3a5a; color:#60a5fa; }
```

### 10.3 Extend Chip Rendering in `showModal()`

```javascript
const tags = []
  .concat((verdict.pii || []).map(p => ['PII', p]))
  .concat((verdict.secrets || []).map(s => ['SECRET', s]))
  .concat((verdict.categories || [])
    .filter(c => ['injection', 'toxicity', 'code_leak'].includes(c))
    .map(c => ['THREAT', c]))
  .concat((verdict.categories || [])
    .filter(c => c === 'unverified' || c === 'file_too_large')
    .map(c => ['UNVERIFIED', c]))
  .concat(verdict.filename ? [['FILE', verdict.filename]] : []);
```

### 10.4 Options Page — New Attachment Scanning Section

Add to `src/options/` page:

```html
<div class="section">
  <h3>Attachment Scanning</h3>
  <label>
    <input type="checkbox" id="scanImages" />
    Scan attached images (OCR text extraction)
  </label>
  <label>
    <input type="checkbox" id="scanFiles" />
    Scan attached files (PDF, DOCX, XLSX, CSV, TXT)
  </label>
  <label>
    <input type="checkbox" id="attachmentStrictOffline" />
    Block send when attachments cannot be scanned offline
  </label>
  <label>
    Max file size to scan:
    <input type="number" id="maxScanFileSizeMB" min="1" max="50" /> MB
  </label>
</div>
```

### 10.5 Update `DLP_DEFAULTS` in `config.js`

```javascript
globalThis.DLP_DEFAULTS = {
  // ... existing keys ...
  scanImages: true,
  scanFiles: true,
  attachmentStrictOffline: true,
  maxScanFileSizeMB: 10,
};
```

### 10.6 Popup — Recent Activity Source Display

Update the event row rendering to show the scan source:

```javascript
// In popup.js renderStats()
const src = e.source ? ` · ${e.source.replace('_', ' ')}` : '';
return `<div class="ev">
  <span class="dot ${dot}"></span>
  <span class="site">${e.site || '?'}</span>
  <span class="rsn" title="${rsn}">${label}${src} · ${REL(e.at)}</span>
</div>`;
```

---

## 11. Phase 9 — Testing Strategy

### 11.1 ML Engine Unit Tests

**New file:** `ml_engine/tests/test_file_scanner.py`

| Test | Fixture | Assert |
|------|---------|--------|
| `test_pdf_extracts_pii` | PDF with known email address | `decision == "redact"`, `pii == ["EMAIL_ADDRESS"]` |
| `test_pdf_too_large_rejected` | 11 MB bytes object | `extraction_error` non-empty, no crash |
| `test_docx_extracts_secrets` | DOCX with AWS key pattern | `decision == "redact"`, `secrets == ["AWS_ACCESS_KEY"]` |
| `test_xlsx_extracts_pii` | XLSX with SSNs in cells | `pii == ["US_SSN"]` |
| `test_csv_extracts_email` | CSV with email column | `pii == ["EMAIL_ADDRESS"]` |
| `test_corrupted_file_safe` | Random bytes passed as PDF | Returns `FileExtractResult` with `extraction_error`, does not raise |
| `test_clean_file_allows` | PDF with no sensitive data | `decision == "allow"` |

**New file:** `ml_engine/tests/test_image_scanner.py`

| Test | Fixture | Assert |
|------|---------|--------|
| `test_image_with_email_detected` | PIL-generated PNG with email text | `decision == "redact"`, `pii == ["EMAIL_ADDRESS"]` |
| `test_blank_image_returns_allow` | White 100x100 PNG | `decision == "allow"`, reason contains `no_text_in_image` |
| `test_oversized_image_rejected` | 6 MB bytes | `extraction_error` non-empty |
| `test_base64_round_trip` | Encode/decode test PNG | Returns identical result as bytes path |
| `test_image_with_aws_key` | PNG with AKIA... key visible | `decision == "redact"`, `secrets == ["AWS_ACCESS_KEY"]` |

**New file:** `ml_engine/tests/test_embed_file_routes.py`

| Test | Request | Expected |
|------|---------|----------|
| `test_scan_image_endpoint_200` | Valid base64 PNG | 200 + verdict JSON |
| `test_scan_file_endpoint_200` | Valid base64 PDF | 200 + verdict JSON |
| `test_scan_image_too_large_400` | 6 MB base64 image | 400 or 413 |
| `test_scan_file_too_large_413` | 11 MB base64 file | 413 |
| `test_scan_image_invalid_mime_400` | mime_type `application/exe` | 400 |
| `test_health_shows_capabilities` | GET /health | `capabilities.image_scan == true` |

### 11.2 Browser Extension Jest Tests

**New file:** `browser-extension/tests/file-scanning.test.js`

```javascript
describe('fileToBase64', () => {
  test('rejects files over maxScanFileSizeMB', async () => { ... });
  test('converts valid File to base64 string without data prefix', async () => { ... });
  test('handles FileReader error gracefully', async () => { ... });
});

describe('detectAttachments', () => {
  test('reads files from input[type=file]', () => { ... });
  test('returns empty array when no inputs found', () => { ... });
  test('returns empty array when inputs have no files', () => { ... });
});

describe('verdict aggregation', () => {
  test('picks block over warn over redact over allow', () => { ... });
  test('picks warn over redact', () => { ... });
  test('picks highest risk when decisions are equal', () => { ... });
  test('returns allow when all verdicts are allow', () => { ... });
});

describe('localScanImage fallback', () => {
  test('returns decision=warn with degraded=true', () => { ... });
});

describe('localScanFile fallback', () => {
  test('returns decision=warn with degraded=true', () => { ... });
});
```

### 11.3 Manual E2E Test Checklist

| # | Test | Steps | Expected Result |
|---|------|-------|----------------|
| 1 | PDF with SSN | Attach PDF to ChatGPT → Send | Block modal, `PII: US_SSN`, source: `file_extract` |
| 2 | PNG screenshot of AWS key | Attach to Claude → Send | Block modal, `SECRET: AWS_ACCESS_KEY`, source: `image_ocr` |
| 3 | Clean DOCX | Attach to Gemini → Send | Sends normally, no modal |
| 4 | 12 MB PDF | Attach to ChatGPT → Send | Block modal: "file too large" |
| 5 | Engine offline, file attached, strict=false | Kill engine → attach file → Send | Warn modal: "cannot scan offline" |
| 6 | Engine offline, file attached, strict=true | Kill engine → attach file → Send | Block modal: "engine offline, strict policy" |
| 7 | Paste image from clipboard | Copy screenshot → Ctrl+V in ChatGPT | Image scanned via OCR before landing |
| 8 | Excel with emails in cells | Attach .xlsx → Send | Block/redact modal with `EMAIL_ADDRESS` |
| 9 | Image with no text (logo) | Attach logo PNG → Send | Sends normally |
| 10 | CSV with credit card numbers | Attach .csv → Send | Block modal, `CREDIT_CARD` |

---

## 12. Phase 10 — Deployment & Configuration Checklist

### 12.1 ML Engine Deployment

- [ ] Update `ml_engine/Dockerfile` to install Tesseract at OS layer
- [ ] Add new requirements to `ml_engine/requirements.txt`
- [ ] Run `venv/bin/pip install -r requirements.txt` in the venv
- [ ] Create `ml_engine/analyzer/file_scanner.py`
- [ ] Create `ml_engine/analyzer/image_scanner.py`
- [ ] Update `ml_engine/analyzer/embed.py` with `/scan-image` and `/scan-file` routes
- [ ] Restart ML engine: `python -m analyzer.server`
- [ ] Verify `/health` returns `"image_scan": true, "file_scan": true`
- [ ] Smoke test `/scan-image` with curl:
  ```bash
  curl -X POST http://localhost:8001/scan-image \
    -H "Content-Type: application/json" \
    -d '{"image_b64":"<b64>","filename":"test.png","mime_type":"image/png"}'
  ```
- [ ] Smoke test `/scan-file` with a PDF
- [ ] Run ML engine test suite: `pytest ml_engine/tests/ -v`

### 12.2 Browser Extension Deployment

- [ ] Update `src/lib/detectors.js` with `localScanImage` and `localScanFile` stubs
- [ ] Update `src/content/content.js` with `detectAttachments`, `fileToBase64`, `scanImage`, `scanFile`, updated `handleSendAttempt`, and clipboard paste handler
- [ ] Update `src/background.js` with `scanImage`, `scanFile` functions and new message handlers
- [ ] Update `src/options/` React component with Attachment Scanning section
- [ ] Update `src/popup/` React component to show scan source in activity feed
- [ ] Update `config.js` `DLP_DEFAULTS` with new attachment config keys
- [ ] Run Jest: `npm test`
- [ ] Run build: `npm run build`
- [ ] Reload extension in `chrome://extensions/`
- [ ] Run manual E2E checklist above

### 12.3 Environment Variables Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_SCAN_IMAGE_MB` | `5` | Reject images over this size at `/scan-image` |
| `MAX_SCAN_FILE_MB` | `10` | Reject files over this size at `/scan-file` |
| `OCR_LANG` | `eng` | Tesseract language string, e.g. `eng+fra` for multilingual |
| `OCR_MIN_CONFIDENCE` | `0.3` | Minimum OCR confidence to treat image as containing text |
| `FILE_EXTRACT_TIMEOUT_SEC` | `15` | Max seconds to spend extracting text from a file |
| `CODE_LEAK_BLOCK` | `false` | Already exists — also applies to code found in extracted file text |

---

## 13. Data Flow Diagram

```
User clicks Send (with text + file attachment)
│
├── content.js: getText(composer) → "hello my ssn is 123-45-6789"
│
├── content.js: detectAttachments() → [File("report.pdf", 2.3MB)]
│
├── content.js: fileToBase64(file) → "JVBERi0x..."
│
├── Promise.all([
│     background.js: DLP_SCAN("hello my ssn is...")
│     │   └── embed.py /scan → scan_text() → {decision:"redact", pii:["US_SSN"]}
│     │
│     background.js: DLP_SCAN_FILE("JVBERi0x...", "report.pdf", "application/pdf")
│         └── embed.py /scan-file
│               └── file_scanner.extract_text(bytes) → "...AWS_ACCESS_KEY=AKIA..."
│               └── scan_text(extracted) → {decision:"redact", secrets:["AWS_ACCESS_KEY"]}
│   ])
│
├── verdicts = [{decision:"redact",pii:["US_SSN"]}, {decision:"redact",secrets:["AWS_ACCESS_KEY"]}]
│
├── worst = {decision:"redact", secrets:["AWS_ACCESS_KEY"], risk:60}  ← higher risk wins
│
└── showModal(worst, config.mode) → user clicks "Redact & send"
      └── doSend(worst.masked_text) → send proceeds with masked content
```

---

## 14. Verdict Shape Contract

All three endpoints `/scan`, `/scan-image`, `/scan-file` **must return this identical shape**.

```typescript
interface DLPVerdict {
  // Core fields — always present
  decision:   "allow" | "redact" | "block" | "warn";
  risk:        number;       // 0–100
  reason:      string;       // human-readable summary
  categories:  string[];     // ["pii", "secret", "injection", "toxicity",
                             //  "code_leak", "unverified", "file_too_large",
                             //  "image_unreadable", "unsupported_file_type"]
  pii:         string[];     // e.g. ["EMAIL_ADDRESS", "US_SSN"]
  secrets:     string[];     // e.g. ["AWS_ACCESS_KEY", "GITHUB_TOKEN"]
  masked_text: string;       // redacted version; empty string for block/warn

  // Source tracking
  source: "engine" | "local" | "image_ocr" | "file_extract" | "error";

  // Optional enrichment
  degraded?:    boolean;     // true when engine was offline, local fallback used
  filename?:    string;      // set for file/image verdicts
  page_count?:  number;      // set for multi-page file verdicts (PDF, DOCX)
}
```

> **RULE:** `masked_text` is empty string (`""`) for `block` and `warn` decisions — there is nothing to redact and re-send; the user must remove the attachment or cancel. Only `redact` decisions produce a meaningful `masked_text`.

---

*Document version: 1.0 | Last updated: June 2026 | TITAN LLM Firewall*
