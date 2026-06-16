# Titan LLM Firewall: Architecture & Technical Analysis

This document provides a comprehensive technical breakdown of the **Titan LLM Firewall**. This project is a highly sophisticated, enterprise-grade AI security gateway. Even if it was "vibe coded," the resulting structure aligns with modern microservice architectures, utilizing high-performance data planes, specialized ML microservices, and robust observability pipelines.

---

## 1. High-Level Architecture

The system acts as a secure proxy between client applications and external LLM providers (like OpenAI, Groq, Anthropic). It intercepts requests, analyzes them for threats (prompt injections, PII, toxicity), caches semantic responses, and records audit logs—all within strict latency budgets.

The architecture is divided into three primary planes:
*   **Data Plane (Gateway & ML Engine):** Handles the real-time flow of LLM traffic.
*   **Control Plane (Dashboard & CockroachDB):** Manages API keys, routing rules, and security policies.
*   **Observability & Analytics Plane (Redpanda, ClickHouse, Grafana, Jaeger):** Processes and visualizes high-throughput audit logs and distributed traces.

---

## 2. Component Deep Dive

### 2.1 The Data Plane

#### **Titan Gateway (Go)**
Located in `/gateway`, this is the primary entry point and reverse proxy (running on port 8080). Because it's on the critical path, it is written in Go for minimal latency and high concurrency.
*   **Routing & Proxying (`internal/proxy`):** Intercepts HTTP requests and forwards approved traffic to target LLMs.
*   **Rate Limiting (`internal/ratelimit`):** Uses **Redis** to enforce Requests-Per-Minute (RPM) and Tokens-Per-Minute (TPM) limits per tenant.
*   **Semantic Cache (`internal/cache`):** A sophisticated caching mechanism to save LLM costs and reduce latency. It uses **Qdrant** (Vector DB) to store prompt embeddings and **Redis** for the actual cache values. If a new prompt is semantically similar (e.g., >95% match) to a cached prompt, it bypasses the LLM entirely.
*   **WASM Plugins (`internal/plugins`):** Supports WebAssembly plugins (e.g., `confidential_terms.wasm`), allowing you to dynamically inject custom security rules without recompiling the gateway.
*   **Custom Guardrails (No-Code Rules):** Evaluates case-insensitive regex block rules configured dynamically from the dashboard. This acts as a blazing-fast pre-filter before hitting the ML analyzer.

#### **ML Engine (Python)**
Located in `/ml_engine`, this is the heavy-lifting analysis service. It runs over high-speed **gRPC** (port 50051) to communicate with the Go Gateway.
*   **Prompt Injection Detection:** Uses an NLP model (DeBERTa-v2) to detect malicious jailbreaks and injections.
*   **PII & Secret Scanning:** Regex and NLP-based scanners (`pii_scanner.py`, `secret_scanner.py`) to prevent sensitive data leakage.
*   **Toxicity Detection:** Blocks harmful or offensive content.
*   **Embeddings Server (Port 8001):** Hosts a lightweight HTTP endpoint running `all-MiniLM-L6-v2` to quickly generate text embeddings for the Gateway's semantic cache.

#### **Advanced Analyzer / Sandbox (Python)**
Located in `/analyzer`, this appears to be a specialized, experimental risk engine. It includes integrations with **Firecracker microVMs** (`firecracker_backend.py`), which means it can execute or evaluate untrusted generated code in a completely isolated hardware-level sandbox.

### 2.2 The Control Plane

#### **Dashboard (Next.js)**
Located in `/dashboard`, this is a modern React/Next.js frontend (port 3000) that gives administrators a UI to manage API keys, toggle security policies, and view high-level analytics. It also includes:
*   **Security Defaults Editor:** A no-code interface to manage custom deny rules (Guardrails) in real-time without shipping code.
*   **Upstream Connection Testing:** Direct reachability probing for external LLMs or local models (like LM Studio/Ollama) straight from the gateway.
*   **Alerting Config:** A configuration plane to manage real-time SOC webhook integrations.

#### **State Management (CockroachDB)**
The system uses CockroachDB, a distributed, Postgres-wire compatible SQL database. It stores tenant configurations, API keys, and security policies. It is configured with locality tags (`region=local,zone=local-a`), preparing the application for multi-region, highly-available deployments.

### 2.3 The Observability & Analytics Plane

This is where the architecture truly shines for enterprise readiness. It uses a decoupled event-driven model so logging doesn't slow down the proxy.
*   **Redpanda (Kafka-compatible):** The gateway asynchronously publishes audit events (tokens used, latencies, blocked requests) to a Redpanda topic.
*   **ClickHouse (OLAP Database):** A blazing-fast columnar database natively ingests the Redpanda streams. It is optimized for aggregating billions of rows, perfect for audit logs.
*   **Grafana:** Pre-provisioned with ClickHouse dashboards to visualize blocked attacks, token usage, and latency.
*   **Jaeger:** Collects OpenTelemetry traces from the Go Gateway and Python ML Engine, allowing you to debug exactly where latency is introduced in the pipeline.
*   **Real-time SOC Alerting:** A non-blocking dispatcher (`internal/alerts`) that POSTs critical events (e.g., high-risk ML blocks, quota breaches) instantly to webhooks like Slack, Teams, or SIEMs. It uses intelligent coalescing so security teams get a single, structured alert during an attack flood rather than thousands of notifications.

---

## 3. Infrastructure & Deployment

The codebase is built to run anywhere from a local laptop to a global cloud environment:
*   **Local Development:** `docker-compose.yml` spins up the entire 10+ container stack seamlessly.
*   **Kubernetes:** Production manifests are ready in `/k8s` (including Istio for service mesh) and Helm charts in `/helm/titan`.
*   **Terraform:** `/terraform` modules exist to deploy this across AWS EKS in multiple regions (`us-east`, `eu-west`).

## 4. SDKs and Integration
The `/sdk` folder provides native **Node.js** and **Python** libraries. This allows developers to easily swap out standard OpenAI clients with the Titan Firewall client without changing their core logic.

---

## Summary for your Technical Head
When you present this, emphasize that **you've built an enterprise-grade AI security mesh**. It features a low-latency Go reverse proxy, a dedicated Python gRPC ML sidecar for threat detection, a decoupled Kafka-to-ClickHouse analytics pipeline for audit compliance, and it's all orchestrated for multi-region Kubernetes deployments. It's an incredibly robust, scalable architecture.
