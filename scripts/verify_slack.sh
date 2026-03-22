#!/usr/bin/env bash
# Verify Slack Bot Token and App Token, then run smoke tests.
#
# Usage:
#   ./scripts/verify_slack.sh
#
# Reads tokens from (in priority order):
#   1. Environment variables: SLACK_BOT_TOKEN, SLACK_APP_TOKEN
#   2. Project .env file
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── Load tokens ─────────────────────────────────────────────
load_env() {
  local file="$1"
  if [[ -f "$file" ]]; then
    # shellcheck disable=SC1090
    set -a; source "$file"; set +a
  fi
}

# Slack is MCP-only (not a channel plugin), tokens live in project .env
load_env "$PROJECT_DIR/.env"

if [[ -z "${SLACK_BOT_TOKEN:-}" ]]; then
  echo "ERROR: SLACK_BOT_TOKEN not found"
  echo "Set it in .env (project root)"
  exit 1
fi

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

slack_api() {
  curl -s -H "Authorization: Bearer $SLACK_BOT_TOKEN" "$@"
}

echo "========================================"
echo "  SLACK VERIFICATION"
echo "========================================"
echo ""

# ── 1. Verify Bot Token ────────────────────────────────────
echo "--- 1. Bot Token (auth.test) ---"
AUTH=$(slack_api https://slack.com/api/auth.test)
AUTH_OK=$(echo "$AUTH" | jq_field ok)

if [[ "$AUTH_OK" == "True" ]]; then
  BOT_USER=$(echo "$AUTH" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'{d[\"user\"]} ({d[\"user_id\"]}) on {d[\"team\"]}')")
  echo "  Bot: $BOT_USER"
  check "Bot Token valid" "ok"
else
  ERR=$(echo "$AUTH" | jq_field error)
  check "Bot Token valid" "${ERR:-unknown}"
fi
echo ""

# ── 2. Verify App Token (Socket Mode) ─────────────────────
echo "--- 2. App Token (apps.connections.open) ---"
if [[ -z "${SLACK_APP_TOKEN:-}" ]]; then
  echo "  SLACK_APP_TOKEN not set (optional, needed for Socket Mode)"
  check "App Token (Socket Mode)" "warn"
else
  CONN=$(curl -s -H "Authorization: Bearer $SLACK_APP_TOKEN" \
    -X POST https://slack.com/api/apps.connections.open)
  CONN_OK=$(echo "$CONN" | jq_field ok)
  if [[ "$CONN_OK" == "True" ]]; then
    echo "  Socket Mode: WebSocket URL returned"
    check "App Token (Socket Mode)" "ok"
  else
    ERR=$(echo "$CONN" | jq_field error)
    check "App Token (Socket Mode)" "${ERR:-unknown}"
  fi
fi
echo ""

# ── 3. List DM Channels ───────────────────────────────────
echo "--- 3. DM Channels (conversations.list) ---"
if [[ "$AUTH_OK" != "True" ]]; then
  echo "  Skipped (Bot Token invalid)"
  check "List DM channels" "skipped"
else
  DMS=$(slack_api "https://slack.com/api/conversations.list?types=im&limit=50")
  DM_OK=$(echo "$DMS" | jq_field ok)
  if [[ "$DM_OK" == "True" ]]; then
    # Extract user IDs from DM channels
    DM_LIST=$(echo "$DMS" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for c in d.get('channels', []):
    print(c['id'], c['user'])
")
    DM_COUNT=$(echo "$DM_LIST" | wc -l)
    echo "  Found $DM_COUNT DM channel(s):"

    # Resolve each user ID
    TARGET_DM=""
    while read -r dm_id uid; do
      USER_INFO=$(slack_api "https://slack.com/api/users.info?user=$uid")
      UNAME=$(echo "$USER_INFO" | python3 -c "import sys,json; u=json.load(sys.stdin).get('user',{}); print(u.get('real_name','?'))" 2>/dev/null || echo "?")
      IS_BOT=$(echo "$USER_INFO" | python3 -c "import sys,json; u=json.load(sys.stdin).get('user',{}); print(u.get('is_bot',False))" 2>/dev/null || echo "False")
      NAME=$(echo "$USER_INFO" | python3 -c "import sys,json; u=json.load(sys.stdin).get('user',{}); print(u.get('name','?'))" 2>/dev/null || echo "?")

      TAG=""
      if [[ "$IS_BOT" == "True" ]]; then
        TAG=" (bot)"
      fi
      echo "    $dm_id -> $UNAME (@$NAME) [$uid]$TAG"

      # Pick first non-bot, non-slackbot user as target
      if [[ -z "$TARGET_DM" && "$IS_BOT" != "True" && "$NAME" != "slackbot" ]]; then
        TARGET_DM="$dm_id"
      fi
    done <<< "$DM_LIST"

    check "List DM channels" "ok"
  else
    ERR=$(echo "$DMS" | jq_field error)
    check "List DM channels" "${ERR:-unknown}"
  fi
fi
echo ""

# ── 4. Send Smoke Test Message ─────────────────────────────
echo "--- 4. Send Smoke Test ---"
if [[ -z "${TARGET_DM:-}" ]]; then
  echo "  No user DM channel found"
  check "Send smoke test" "warn"
else
  SEND=$(curl -s -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"channel\":\"$TARGET_DM\",\"text\":\"Slack verification passed. Bot is online.\"}" \
    https://slack.com/api/chat.postMessage)
  SEND_OK=$(echo "$SEND" | jq_field ok)
  if [[ "$SEND_OK" == "True" ]]; then
    echo "  Sent to $TARGET_DM"
    check "Send smoke test" "ok"
  else
    ERR=$(echo "$SEND" | jq_field error)
    check "Send smoke test" "${ERR:-unknown}"
  fi
fi
echo ""

# ── Summary ────────────────────────────────────────────────
echo "========================================"
echo "  RESULT: $PASS passed, $FAIL failed, $WARN warnings"
echo "========================================"

if [[ $FAIL -gt 0 ]]; then
  exit 1
fi
