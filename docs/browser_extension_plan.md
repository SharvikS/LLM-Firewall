# Browser Extension Plan: AI Site Detector & Enhancer

## 1. Project Goal & Scope
The goal is to build a browser extension that serves two primary purposes:
1. **Detection & Classification**: Automatically identify when a user visits an AI-related website and classify it as either a "Genuine AI Platform" (e.g., ChatGPT, Claude, Gemini) or a "Generic/Wrapper AI Site" (e.g., a thin UI wrapper over OpenAI's API, spammy AI sites).
2. **Universal AI Support**: Provide enhanced features and support when the user is on recognized "Genuine" AI sites (e.g., unified prompt library, custom styling, data export, or quick actions).

## 2. Core Features

### A. The "Genuine vs. Generic" Detector
* **Real-time Scanning**: When a page loads, the extension analyzes the site.
* **Visual Indicator**: A badge on the extension icon (e.g., Green for Genuine, Yellow for Wrapper, Red for Spam/Fake).
* **Warning System**: Optional unobtrusive banners warning users if they are on a generic wrapper site that might be overcharging for basic API access or collecting data insecurely.
* **Community Reporting**: Allow users to report a site as "Genuine" or "Generic" to improve the database.

### B. Universal Support for Existing AI Sites
*What does it mean to "support" these sites? Here are proposed features:*
* **Universal Prompt Library**: A popup or injected sidebar containing your favorite prompts, accessible across ChatGPT, Claude, Gemini, Perplexity, etc.
* **Unified Export**: Standardized way to export conversation histories from any supported genuine site to Markdown, PDF, or JSON.
* **Quick Context Switching**: Easily copy a conversation from one AI (e.g., ChatGPT) and open it in another (e.g., Claude) to compare answers.

## 3. How Detection Will Work (The Engine)

Detecting a "generic" vs. "genuine" site requires a multi-layered approach:

1. **Curated Whitelist/Blacklist (The Baseline)**: 
   * Maintain a hardcoded, frequently updated list of verified genuine platforms (chatgpt.com, claude.ai, gemini.google.com, perplexity.ai).
   * Maintain a blacklist of known spam/scam AI sites.
2. **Heuristics & DOM Analysis (The Smart Part)**:
   * **Wrapper Footprints**: Look for common UI libraries or templates often used by "get-rich-quick" AI wrappers.
   * **Network Traffic**: Monitor outgoing requests. Does the site make direct calls to OpenAI/Anthropic APIs with exposed client-side keys? (A huge red flag for poorly built wrappers).
3. **Backend API/LLM Classification (Optional but Powerful)**:
   * Send the URL and meta tags to a backend server. The server can use a lightweight LLM or database to evaluate the site's legitimacy and return a score to the extension.

## 4. Extension Architecture (Manifest V3)

* **Background Service Worker (`background.js`)**: Handles URL changes, manages the whitelist/blacklist database (fetched remotely), and controls the extension badge logic.
* **Content Scripts (`content.js`)**: 
  * Injected into *all* pages to run the DOM heuristics for detection.
  * Injected specifically into *genuine* AI pages to add the "Universal Support" UI (like the prompt library or export buttons).
* **Popup UI (`popup.html` & `popup.js`)**: The dashboard when you click the extension icon. Shows the current site's status (Genuine/Generic), allows manual reporting, and holds extension settings.
* **Storage API**: Saves user preferences, custom prompts, and local caching of the site classification database.

## 5. Proposed Development Phases

### Phase 1: Foundation & Basic Detection
* Setup Manifest V3 boilerplate.
* Implement the Background Service Worker to detect URL changes.
* Build the static Whitelist/Blacklist and update the extension badge icon based on the current URL.
* Create a simple Popup UI to show "Genuine AI Site", "Generic Wrapper", or "Not AI".

### Phase 2: Advanced Heuristics
* Develop Content Scripts to analyze page content and meta tags for unknown AI sites.
* Implement the scoring system to classify unknown sites as Generic or Genuine based on DOM patterns.

### Phase 3: Universal AI Support Features
* Build the "Universal Prompt Library" UI.
* Inject this UI into the supported genuine AI sites via Content Scripts.
* Implement unified export features for the top 3 sites (ChatGPT, Claude, Gemini).

### Phase 4: Polish & Deployment
* Add user reporting mechanisms.
* Setup a backend server (optional) to handle community reports and update the global whitelist/blacklist dynamically.
* Prepare for Chrome Web Store / Firefox Add-on Store submission.

---
**Next Steps**: 
Please review this plan. We can adjust what "support" means to you, or tweak how aggressive the detection engine should be. Once you approve, we can begin setting up Phase 1!
