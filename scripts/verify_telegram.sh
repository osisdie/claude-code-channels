#!/usr/bin/env bash
# Verify Telegram bot configuration and communication health.
#
# Usage:
#   ./scripts/verify_telegram.sh
#
# Reads from (in priority order):
#   1. Environment variables (TELEGRAM_STATE_DIR override)
#   2. Project-based channel dir (.claude/channels/telegram/)
#   3. Global channel dir (~/.claude/channels/telegram/)
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
if [[ -n "${TELEGRAM_STATE_DIR:-}" ]]; then
  STATE_DIR="$TELEGRAM_STATE_DIR"
  STATE_LOCATION="env-override"
elif [[ -d "$PROJECT_DIR/.claude/channels/telegram" ]]; then
  STATE_DIR="$PROJECT_DIR/.claude/channels/telegram"
  STATE_LOCATION="project"
elif [[ -d "$HOME/.claude/channels/telegram" ]]; then
  STATE_DIR="$HOME/.claude/channels/telegram"
  STATE_LOCATION="global"
else
  STATE_DIR="$PROJECT_DIR/.claude/channels/telegram"
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
echo "  TELEGRAM BOT VERIFICATION"
echo "========================================"
echo ""
echo "  State dir: $STATE_DIR"
echo "  Location:  $STATE_LOCATION"
if [[ "$STATE_LOCATION" == "global" ]]; then
  echo ""
  echo "  NOTE: Using GLOBAL state dir (~/.claude/channels/telegram/)."
  echo "        Project-based config is recommended for multi-project setups."
  echo "        To migrate: move $STATE_DIR to $PROJECT_DIR/.claude/channels/telegram/"
  echo "        Or set TELEGRAM_STATE_DIR in your project .env"
fi
echo ""

# ── 1. Check bot token ───────────────────────────────────────
echo "--- 1. Bot Token ---"
TOKEN="${TELEGRAM_BOT_TOKEN:-}"
if [[ -z "$TOKEN" ]]; then
  echo "  MISSING: TELEGRAM_BOT_TOKEN"
  echo "  Set in: $STATE_DIR/.env"
  echo "  Format: TELEGRAM_BOT_TOKEN=123456789:AAH..."
  check "Bot token" "TELEGRAM_BOT_TOKEN not set"
else
  echo "  OK: TELEGRAM_BOT_TOKEN (${#TOKEN} chars)"
  # Basic format check: should be <digits>:<base64-ish>
  if [[ "$TOKEN" =~ ^[0-9]+:[A-Za-z0-9_-]+$ ]]; then
    check "Bot token" "ok"
  else
    echo "  WARNING: Token format looks unusual (expected <digits>:<alphanumeric>)"
    check "Bot token" "warn"
  fi
fi
echo ""

# ── 2. Bot API: getMe ────────────────────────────────────────
echo "--- 2. Bot Identity (getMe) ---"
if [[ -z "$TOKEN" ]]; then
  echo "  Skipped (no token)"
  check "Bot identity" "warn"
else
  ME_RESP=$(curl -s "https://api.telegram.org/bot${TOKEN}/getMe" 2>/dev/null || echo '{"ok":false}')
  ME_OK=$(echo "$ME_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('ok',False))" 2>/dev/null || echo "False")

  if [[ "$ME_OK" == "True" ]]; then
    BOT_USERNAME=$(echo "$ME_RESP" | python3 -c "import sys,json; r=json.load(sys.stdin)['result']; print(r.get('username',''))" 2>/dev/null || echo "")
    BOT_NAME=$(echo "$ME_RESP" | python3 -c "import sys,json; r=json.load(sys.stdin)['result']; print(r.get('first_name',''))" 2>/dev/null || echo "")
    BOT_ID=$(echo "$ME_RESP" | python3 -c "import sys,json; r=json.load(sys.stdin)['result']; print(r.get('id',''))" 2>/dev/null || echo "")
    echo "  Bot: $BOT_NAME (@$BOT_USERNAME)"
    echo "  ID:  $BOT_ID"
    check "Bot identity" "ok"
  else
    ERR_DESC=$(echo "$ME_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('description','unknown error'))" 2>/dev/null || echo "unknown error")
    echo "  Error: $ERR_DESC"
    check "Bot identity" "$ERR_DESC"
  fi
fi
echo ""

# ── 3. Webhook status ────────────────────────────────────────
echo "--- 3. Webhook Status ---"
if [[ -z "$TOKEN" ]]; then
  echo "  Skipped (no token)"
  check "Webhook status" "warn"
else
  WH_RESP=$(curl -s "https://api.telegram.org/bot${TOKEN}/getWebhookInfo" 2>/dev/null || echo '{"ok":false}')
  WH_URL=$(echo "$WH_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('result',{}).get('url',''))" 2>/dev/null || echo "")
  WH_PENDING=$(echo "$WH_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('result',{}).get('pending_update_count',0))" 2>/dev/null || echo "0")
  WH_ERROR=$(echo "$WH_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('result',{}).get('last_error_message',''))" 2>/dev/null || echo "")
  WH_ERROR_DATE=$(echo "$WH_RESP" | python3 -c "
import sys,json,datetime
d=json.load(sys.stdin).get('result',{}).get('last_error_date',0)
print(datetime.datetime.fromtimestamp(d).isoformat() if d else '')
" 2>/dev/null || echo "")

  if [[ -z "$WH_URL" ]]; then
    echo "  Mode: long-polling (no webhook set)"
    echo "  This is correct for the Claude Code plugin."
    check "Webhook status" "ok"
  else
    echo "  Mode: webhook"
    echo "  URL:  $WH_URL"
    echo "  WARNING: Webhook is set. The Claude Code plugin uses long-polling."
    echo "           The bot may not receive messages via the plugin."
    echo "           To fix: curl -s 'https://api.telegram.org/bot\${TOKEN}/deleteWebhook'"
    check "Webhook status" "warn"
  fi

  if [[ "$WH_PENDING" -gt 0 ]]; then
    echo "  Pending updates: $WH_PENDING"
  fi
  if [[ -n "$WH_ERROR" ]]; then
    echo "  Last error: $WH_ERROR ($WH_ERROR_DATE)"
  fi
fi
echo ""

# ── 4. Access configuration ──────────────────────────────────
echo "--- 4. Access Configuration ---"
ACCESS_FILE="$STATE_DIR/access.json"
if [[ ! -f "$ACCESS_FILE" ]]; then
  echo "  No access.json found at $ACCESS_FILE"
  echo "  The bot has no paired users yet."
  check "Access config" "warn"
else
  DM_POLICY=$(python3 -c "import json; a=json.load(open('$ACCESS_FILE')); print(a.get('dmPolicy','pairing'))" 2>/dev/null || echo "?")
  ALLOW_COUNT=$(python3 -c "import json; a=json.load(open('$ACCESS_FILE')); print(len(a.get('allowFrom',[])))" 2>/dev/null || echo "0")
  GROUP_COUNT=$(python3 -c "import json; a=json.load(open('$ACCESS_FILE')); print(len(a.get('groups',{})))" 2>/dev/null || echo "0")
  PENDING_COUNT=$(python3 -c "import json; a=json.load(open('$ACCESS_FILE')); print(len(a.get('pending',{})))" 2>/dev/null || echo "0")

  echo "  DM policy:     $DM_POLICY"
  echo "  Allowed users: $ALLOW_COUNT"
  echo "  Groups:        $GROUP_COUNT"
  echo "  Pending pairs: $PENDING_COUNT"

  if [[ "$ALLOW_COUNT" -gt 0 ]]; then
    check "Access config" "ok"
  elif [[ "$DM_POLICY" == "pairing" ]]; then
    echo "  No users paired yet. Send a message to the bot to start pairing."
    check "Access config" "warn"
  else
    echo "  No users allowed and DM policy is '$DM_POLICY'"
    check "Access config" "warn"
  fi
fi
echo ""

# ── 5. Send test message (optional) ──────────────────────────
echo "--- 5. Communication Test ---"
if [[ -z "$TOKEN" ]]; then
  echo "  Skipped (no token)"
  check "Communication" "warn"
elif [[ "$ALLOW_COUNT" -eq 0 ]] 2>/dev/null; then
  echo "  Skipped (no paired users to send to)"
  check "Communication" "warn"
else
  # Get the first allowlisted user
  FIRST_USER=$(python3 -c "import json; a=json.load(open('$ACCESS_FILE')); print(a.get('allowFrom',[''])[0])" 2>/dev/null || echo "")
  if [[ -z "$FIRST_USER" ]]; then
    echo "  Skipped (could not read allowFrom)"
    check "Communication" "warn"
  else
    SEND_RESP=$(curl -s "https://api.telegram.org/bot${TOKEN}/sendMessage" \
      -d "chat_id=$FIRST_USER" \
      -d "text=[verify_telegram.sh] Health check ping — bot is reachable." 2>/dev/null || echo '{"ok":false}')
    SEND_OK=$(echo "$SEND_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('ok',False))" 2>/dev/null || echo "False")

    if [[ "$SEND_OK" == "True" ]]; then
      echo "  Sent test message to user $FIRST_USER"
      check "Communication" "ok"
    else
      SEND_ERR=$(echo "$SEND_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('description','unknown'))" 2>/dev/null || echo "unknown")
      echo "  Failed to send to $FIRST_USER: $SEND_ERR"
      check "Communication" "$SEND_ERR"
    fi
  fi
fi
echo ""

# ── 6. Plugin process check ──────────────────────────────────
echo "--- 6. Plugin Process ---"
PLUGIN_PID=$(pgrep -f "telegram.*server\\.ts" 2>/dev/null || true)
if [[ -n "$PLUGIN_PID" ]]; then
  echo "  Telegram plugin process running (PID: $PLUGIN_PID)"
  check "Plugin process" "ok"
else
  echo "  No running Telegram plugin process detected."
  echo "  The plugin starts automatically when Claude Code opens."
  check "Plugin process" "warn"
fi
echo ""

# ── 7. File permissions ──────────────────────────────────────
echo "--- 7. File Permissions ---"
PERM_OK=true
if [[ -f "$STATE_DIR/.env" ]]; then
  ENV_PERMS=$(stat -c "%a" "$STATE_DIR/.env" 2>/dev/null || stat -f "%Lp" "$STATE_DIR/.env" 2>/dev/null || echo "???")
  echo "  .env permissions: $ENV_PERMS"
  if [[ "$ENV_PERMS" == "600" ]]; then
    echo "  OK: owner-only read/write"
  else
    echo "  WARNING: .env should be 600 (owner-only). Contains bot token."
    PERM_OK=false
  fi
else
  echo "  .env not found"
  PERM_OK=false
fi

if [[ -f "$ACCESS_FILE" ]]; then
  ACC_PERMS=$(stat -c "%a" "$ACCESS_FILE" 2>/dev/null || stat -f "%Lp" "$ACCESS_FILE" 2>/dev/null || echo "???")
  echo "  access.json permissions: $ACC_PERMS"
  if [[ "$ACC_PERMS" == "600" ]]; then
    echo "  OK: owner-only read/write"
  else
    echo "  WARNING: access.json should be 600 (owner-only). Contains user IDs."
    PERM_OK=false
  fi
fi

if $PERM_OK; then
  check "File permissions" "ok"
else
  check "File permissions" "warn"
fi
echo ""

# ── Summary ──────────────────────────────────────────────────
echo "========================================"
echo "  RESULT: $PASS passed, $FAIL failed, $WARN warnings"
echo "========================================"
echo ""
echo "Troubleshooting:"
echo "  1. Token issues:    Recreate via @BotFather on Telegram"
echo "  2. No messages:     Ensure no webhook is set (long-polling mode)"
echo "  3. Pairing:         Send /start to the bot, then run /telegram:access pair <code>"
echo "  4. 409 Conflict:    Another bot instance is running — kill it or wait"
echo "  5. Plugin logs:     Check stderr output in Claude Code session"
echo ""

if [[ $FAIL -gt 0 ]]; then
  exit 1
fi
