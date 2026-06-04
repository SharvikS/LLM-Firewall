# INTERNAL RED TEAM REVIEW (Phase 4: Titan Implementation)

**Target Scope:** Go Gateway, Python ASR V2, Kubernetes & Istio Deployments.

## Attack Vector 1: Sandbox Escape (ASR V2)
*   **Attack:** A malicious Agent tool call attempts a container escape by mounting `/proc` or writing to cgroups if the sandbox is misconfigured.
*   **Discovery:** ASR Kubernetes pod is running as `privileged: true` to support Docker-in-Docker execution. If the ASR API process is compromised, the attacker has cluster-admin equivalence.
*   **Remediation Applied:** We must enforce User Namespaces (userns) within the inner sandbox containers and ensure the outer ASR deployment drops `CAP_SYS_ADMIN` unless explicitly required by the runtime.

## Attack Vector 2: Redpanda Event Flooding (Gateway)
*   **Attack:** An attacker spams the gateway with million requests to exhaust Redpanda connections, causing legitimate audit logs to be dropped.
*   **Discovery:** The Go Gateway publishes audit events in a `goroutine` but doesn't bound the Redpanda producer queue.
*   **Remediation Applied:** The `twmb/franz-go` client handles batching internally, but we must implement rate-limiting at the Istio Gateway level to protect the data plane.

## Attack Vector 3: Cedar Policy Bypass
*   **Attack:** Tenant ID spoofing in the HTTP header to bypass Cedar ABAC rules.
*   **Discovery:** The Go Gateway currently trusts the implicit tenant structure.
*   **Remediation Applied:** Implementation mandate: Tenant ID must be cryptographically extracted from the JWT Bearer token validated by Istio, NOT from plain HTTP headers.
