#!/bin/bash
# TITAN — browser-DLP wiring smoke test.
#
# Verifies the endpoint-side DLP path WITHOUT a browser:
#   1. engine /report        is reachable (the extension's relay target)
#   2. engine → gateway relay lands in the gateway live feed
#   3. gateway /internal/dlp-event records to the feed directly
#
# Run after `docker compose up -d` (or with the engine+gateway running locally).
# Override hosts via env: ENGINE=http://localhost:8001 GW=http://localhost:8080
set -u

ENGINE="${ENGINE:-http://localhost:8001}"
GW="${GW:-http://localhost:8080}"
TOKEN="${BROWSER_EVENT_TOKEN:-}"          # set if you configured a shared secret
PASS=0; FAIL=0

hdr=(-H 'Content-Type: application/json')
[ -n "$TOKEN" ] && hdr+=(-H "X-Titan-DLP-Token: $TOKEN")

check() { if [ "$3" = "$2" ]; then echo "✅ $1"; PASS=$((PASS+1)); else echo "❌ $1 — expected $2, got $3"; FAIL=$((FAIL+1)); fi; }

echo "── browser-DLP smoke test ───────────────────────────"

# Unique marker so we can find our event in the feed.
MARK="smoke-$(date +%s)"

# 1) Direct gateway ingest (what the engine relays to).
GW_EVENT="{\"site\":\"chatgpt\",\"decision\":\"redact\",\"action\":\"redacted\",\"risk\":60,\"reason\":\"$MARK direct gateway\",\"pii\":[\"EMAIL_ADDRESS\"]}"
code=$(curl -s -o /dev/null -w '%{http_code}' "${hdr[@]}" -X POST "$GW/internal/dlp-event" -d "$GW_EVENT")
check "gateway /internal/dlp-event accepts event" "202" "$code"

# 2) Engine /report (the extension's relay target). Engine forwards to gateway.
EN_EVENT="{\"site\":\"claude\",\"decision\":\"block\",\"action\":\"blocked\",\"risk\":95,\"reason\":\"$MARK via engine\",\"categories\":[\"injection\"]}"
code=$(curl -s -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -X POST "$ENGINE/report" -d "$EN_EVENT")
check "engine /report accepts event" "202" "$code"

# 3) Both events should land in the gateway live feed (dashboard /api/events).
# The engine→gateway relay is async and the feed fans out via Redis, so poll
# for up to ~8s rather than assuming a fixed delay.
FEED=""
for _ in $(seq 1 16); do
  FEED=$(curl -s "$GW/api/events?n=200")
  if echo "$FEED" | grep -q "$MARK direct gateway" && echo "$FEED" | grep -q "$MARK via engine"; then break; fi
  sleep 0.5
done
echo "$FEED" | grep -q "$MARK direct gateway" && check "direct event in live feed" "ok" "ok" || check "direct event in live feed" "ok" "missing"
echo "$FEED" | grep -q "$MARK via engine"     && check "relayed event in live feed" "ok" "ok" || check "relayed event in live feed" "ok" "missing"
echo "$FEED" | grep -q "BROWSER_DLP_REDACT"   && check "BROWSER_DLP_REDACT action present" "ok" "ok" || check "BROWSER_DLP_REDACT action present" "ok" "missing"

# 4) Repeat-offender flagging: fire enough violations for one subject to cross
#    the threshold (default 3 → flagged on the 4th), then assert the admin API
#    surfaces the flag. Requires the admin token.
ADMIN="${ADMIN:-titan-admin-dev-secret}"
SUBJ="smoke-user-$(date +%s)"
for i in 1 2 3 4 5; do
  curl -s -o /dev/null "${hdr[@]}" -X POST "$GW/internal/dlp-event" \
    -d "{\"site\":\"chatgpt\",\"decision\":\"block\",\"action\":\"blocked\",\"risk\":90,\"reason\":\"$MARK offender hit $i\",\"subject\":\"$SUBJ\",\"account\":\"$SUBJ@corp.test\",\"categories\":[\"secret\"]}"
done
sleep 1

FLAGS=$(curl -s -H "X-Admin-Token: $ADMIN" "$GW/admin/v1/dlp/flags?status=open")
echo "$FLAGS" | grep -q "$SUBJ" && check "repeat offender raised a flag" "ok" "ok" || check "repeat offender raised a flag" "ok" "missing"

VCOUNT=$(echo "$FLAGS" | grep -o "\"subject\":\"$SUBJ\"[^}]*\"violation_count\":[0-9]*" | grep -o '"violation_count":[0-9]*' | grep -o '[0-9]*' | head -1)
[ "${VCOUNT:-0}" -ge 4 ] && check "flag violation_count >= 4 (got ${VCOUNT:-0})" "ok" "ok" || check "flag violation_count >= 4 (got ${VCOUNT:-0})" "ok" "low"

SUMMARY=$(curl -s -H "X-Admin-Token: $ADMIN" "$GW/admin/v1/dlp/summary")
echo "$SUMMARY" | grep -qE '"open_flags":[1-9]' && check "summary reports open flags" "ok" "ok" || check "summary reports open flags" "ok" "zero"

# 5) Device + IP forensics: fire an event carrying a device fingerprint and an
#    explicit client_ip, then assert the gateway logged both.
DSUBJ="device-test-$(date +%s)"
curl -s -o /dev/null -H 'Content-Type: application/json' -H 'X-Forwarded-For: 203.0.113.77' \
  -X POST "$GW/internal/dlp-event" \
  -d "{\"site\":\"gemini\",\"decision\":\"block\",\"action\":\"blocked\",\"risk\":80,\"reason\":\"$MARK device probe\",\"subject\":\"$DSUBJ\",\"account\":\"dev@corp.test\",\"categories\":[\"secret\"],\"device\":{\"name\":\"FINANCE-LAPTOP-04\",\"os\":\"macOS\",\"browser\":\"Chrome\",\"platform\":\"MacIntel\",\"timezone\":\"America/New_York\",\"screen\":\"2560x1440@2\"}}"
sleep 1
VIOL=$(curl -s -H "X-Admin-Token: $ADMIN" "$GW/admin/v1/dlp/violations?subject=$DSUBJ")
echo "$VIOL" | grep -q '203.0.113.77' && check "client IP logged" "ok" "ok" || check "client IP logged" "ok" "missing"
echo "$VIOL" | grep -q 'FINANCE-LAPTOP-04' && check "device name logged" "ok" "ok" || check "device name logged" "ok" "missing"
echo "$VIOL" | grep -q 'America/New_York' && check "device fingerprint logged" "ok" "ok" || check "device fingerprint logged" "ok" "missing"

echo "─────────────────────────────────────────────────────"
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] && echo "✅ browser-DLP wiring OK — check the dashboard Events tab too." || echo "❌ see failures above (is the stack up? is BROWSER_EVENT_TOKEN set on both sides?)"
exit "$FAIL"
