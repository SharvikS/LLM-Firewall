# TITAN Enterprise Demo Script

Use this for a recorded buyer demo or live security-platform walkthrough.

## Setup

```bash
docker compose up -d --build
scripts/smoke.sh
scripts/redteam-eval.py
```

Open:

| Surface | URL |
|---|---|
| Dashboard | http://localhost:3000 |
| Gateway | http://localhost:8080 |
| Grafana | http://localhost:3001 |
| Jaeger | http://localhost:16686 |
| Redpanda Console | http://localhost:8082 |

Dashboard login: `admin@titan.local` / `admin@123`.

## Recording Flow

1. **Position the product**
   - "TITAN sits in front of every LLM call and turns AI usage into an auditable, enforceable security control."

2. **Show the overview**
   - Open Overview, Analytics, and Events.
   - Point out runtime decisions, latency, risk scores, and provider visibility.

3. **Run attacks**
   - Send a benign prompt through the gateway.
   - Send a prompt injection.
   - Send a PII prompt.
   - Show block/mask outcomes in Events and Audit Logs.

4. **Policy Playground**
   - Open Policy Engine.
   - Evaluate a tenant/action/context in the playground.
   - Toggle or create a policy.
   - Open version history to show immutable policy snapshots.

5. **Compliance Coverage**
   - Open Coverage.
   - Show OWASP LLM Top 10 and NIST GenAI coverage with live evidence counts.
   - Export audit/compliance reports from the Admin API if needed.

6. **SIEM Story**
   - Open Settings -> Notifications.
   - Show collector formats: generic, Splunk HEC, Datadog, Elastic.
   - Send a test alert.

7. **Browser DLP**
   - Open Browser DLP.
   - Show fleet policy baseline controls.
   - Trigger a browser DLP event with the extension if loaded.
   - Show repeat-offender flags.

8. **Production Trust**
   - Show `docs/operations/PRODUCTION_DEPLOYMENT.md`.
   - Mention SSO/OIDC, RBAC, audit, Helm, backup/restore, and red-team eval.

## Close

Buyer-facing close:

> TITAN gives platform and security teams one enforcement point for AI apps:
> prevent prompt injection, stop sensitive data leakage, control model access,
> and generate audit evidence without rewriting every application.
