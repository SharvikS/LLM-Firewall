// Local fallback detectors. Used when the firewall ML engine is unreachable so
// the extension still blocks the obvious leaks offline. This is intentionally
// lighter than the server-side Presidio + transformer pipeline — it covers
// high-confidence regex-detectable PII and credentials plus a few jailbreak
// heuristics. The verdict shape matches the engine's /scan response exactly so
// callers don't care which path produced it.

(function () {
  // type -> regex. Order matters only for nicer masking; all are applied.
  const SECRET_PATTERNS = [
    ['PRIVATE_KEY', /-----BEGIN (?:RSA |EC |OPENSSH |PGP |DSA )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA |EC |OPENSSH |PGP |DSA )?PRIVATE KEY-----/g],
    ['AWS_ACCESS_KEY', /\bAKIA[0-9A-Z]{16}\b/g],
    ['GITHUB_TOKEN', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g],
    ['OPENAI_KEY', /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g],
    ['SLACK_TOKEN', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g],
    ['JWT', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g],
    ['GENERIC_SECRET', /\b(?:api[_-]?key|secret|token|password|passwd|pwd|access[_-]?key)\b\s*[:=]\s*["']?[A-Za-z0-9._\-/+]{6,}["']?/gi],
  ];

  const PII_PATTERNS = [
    ['EMAIL_ADDRESS', /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g],
    ['US_SSN', /\b\d{3}-\d{2}-\d{4}\b/g],
    ['PHONE_NUMBER', /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g],
    ['IP_ADDRESS', /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g],
    ['CREDIT_CARD', /\b(?:\d[ -]?){13,16}\b/g],
  ];

  // Heuristic prompt-injection / jailbreak phrases — hard block (nothing to mask).
  const INJECTION_PATTERNS = [
    /\bignore (?:all |the )?(?:previous|prior|above) (?:instructions|prompts?)\b/i,
    /\bdisregard (?:all |the )?(?:previous|prior|above)\b/i,
    /\b(?:reveal|show|print|repeat) (?:your |the )?(?:system|initial) prompt\b/i,
    /\byou are (?:now )?DAN\b/i,
    /\bdeveloper mode enabled\b/i,
    /\bjailbreak\b/i,
  ];

  function luhnValid(num) {
    const digits = num.replace(/\D/g, '');
    if (digits.length < 13 || digits.length > 19) return false;
    let sum = 0, alt = false;
    for (let i = digits.length - 1; i >= 0; i--) {
      let d = parseInt(digits[i], 10);
      if (alt) { d *= 2; if (d > 9) d -= 9; }
      sum += d; alt = !alt;
    }
    return sum % 10 === 0;
  }

  function applyPatterns(text, patterns, found, validate) {
    let masked = text;
    for (const [type, re] of patterns) {
      masked = masked.replace(re, (m) => {
        if (validate && !validate(type, m)) return m;
        if (!found.includes(type)) found.push(type);
        return `<${type}>`;
      });
    }
    return masked;
  }

  function localScan(text) {
    text = text || '';
    for (const re of INJECTION_PATTERNS) {
      if (re.test(text)) {
        return {
          decision: 'block', risk: 95, reason: 'Possible prompt injection / jailbreak',
          categories: ['injection'], pii: [], secrets: [], masked_text: text, source: 'local',
        };
      }
    }

    const secrets = [];
    let masked = applyPatterns(text, SECRET_PATTERNS, secrets);
    const pii = [];
    masked = applyPatterns(masked, PII_PATTERNS, pii, (type, m) =>
      type === 'CREDIT_CARD' ? luhnValid(m) : true);

    if (secrets.length || pii.length) {
      const parts = [];
      if (pii.length) parts.push('PII: ' + pii.join(', '));
      if (secrets.length) parts.push('Secrets: ' + secrets.join(', '));
      return {
        decision: 'redact', risk: secrets.length ? 60 : 35, reason: parts.join('; '),
        categories: [...(pii.length ? ['pii'] : []), ...(secrets.length ? ['secret'] : [])],
        pii, secrets, masked_text: masked, source: 'local',
      };
    }
    return {
      decision: 'allow', risk: 0, reason: 'clean', categories: [],
      pii: [], secrets: [], masked_text: text, source: 'local',
    };
  }

  globalThis.LocalDLP = { localScan };
})();
