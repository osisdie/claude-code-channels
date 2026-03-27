#!/usr/bin/env bash
# Verify Discord bot configuration and communication health.
#
# Usage:
#   ./scripts/verify_discord.sh
#
# Reads from (in priority order):
#   1. Environment variables (DISCORD_STATE_DIR override)
#   2. Project-based channel dir (.claude/channels/discord/)
#   3. Global channel dir (~/.claude/channels/discord/)
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
if [[ -n "${DISCORD_STATE_DIR:-}" ]]; then
  STATE_DIR="$DISCORD_STATE_DIR"
  STATE_LOCATION="env-override"
elif [[ -d "$PROJECT_DIR/.claude/channels/discord" ]]; then
  STATE_DIR="$PROJECT_DIR/.claude/channels/discord"
  STATE_LOCATION="project"
elif [[ -d "$HOME/.claude/channels/discord" ]]; then
  STATE_DIR="$HOME/.claude/channels/discord"
  STATE_LOCATION="global"
else
  STATE_DIR="$PROJECT_DIR/.claude/channels/discord"
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
echo "  DISCORD BOT VERIFICATION"
echo "========================================"
echo ""
echo "  State dir: $STATE_DIR"
echo "  Location:  $STATE_LOCATION"
if [[ "$STATE_LOCATION" == "global" ]]; then
  echo ""
  echo "  NOTE: Using GLOBAL state dir (~/.claude/channels/discord/)."
  echo "        Project-based config is recommended for multi-project setups."
  echo "        To migrate: move $STATE_DIR to $PROJECT_DIR/.claude/channels/discord/"
  echo "        Or set DISCORD_STATE_DIR in your project .env"
fi
echo ""

# ── 1. Check bot token ───────────────────────────────────────
echo "--- 1. Bot Token ---"
TOKEN="${DISCORD_BOT_TOKEN:-}"
if [[ -z "$TOKEN" ]]; then
  echo "  MISSING: DISCORD_BOT_TOKEN"
  echo "  Set in: $STATE_DIR/.env"
  echo "  Format: DISCORD_BOT_TOKEN=MTIz..."
  check "Bot token" "DISCORD_BOT_TOKEN not set"
else
  echo "  OK: DISCORD_BOT_TOKEN (${#TOKEN} chars)"
  # Discord tokens are base64-encoded, typically start with letters/digits
  if [[ ${#TOKEN} -ge 50 ]]; then
    check "Bot token" "ok"
  else
    echo "  WARNING: Token seems short (expected 50+ chars)"
    check "Bot token" "warn"
  fi
fi
echo ""

# ── 2. Bot API: Get Current User ─────────────────────────────
echo "--- 2. Bot Identity (@me) ---"
if [[ -z "$TOKEN" ]]; then
  echo "  Skipped (no token)"
  check "Bot identity" "warn"
else
  ME_RESP=$(curl -s -H "Authorization: Bot $TOKEN" \
    "https://discord.com/api/v10/users/@me" 2>/dev/null || echo '{}')
  BOT_USERNAME=$(echo "$ME_RESP" | jq_field username)
  BOT_ID=$(echo "$ME_RESP" | jq_field id)
  BOT_DISCRIMINATOR=$(echo "$ME_RESP" | jq_field discriminator)

  if [[ -n "$BOT_USERNAME" && -n "$BOT_ID" ]]; then
    DISPLAY="$BOT_USERNAME"
    if [[ -n "$BOT_DISCRIMINATOR" && "$BOT_DISCRIMINATOR" != "0" ]]; then
      DISPLAY="${BOT_USERNAME}#${BOT_DISCRIMINATOR}"
    fi
    echo "  Bot: $DISPLAY"
    echo "  ID:  $BOT_ID"
    check "Bot identity" "ok"
  else
    ERR_MSG=$(echo "$ME_RESP" | jq_field message)
    ERR_CODE=$(echo "$ME_RESP" | jq_field code)
    if [[ -n "$ERR_MSG" ]]; then
      echo "  Error: $ERR_MSG (code: $ERR_CODE)"
      check "Bot identity" "$ERR_MSG"
    else
      echo "  Unexpected response: ${ME_RESP:0:200}"
      check "Bot identity" "unexpected response"
    fi
  fi
fi
echo ""

# ── 3. Gateway connectivity ──────────────────────────────────
echo "--- 3. Gateway Connectivity ---"
if [[ -z "$TOKEN" ]]; then
  echo "  Skipped (no token)"
  check "Gateway" "warn"
else
  GW_RESP=$(curl -s -H "Authorization: Bot $TOKEN" \
    "https://discord.com/api/v10/gateway/bot" 2>/dev/null || echo '{}')
  GW_URL=$(echo "$GW_RESP" | jq_field url)
  GW_SHARDS=$(echo "$GW_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('shards',0))" 2>/dev/null || echo "0")
  GW_REMAINING=$(echo "$GW_RESP" | python3 -c "
import sys,json
d=json.load(sys.stdin).get('session_start_limit',{})
print(f\"{d.get('remaining','?')}/{d.get('total','?')}\")
" 2>/dev/null || echo "?/?")

  if [[ -n "$GW_URL" && "$GW_URL" == wss://* ]]; then
    echo "  Gateway URL: $GW_URL"
    echo "  Shards: $GW_SHARDS"
    echo "  Session starts remaining: $GW_REMAINING"
    check "Gateway" "ok"
  else
    ERR_MSG=$(echo "$GW_RESP" | jq_field message)
    if [[ -n "$ERR_MSG" ]]; then
      echo "  Error: $ERR_MSG"
      check "Gateway" "$ERR_MSG"
    else
      echo "  Unexpected response: ${GW_RESP:0:200}"
      check "Gateway" "unexpected response"
    fi
  fi
fi
echo ""

# ── 4. Bot permissions (guilds) ───────────────────────────────
echo "--- 4. Guild Membership ---"
if [[ -z "$TOKEN" ]]; then
  echo "  Skipped (no token)"
  check "Guild membership" "warn"
else
  GUILDS_RESP=$(curl -s -H "Authorization: Bot $TOKEN" \
    "https://discord.com/api/v10/users/@me/guilds" 2>/dev/null || echo '[]')
  GUILD_COUNT=$(echo "$GUILDS_RESP" | python3 -c "
import sys,json
data=json.load(sys.stdin)
if isinstance(data, list):
    print(len(data))
else:
    print(0)
" 2>/dev/null || echo "0")

  if [[ "$GUILD_COUNT" -gt 0 ]]; then
    echo "  Bot is in $GUILD_COUNT guild(s):"
    echo "$GUILDS_RESP" | python3 -c "
import sys,json
data=json.load(sys.stdin)
if isinstance(data, list):
    for g in data[:10]:
        print(f\"    - {g.get('name','?')} (id: {g.get('id','?')})\")
    if len(data) > 10:
        print(f'    ... and {len(data)-10} more')
" 2>/dev/null || true
    check "Guild membership" "ok"
  else
    echo "  Bot is not in any guilds."
    echo "  Invite it using: https://discord.com/oauth2/authorize?client_id=${BOT_ID:-BOT_ID}&scope=bot&permissions=274877975552"
    check "Guild membership" "warn"
  fi
fi
echo ""

# ── 5. Access configuration ──────────────────────────────────
echo "--- 5. Access Configuration ---"
ACCESS_FILE="$STATE_DIR/access.json"
if [[ ! -f "$ACCESS_FILE" ]]; then
  echo "  No access.json found at $ACCESS_FILE"
  echo "  The bot has no paired users yet."
  check "Access config" "warn"
else
  DM_POLICY=$(python3 -c "import json; a=json.load(open('$ACCESS_FILE')); print(a.get('dmPolicy','pairing'))" 2>/dev/null || echo "?")
  ALLOW_COUNT=$(python3 -c "import json; a=json.load(open('$ACCESS_FILE')); print(len(a.get('allowFrom',[])))" 2>/dev/null || echo "0")
  CHANNEL_COUNT=$(python3 -c "import json; a=json.load(open('$ACCESS_FILE')); print(len(a.get('channels',{})))" 2>/dev/null || echo "0")
  PENDING_COUNT=$(python3 -c "import json; a=json.load(open('$ACCESS_FILE')); print(len(a.get('pending',{})))" 2>/dev/null || echo "0")

  echo "  DM policy:       $DM_POLICY"
  echo "  Allowed users:   $ALLOW_COUNT"
  echo "  Guild channels:  $CHANNEL_COUNT"
  echo "  Pending pairs:   $PENDING_COUNT"

  if [[ "$ALLOW_COUNT" -gt 0 ]]; then
    check "Access config" "ok"
  elif [[ "$DM_POLICY" == "pairing" ]]; then
    echo "  No users paired yet. DM the bot to start pairing."
    check "Access config" "warn"
  else
    echo "  No users allowed and DM policy is '$DM_POLICY'"
    check "Access config" "warn"
  fi
fi
echo ""

# ── 6. Communication test ────────────────────────────────────
echo "--- 6. Communication Test ---"
if [[ -z "$TOKEN" ]]; then
  echo "  Skipped (no token)"
  check "Communication" "warn"
elif [[ ! -f "$ACCESS_FILE" ]] || [[ "${ALLOW_COUNT:-0}" -eq 0 ]]; then
  echo "  Skipped (no paired users to send to)"
  check "Communication" "warn"
else
  # Get the first allowlisted user and open/get their DM channel
  FIRST_USER=$(python3 -c "import json; a=json.load(open('$ACCESS_FILE')); print(a.get('allowFrom',[''])[0])" 2>/dev/null || echo "")
  if [[ -z "$FIRST_USER" ]]; then
    echo "  Skipped (could not read allowFrom)"
    check "Communication" "warn"
  else
    # Create DM channel
    DM_RESP=$(curl -s -X POST -H "Authorization: Bot $TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"recipient_id\":\"$FIRST_USER\"}" \
      "https://discord.com/api/v10/users/@me/channels" 2>/dev/null || echo '{}')
    DM_CHANNEL_ID=$(echo "$DM_RESP" | jq_field id)

    if [[ -z "$DM_CHANNEL_ID" ]]; then
      ERR_MSG=$(echo "$DM_RESP" | jq_field message)
      echo "  Could not open DM with user $FIRST_USER: ${ERR_MSG:-unknown}"
      check "Communication" "${ERR_MSG:-failed to open DM}"
    else
      # Send test message
      SEND_RESP=$(curl -s -X POST -H "Authorization: Bot $TOKEN" \
        -H "Content-Type: application/json" \
        -d '{"content":"[verify_discord.sh] Health check ping — bot is reachable."}' \
        "https://discord.com/api/v10/channels/$DM_CHANNEL_ID/messages" 2>/dev/null || echo '{}')
      SEND_ID=$(echo "$SEND_RESP" | jq_field id)

      if [[ -n "$SEND_ID" ]]; then
        echo "  Sent test message to user $FIRST_USER (msg: $SEND_ID)"
        check "Communication" "ok"
      else
        SEND_ERR=$(echo "$SEND_RESP" | jq_field message)
        echo "  Failed to send to $FIRST_USER: ${SEND_ERR:-unknown}"
        check "Communication" "${SEND_ERR:-unknown}"
      fi
    fi
  fi
fi
echo ""

# ── 7. Plugin process check ──────────────────────────────────
echo "--- 7. Plugin Process ---"
PLUGIN_PID=$(pgrep -f "discord.*server\\.ts" 2>/dev/null || true)
if [[ -n "$PLUGIN_PID" ]]; then
  echo "  Discord plugin process running (PID: $PLUGIN_PID)"
  check "Plugin process" "ok"
else
  echo "  No running Discord plugin process detected."
  echo "  The plugin starts automatically when Claude Code opens."
  check "Plugin process" "warn"
fi
echo ""

# ── 8. File permissions ──────────────────────────────────────
echo "--- 8. File Permissions ---"
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
echo "  1. Token issues:     Recreate at https://discord.com/developers/applications"
echo "  2. Missing intents:  Enable MESSAGE CONTENT intent in Bot settings"
echo "  3. Pairing:          DM the bot, then run /discord:access pair <code>"
echo "  4. Not in guild:     Use the OAuth2 invite link above"
echo "  5. Plugin logs:      Check stderr output in Claude Code session"
echo ""

if [[ $FAIL -gt 0 ]]; then
  exit 1
fi
