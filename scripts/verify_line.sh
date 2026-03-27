#!/usr/bin/env bash
# Verify LINE relay deployment, token configuration, and KV binding.
#
# Usage:
#   ./scripts/verify_line.sh
#
# Reads from (in priority order):
#   1. Environment variables (LINE_STATE_DIR override)
#   2. Project-based channel dir (.claude/channels/line/)
#   3. Global channel dir (~/.claude/channels/line/)
#   4. Project .env file
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

# Resolve STATE_DIR: env override > project-based > global fallback
STATE_LOCATION=""
if [[ -n "${LINE_STATE_DIR:-}" ]]; then
  STATE_DIR="$LINE_STATE_DIR"
  STATE_LOCATION="env-override"
elif [[ -d "$PROJECT_DIR/.claude/channels/line" ]]; then
  STATE_DIR="$PROJECT_DIR/.claude/channels/line"
  STATE_LOCATION="project"
elif [[ -d "$HOME/.claude/channels/line" ]]; then
  STATE_DIR="$HOME/.claude/channels/line"
  STATE_LOCATION="global"
else
  STATE_DIR="$PROJECT_DIR/.claude/channels/line"
  STATE_LOCATION="project (not yet created)"
fi

load_env "$STATE_DIR/.env"
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
echo "  LINE RELAY VERIFICATION"
echo "========================================"
echo ""
echo "  State dir: $STATE_DIR"
echo "  Location:  $STATE_LOCATION"
if [[ "$STATE_LOCATION" == "global" ]]; then
  echo ""
  echo "  NOTE: Using GLOBAL state dir (~/.claude/channels/line/)."
  echo "        Project-based config is recommended for multi-project setups."
  echo "        To migrate: move $STATE_DIR to $PROJECT_DIR/.claude/channels/line/"
  echo "        Or set LINE_STATE_DIR in your project .env"
fi
echo ""

# ── 1. Check required env vars ──────────────────────────────
echo "--- 1. Environment Variables ---"
MISSING=0
for var in LINE_RELAY_URL LINE_RELAY_SECRET LINE_CHANNEL_SECRET LINE_CHANNEL_ACCESS_TOKEN; do
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
RELAY_URL="${LINE_RELAY_URL:-}"
if [[ -z "$RELAY_URL" ]]; then
  echo "  Skipped (LINE_RELAY_URL not set)"
  check "Relay health" "skipped"
else
  HEALTH_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$RELAY_URL/health" 2>/dev/null || echo "000")
  if [[ "$HEALTH_CODE" == "200" ]]; then
    echo "  $RELAY_URL/health -> 200 OK"
    check "Relay health" "ok"
  else
    echo "  $RELAY_URL/health -> HTTP $HEALTH_CODE"
    check "Relay health" "HTTP $HEALTH_CODE"
  fi
fi
echo ""

# ── 3. Broker auth (poll endpoint) ──────────────────────────
echo "--- 3. Broker Auth (GET /messages) ---"
RELAY_SECRET="${LINE_RELAY_SECRET:-}"
if [[ -z "$RELAY_URL" || -z "$RELAY_SECRET" ]]; then
  echo "  Skipped (LINE_RELAY_URL or LINE_RELAY_SECRET not set)"
  check "Broker auth" "warn"
else
  POLL_RESP=$(curl -s -w "\n%{http_code}" \
    -H "Authorization: Bearer $RELAY_SECRET" \
    "$RELAY_URL/messages" 2>/dev/null || echo -e "\n000")
  POLL_BODY=$(echo "$POLL_RESP" | head -n -1)
  POLL_CODE=$(echo "$POLL_RESP" | tail -n 1)

  if [[ "$POLL_CODE" == "200" ]]; then
    MSG_COUNT=$(echo "$POLL_BODY" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('messages',[])))" 2>/dev/null || echo "?")
    echo "  GET /messages -> 200 (auth OK, $MSG_COUNT queued message(s))"
    check "Broker auth" "ok"
  elif [[ "$POLL_CODE" == "401" ]]; then
    echo "  GET /messages -> 401 (LINE_RELAY_SECRET mismatch with Worker RELAY_SECRET)"
    check "Broker auth" "401 unauthorized"
  elif [[ "$POLL_CODE" == "500" ]]; then
    echo "  GET /messages -> 500 Internal Server Error"
    # Try to extract structured error from response body
    ERR_MSG=$(echo "$POLL_BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('error',''))" 2>/dev/null || echo "")
    if [[ -n "$ERR_MSG" ]]; then
      echo "  Error: $ERR_MSG"
    fi
    echo ""
    if echo "$POLL_BODY" | grep -qi "limit exceeded"; then
      echo "  → KV daily operation quota exceeded (Free plan: 1,000 list ops/day)"
      echo "    Resets at UTC midnight. Fix: upgrade to Workers Paid (\$5/mo) or reduce poll frequency"
    else
      echo "  Common causes:"
      echo "    - KV namespace 'LINE_QUEUE' not bound (check wrangler.toml binding)"
      echo "    - Worker secrets not set (run: wrangler secret put LINE_CHANNEL_SECRET)"
      echo "    - Worker deployment failed or outdated (run: wrangler deploy)"
    fi
    echo ""
    echo "  Debug: check Worker logs with: wrangler tail --name line-relay"
    check "Broker auth" "HTTP 500 — ${ERR_MSG:-unknown}"
  else
    echo "  GET /messages -> HTTP $POLL_CODE"
    echo "  Response body: ${POLL_BODY:0:200}"
    check "Broker auth" "HTTP $POLL_CODE"
  fi
fi
echo ""

# ── 4. Broker auth (no-token test) ──────────────────────────
echo "--- 4. Auth Rejection (no token) ---"
if [[ -z "$RELAY_URL" ]]; then
  echo "  Skipped (LINE_RELAY_URL not set)"
  check "Auth rejection" "warn"
else
  NO_AUTH_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$RELAY_URL/messages" 2>/dev/null || echo "000")
  if [[ "$NO_AUTH_CODE" == "401" ]]; then
    echo "  GET /messages (no token) -> 401 (correctly rejected)"
    check "Auth rejection" "ok"
  else
    echo "  GET /messages (no token) -> HTTP $NO_AUTH_CODE (expected 401)"
    check "Auth rejection" "expected 401, got $NO_AUTH_CODE"
  fi
fi
echo ""

# ── 5. Reply endpoint (dry run) ─────────────────────────────
echo "--- 5. Reply Endpoint ---"
if [[ -z "$RELAY_URL" || -z "$RELAY_SECRET" ]]; then
  echo "  Skipped (LINE_RELAY_URL or LINE_RELAY_SECRET not set)"
  check "Reply endpoint" "warn"
else
  # Send an invalid body to test the endpoint is reachable and auth works
  REPLY_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
    -H "Authorization: Bearer $RELAY_SECRET" \
    -H "Content-Type: application/json" \
    -d '{}' \
    "$RELAY_URL/reply" 2>/dev/null || echo "000")

  if [[ "$REPLY_CODE" == "400" ]]; then
    echo "  POST /reply -> 400 (auth OK, correctly requires userId+text)"
    check "Reply endpoint" "ok"
  elif [[ "$REPLY_CODE" == "401" ]]; then
    echo "  POST /reply -> 401 (auth failed)"
    check "Reply endpoint" "401 unauthorized"
  elif [[ "$REPLY_CODE" == "500" ]]; then
    echo "  POST /reply -> 500 (Worker error)"
    check "Reply endpoint" "HTTP 500"
  else
    echo "  POST /reply -> HTTP $REPLY_CODE"
    check "Reply endpoint" "HTTP $REPLY_CODE"
  fi
fi
echo ""

# ── 6. LINE Messaging API (bot info) ────────────────────────
echo "--- 6. LINE Messaging API (bot info) ---"
LINE_TOKEN="${LINE_CHANNEL_ACCESS_TOKEN:-}"
if [[ -z "$LINE_TOKEN" ]]; then
  echo "  Skipped (LINE_CHANNEL_ACCESS_TOKEN not set)"
  check "LINE API" "warn"
else
  BOT_INFO=$(curl -s "https://api.line.me/v2/bot/info" \
    -H "Authorization: Bearer $LINE_TOKEN" 2>/dev/null || echo "{}")
  BOT_NAME=$(echo "$BOT_INFO" | jq_field displayName)
  BOT_ID=$(echo "$BOT_INFO" | jq_field userId)

  if [[ -n "$BOT_NAME" ]]; then
    echo "  Bot: $BOT_NAME"
    echo "  ID:  $BOT_ID"
    check "LINE API" "ok"
  else
    ERR_MSG=$(echo "$BOT_INFO" | jq_field message)
    if [[ -n "$ERR_MSG" ]]; then
      echo "  Error: $ERR_MSG"
      check "LINE API" "$ERR_MSG"
    else
      echo "  Unexpected response: ${BOT_INFO:0:200}"
      check "LINE API" "unexpected response"
    fi
  fi
fi
echo ""

# ── 7. Webhook URL check ────────────────────────────────────
echo "--- 7. Webhook Configuration ---"
if [[ -z "$LINE_TOKEN" ]]; then
  echo "  Skipped (LINE_CHANNEL_ACCESS_TOKEN not set)"
  check "Webhook config" "warn"
else
  WEBHOOK_INFO=$(curl -s "https://api.line.me/v2/bot/channel/webhook/endpoint" \
    -H "Authorization: Bearer $LINE_TOKEN" 2>/dev/null || echo "{}")
  WEBHOOK_URL=$(echo "$WEBHOOK_INFO" | jq_field endpoint)
  WEBHOOK_ACTIVE=$(echo "$WEBHOOK_INFO" | python3 -c "import sys,json; print(json.load(sys.stdin).get('active',''))" 2>/dev/null || echo "")

  if [[ -n "$WEBHOOK_URL" ]]; then
    echo "  Endpoint: $WEBHOOK_URL"
    echo "  Active:   $WEBHOOK_ACTIVE"
    if [[ -n "$RELAY_URL" && "$WEBHOOK_URL" == *"$RELAY_URL"* ]] || [[ "$WEBHOOK_URL" == "${RELAY_URL}/webhook" ]]; then
      check "Webhook config" "ok"
    elif [[ -n "$RELAY_URL" ]]; then
      echo "  WARNING: Webhook URL does not match LINE_RELAY_URL"
      echo "    Expected: ${RELAY_URL}/webhook"
      echo "    Got:      $WEBHOOK_URL"
      check "Webhook config" "warn"
    else
      check "Webhook config" "ok"
    fi
  else
    echo "  No webhook endpoint configured"
    check "Webhook config" "warn"
  fi
fi
echo ""

# ── Summary ────────────────────────────────────────────────
echo "========================================"
echo "  RESULT: $PASS passed, $FAIL failed, $WARN warnings"
echo "========================================"
echo ""
echo "Troubleshooting 500 on GET /messages:"
echo "  1. Check Worker logs:     wrangler tail --name line-relay"
echo "  2. Verify KV binding:     wrangler kv namespace list"
echo "  3. Verify secrets:        wrangler secret list --name line-relay"
echo "  4. Redeploy Worker:       cd external_plugins/line-channel/relay && wrangler deploy"
echo "  5. KV quota (free plan):  1,000 list ops/day — resets at UTC midnight"
echo "     With POLL_INTERVAL=5s, each poll uses 1 list() → 17,280/day (exceeds free tier)"
echo ""

if [[ $FAIL -gt 0 ]]; then
  exit 1
fi
