# TITAN Gateway Helm Chart

Deploys the three TITAN application tiers — Go gateway, Python ML analyzer,
Next.js dashboard — into any Kubernetes cluster. Stateful infrastructure
(Redis, CockroachDB, Redpanda/Kafka, Qdrant, ClickHouse) is **not** deployed
by this chart; each region points at its endpoints via `externalServices`.

## Single-region install

```bash
helm install titan ./helm/titan \
  --set-string secrets.adminToken="$(openssl rand -hex 32)" \
  --set-string secrets.providerAPIKey="$GROQ_API_KEY"
```

## Multi-region active-active

One release per region, each with its own overlay:

```bash
# us-east cluster
helm install titan-us ./helm/titan -f ./helm/titan/regions/us-east.yaml \
  --set-string secrets.existingSecret=titan-secrets

# eu-west cluster
helm install titan-eu ./helm/titan -f ./helm/titan/regions/eu-west.yaml \
  --set-string secrets.existingSecret=titan-secrets
```

The multi-region data topology:

- **CockroachDB** is one logical cluster spanning regions; each release's
  `dbConnString` targets its regional nodes (locality-aware reads/writes).
- **Redis, Kafka, ClickHouse, Qdrant** are per-region (cache, event bus and
  OLAP data are regional by design; audit durability converges in CRDB).
- **Region tag**: every pod gets the `titan/region` label and the gateway
  exports `REGION`, which flows into audit events and Cedar's `context.region`
  for GDPR-style regional policy conditions.
- **Global entry**: front the per-region gateway Services with your global
  load balancer (Route 53 latency routing, Cloudflare, or Istio east-west
  gateway). `k8s/istio-gateway.yaml` has the Istio reference config.

## Notable values

| Key | Default | Meaning |
|---|---|---|
| `region` | `local` | Region tag on pods, audit events and Cedar context |
| `gateway.autoscaling.*` | 3–12 pods @70% CPU | HPA bounds |
| `gateway.otlpEndpoint` | `""` (off) | OTLP collector for distributed tracing |
| `externalServices.clickhouseURL` | platform svc | OLAP analytics read path |
| `secrets.existingSecret` | `""` | Use a pre-created Secret instead of chart-managed |

Render without installing: `helm template titan ./helm/titan`.
