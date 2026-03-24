#!/usr/bin/env bash
# Verify WhatsApp relay deployment and token configuration.
#
# Usage:
#   ./scripts/verify_whatsapp.sh
#
# Reads from (in priority order):
#   1. Environment variables
#   2. Project .env file
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── Load tokens ─────────────────────────────────────────────
load_env() {
  local file="$1"
  if [[ -f "$file" ]]; then
    set -a
    # shellcheck source=/dev/null
    source "$file"
    set +a
  fi
}

load_env "$PROJECT_DIR/.env"

# Helper: extract JSON field
jq_field() {
  python3 -c "import sys,json; print(json.load(sys.stdin).get('$1',''))" 2>/dev/null
}

PASS=0
FAIL=0
WARN=0

check() {
  local label="$1" result="$2"
  if [[ "$result" == "ok" ]]; then
    echo "[PASS] $label"
    PASS=$((PASS + 1))
  elif [[ "$result" == "warn" ]]; then
    echo "[WARN] $label"
    WARN=$((WARN + 1))
  else
    echo "[FAIL] $label — $result"
    FAIL=$((FAIL + 1))
  fi
}

echo "========================================"
echo "  WHATSAPP VERIFICATION"
echo "========================================"
echo ""

# ── 1. Check required env vars ──────────────────────────────
echo "--- 1. Environment Variables ---"
MISSING=0
for var in WA_RELAY_URL WA_RELAY_SECRET WA_ACCESS_TOKEN WA_PHONE_NUMBER_ID WA_APP_SECRET WA_VERIFY_TOKEN; do
  val="${!var:-}"
  if [[ -z "$val" ]]; then
    echo "  MISSING: $var"
    MISSING=$((MISSING + 1))
  else
    echo "  OK: $var (${#val} chars)"
  fi
done

if [[ $MISSING -gt 0 ]]; then
  check "Environment variables" "$MISSING variable(s) missing"
else
  check "Environment variables" "ok"
fi
echo ""

# ── 2. Relay health check ───────────────────────────────────
echo "--- 2. Relay Health Check ---"
RELAY_URL="${WA_RELAY_URL:-}"
if [[ -z "$RELAY_URL" ]]; then
  echo "  Skipped (WA_RELAY_URL not set)"
  check "Relay health" "skipped"
else
  HEALTH=$(curl -s -o /dev/null -w "%{http_code}" "$RELAY_URL/health" 2>/dev/null || echo "000")
  if [[ "$HEALTH" == "200" ]]; then
    echo "  $RELAY_URL/health -> 200 OK"
    check "Relay health" "ok"
  else
    echo "  $RELAY_URL/health -> HTTP $HEALTH"
    check "Relay health" "HTTP $HEALTH"
  fi
fi
echo ""

# ── 3. Webhook verification (simulated) ─────────────────────
echo "--- 3. Webhook Verification ---"
if [[ -z "$RELAY_URL" || -z "${WA_VERIFY_TOKEN:-}" ]]; then
  echo "  Skipped (WA_RELAY_URL or WA_VERIFY_TOKEN not set)"
  check "Webhook verification" "warn"
else
  CHALLENGE="verify_test_$(date +%s)"
  VERIFY_RESP=$(curl -s "$RELAY_URL/webhook?hub.mode=subscribe&hub.verify_token=$WA_VERIFY_TOKEN&hub.challenge=$CHALLENGE" 2>/dev/null || echo "")
  if [[ "$VERIFY_RESP" == "$CHALLENGE" ]]; then
    echo "  Challenge echoed correctly"
    check "Webhook verification" "ok"
  else
    echo "  Expected: $CHALLENGE"
    echo "  Got:      $VERIFY_RESP"
    check "Webhook verification" "challenge mismatch"
  fi
fi
echo ""

# ── 4. Broker auth (poll endpoint) ──────────────────────────
echo "--- 4. Broker Auth (poll endpoint) ---"
if [[ -z "$RELAY_URL" || -z "${WA_RELAY_SECRET:-}" ]]; then
  echo "  Skipped (WA_RELAY_URL or WA_RELAY_SECRET not set)"
  check "Broker auth" "warn"
else
  POLL_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer $WA_RELAY_SECRET" \
    "$RELAY_URL/messages" 2>/dev/null || echo "000")
  if [[ "$POLL_CODE" == "200" ]]; then
    echo "  GET /messages -> 200 (auth OK)"
    check "Broker auth" "ok"
  elif [[ "$POLL_CODE" == "401" ]]; then
    echo "  GET /messages -> 401 (WA_RELAY_SECRET mismatch with Worker RELAY_SECRET)"
    check "Broker auth" "401 unauthorized"
  else
    echo "  GET /messages -> HTTP $POLL_CODE"
    check "Broker auth" "HTTP $POLL_CODE"
  fi
fi
echo ""

# ── 5. HMAC signature test ──────────────────────────────────
echo "--- 5. HMAC Signature (webhook POST) ---"
if [[ -z "$RELAY_URL" || -z "${WA_APP_SECRET:-}" ]]; then
  echo "  Skipped (WA_RELAY_URL or WA_APP_SECRET not set)"
  check "HMAC signature" "warn"
else
  TEST_BODY='{"object":"whatsapp_business_account","entry":[]}'
  SIG=$(echo -n "$TEST_BODY" | openssl dgst -sha256 -hmac "$WA_APP_SECRET" 2>/dev/null | awk '{print $2}')
  HMAC_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
    "$RELAY_URL/webhook" \
    -H "Content-Type: application/json" \
    -H "X-Hub-Signature-256: sha256=$SIG" \
    -d "$TEST_BODY" 2>/dev/null || echo "000")
  if [[ "$HMAC_CODE" == "200" ]]; then
    echo "  Valid HMAC accepted (200)"
    check "HMAC signature" "ok"
  else
    echo "  HTTP $HMAC_CODE (expected 200)"
    check "HMAC signature" "HTTP $HMAC_CODE"
  fi
fi
echo ""

# ── 6. Graph API (send test) ────────────────────────────────
echo "--- 6. Graph API (phone number info) ---"
WA_TOKEN="${WA_ACCESS_TOKEN:-}"
PHONE_ID="${WA_PHONE_NUMBER_ID:-}"
if [[ -z "$WA_TOKEN" || -z "$PHONE_ID" ]]; then
  echo "  Skipped (WA_ACCESS_TOKEN or WA_PHONE_NUMBER_ID not set)"
  check "Graph API" "warn"
else
  PHONE_INFO=$(curl -s "https://graph.facebook.com/v22.0/$PHONE_ID" \
    -H "Authorization: Bearer $WA_TOKEN" 2>/dev/null || echo "{}")
  DISPLAY=$(echo "$PHONE_INFO" | jq_field display_phone_number)
  STATUS=$(echo "$PHONE_INFO" | jq_field verified_name)
  if [[ -n "$DISPLAY" ]]; then
    echo "  Phone: $DISPLAY"
    echo "  Verified name: $STATUS"
    check "Graph API" "ok"
  else
    ERR=$(echo "$PHONE_INFO" | python3 -c "import sys,json; e=json.load(sys.stdin).get('error',{}); print(e.get('message','unknown'))" 2>/dev/null || echo "unknown")
    check "Graph API" "$ERR"
  fi
fi
echo ""

# ── Summary ────────────────────────────────────────────────
echo "========================================"
echo "  RESULT: $PASS passed, $FAIL failed, $WARN warnings"
echo "========================================"
echo ""
echo "Checklist (manual):"
echo "  [ ] Webhook URL set in Facebook App > WhatsApp > Configuration"
echo "  [ ] 'messages' webhook field is SUBSCRIBED (not just verified!)"
echo "  [ ] Test phone number added to Allow List (for sandbox numbers)"
echo ""

if [[ $FAIL -gt 0 ]]; then
  exit 1
fi
