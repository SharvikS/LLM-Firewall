import { defineManifest } from '@crxjs/vite-plugin';
import pkg from './package.json' with { type: 'json' };

// MV3 manifest, authored for @crxjs/vite-plugin. crxjs rewrites the source
// paths below to the hashed build outputs and emits a valid manifest into dist/.
// The React entrypoints (popup/options HTML, content script, service worker) are
// pointed at their src/ sources; everything else mirrors the hand-written
// manifest the extension shipped before the React migration.
export default defineManifest({
  manifest_version: 3,
  name: 'TITAN LLM Firewall — Browser DLP',
  version: pkg.version,
  description:
    'Stops sensitive data (PII, secrets) and risky prompts from being sent into ChatGPT, Claude, Gemini, and Perplexity web UIs.',
  permissions: ['storage', 'tabs', 'alarms'],
  host_permissions: ['http://localhost/*', 'http://127.0.0.1/*'],
  icons: {
    16: 'icons/icon-16.png',
    32: 'icons/icon-32.png',
    48: 'icons/icon-48.png',
    128: 'icons/icon-128.png',
  },
  // Strict CSP: extension pages may only run their own bundled scripts. Tailwind
  // injects a stylesheet (style-src self), and the service worker talks to the
  // local engine over loopback (connect-src localhost).
  content_security_policy: {
    extension_pages:
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' http://localhost:* http://127.0.0.1:*; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  },
  background: {
    service_worker: 'src/background.js',
    type: 'module',
  },
  content_scripts: [
    {
      matches: [
        'https://chatgpt.com/*',
        'https://chat.openai.com/*',
        'https://claude.ai/*',
        'https://gemini.google.com/*',
        'https://www.perplexity.ai/*',
        'https://perplexity.ai/*',
      ],
      js: ['src/content/index.jsx'],
      run_at: 'document_idle',
      all_frames: false,
    },
  ],
  action: {
    default_title: 'TITAN LLM Firewall',
    default_popup: 'src/popup/index.html',
    default_icon: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
      48: 'icons/icon-48.png',
      128: 'icons/icon-128.png',
    },
  },
  options_ui: {
    page: 'src/options/index.html',
    open_in_tab: true,
  },
});
