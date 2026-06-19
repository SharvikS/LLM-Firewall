# Fronting cloud LLM providers (ChatGPT · Claude · Gemini)

TITAN Gateway is a transparent reverse proxy. To put the firewall in front of a
cloud model you point your application's existing SDK at the gateway instead of
at the provider — the gateway authenticates upstream, inspects every prompt and
response, then forwards the call. **Your code keeps using each provider's native
API**; nothing is translated or normalised, so streaming, tool use, and vision
all keep working.

## How it works

The active provider is chosen in the dashboard (**Settings → Upstream LLM →
Provider**) or via the `upstream_provider` runtime setting. It is live-switchable
— no restart. The provider drives two things:

| Provider    | `upstream_provider` | Auth the gateway injects        | Default base URL                                    |
|-------------|---------------------|---------------------------------|-----------------------------------------------------|
| OpenAI / ChatGPT (and OpenAI-compatible: Groq, Ollama, vLLM, LM Studio) | `openai`    | `Authorization: Bearer <key>`              | `https://api.openai.com/v1`                  |
| Anthropic Claude | `anthropic`    | `x-api-key: <key>` + `anthropic-version` | `https://api.anthropic.com`                  |
| Google Gemini    | `google`       | `x-goog-api-key: <key>`                  | `https://generativelanguage.googleapis.com`  |

The gateway stores the upstream API key write-only (redacted in every API
response) and always strips stale credential headers, so a key configured for
one provider can never leak to another. For keyless local servers (Ollama, etc.)
leave the key blank.

Because the gateway never rewrites the request shape, the firewall must read each
provider's native JSON to find the prompt text. It does:

- **Request inspection** (injection / toxicity / PII / custom guardrails) reads
  OpenAI `messages[].content`, Anthropic `system` + `messages[].content` (string
  or content blocks), and Gemini `contents[].parts[].text` +
  `systemInstruction`.
- **PII masking** rewrites those same nodes in place.
- **Response output scanning** (non-streaming) masks OpenAI
  `choices[].message.content`, Anthropic top-level `content[]` text blocks, and
  Gemini `candidates[].content.parts[].text`.

## Point your app at the gateway

Assume the gateway is reachable at `https://titan.your-co.internal` and you've
created a TITAN API key for your tenant (`tk_…`). Your app authenticates to the
**gateway** with the TITAN key; the gateway holds the real provider key.

### OpenAI / ChatGPT — Python

```python
from openai import OpenAI
client = OpenAI(base_url="https://titan.your-co.internal/v1", api_key="tk_your_titan_key")
client.chat.completions.create(model="gpt-4o", messages=[{"role": "user", "content": "hi"}])
```

### Anthropic Claude — Python

```python
import anthropic
client = anthropic.Anthropic(base_url="https://titan.your-co.internal", api_key="tk_your_titan_key")
client.messages.create(model="claude-opus-4-8", max_tokens=1024,
                       messages=[{"role": "user", "content": "hi"}])
```

### Google Gemini — REST

The Gemini SDKs don't all expose a base-URL override; the REST surface is the
reliable path. Send the TITAN key as `x-goog-api-key`:

```bash
curl https://titan.your-co.internal/v1beta/models/gemini-1.5-pro:generateContent \
  -H "x-goog-api-key: tk_your_titan_key" \
  -H "Content-Type: application/json" \
  -d '{"contents":[{"parts":[{"text":"hi"}]}]}'
```

## Verifying the upstream

In **Settings → Upstream LLM** click **Test connection**. The gateway probes the
provider's model-listing endpoint (`/v1/models`, `/v1beta/models`) from inside
its own network namespace, using the provider-correct auth — the reachability
that actually matters, since the gateway (not the browser) is what calls the
model.

## Known limitation

Streaming (SSE) output masking is currently OpenAI-delta-shaped. Claude and
Gemini **streaming** responses are forwarded unmasked (request-side inspection
and non-streaming response masking are fully provider-aware). Per-provider
streaming delta masking is a planned follow-up; until then, disable streaming if
you require output masking on Claude/Gemini, or rely on request-side controls.
