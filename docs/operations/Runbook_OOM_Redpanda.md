# RUNBOOK: Redpanda Out of Memory (OOM) Mitigation

## 1. Description
This runbook covers the triage and mitigation process when the Titan Redpanda event bus triggers an OOM exception or falls behind on disk I/O, causing security audit logs to queue up in the Go Gateway memory.

## 2. Alerts Triggered
* `RedpandaMemoryCritical` (Memory utilization > 90%)
* `GatewayAuditQueueFull` (Go Gateway memory spiking due to backpressure)

## 3. Immediate Triage
1. **Check Redpanda Logs:**
   `kubectl logs -n llm-firewall statefulset/titan-redpanda -c redpanda`
2. **Check Gateway Backpressure:**
   `kubectl exec -it deployment/titan-gateway -n llm-firewall -- curl http://localhost:8080/metrics | grep audit_queue_size`

## 4. Mitigation Steps
### A. Temporary Disk Space Expansion (If storage bound)
If Redpanda is buffering to memory because disk I/O is saturated or full:
1. Increase the PVC size in the StatefulSet manifest.
2. Restart the Redpanda pods sequentially.

### B. Gateway Load Shedding (If CPU/Memory bound)
If the cluster cannot recover:
1. Enable `AUDIT_LOG_SAMPLING=true` on the Gateway to immediately drop 90% of non-critical audit events.
   `kubectl set env deployment/titan-gateway AUDIT_LOG_SAMPLING=true -n llm-firewall`
2. This ensures the Core Policy Engine (Cedar) continues routing LLM traffic without crashing the Gateway.

## 5. Escalation
If Redpanda goes fully offline and `AUDIT_LOG_SAMPLING` is insufficient to stabilize the Gateway, escalate to the Principal SRE.
