#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

# Channel plugins (bidirectional DM bridge via --channels).
# Source of truth is external_plugins/<name>-channel/ (version-controlled).
# On start, we patch the plugin cache .mcp.json so Claude Code runs our
# local fork code with project-local state dir. No symlinks needed.
declare -A CHANNEL_PLUGINS=(
  [telegram]="plugin:telegram@claude-plugins-official"
  [discord]="plugin:discord@claude-plugins-official"
)

# Local source dirs for channel plugins
declare -A CHANNEL_LOCAL=(
  [telegram]="external_plugins/telegram-channel"
  [discord]="external_plugins/discord-channel"
)

# Broker channels (standalone polling process, no Claude Code)
declare -A BROKER_CHANNELS=(
  [slack]="external_plugins/slack-channel/broker.ts"
  [line]="external_plugins/line-channel/broker.ts"
  [line-relay]="external_plugins/line-channel/broker-relay.ts"
  [whatsapp]="external_plugins/whatsapp-channel/broker-relay.ts"
  [teams]="external_plugins/teams-channel/broker-relay.ts"
)

# Resolve the plugin cache directory for a given plugin identifier.
# plugin:telegram@claude-plugins-official → ~/.claude/plugins/cache/claude-plugins-official/telegram/
resolve_cache_base() {
  local plugin_id="$1"
  local plugin_name="${plugin_id#plugin:}"
  plugin_name="${plugin_name%%@*}"
  local plugin_org="${plugin_id##*@}"
  echo "$HOME/.claude/plugins/cache/$plugin_org/$plugin_name"
}

# Patch plugin cache: copy our fork's server.ts into the cache directory and
# update .mcp.json with the project-local state dir env var.
# Claude Code runs server.ts from cache regardless of --cwd, so we must
# overwrite the file directly. The FORK_TAG constant in server.ts identifies
# our fork in startup logs.
# Args: $1=cache_version_dir  $2=local_abs_path  $3=channel_name
patch_cache_mcp() {
  local ver_dir="$1" local_abs="$2" ch_name="$3"
  local mcp_file="$ver_dir/.mcp.json"
  local state_dir="$PROJECT_DIR/.claude/channels/$ch_name"
  local env_key="${ch_name^^}_STATE_DIR"

  # Copy fork server.ts into cache (Claude Code runs from cache, not --cwd)
  cp "$local_abs/server.ts" "$ver_dir/server.ts"

  # Fix import paths: our fork uses relative __dirname paths to lib/,
  # but cache dir has a different parent. Replace with absolute paths.
  sed -i "s|resolve(__dirname, '..', '..', 'lib', 'sessions')|'$PROJECT_DIR/lib/sessions'|" "$ver_dir/server.ts"
  sed -i "s|resolve(__dirname, '..', '..', 'lib', 'safety')|'$PROJECT_DIR/lib/safety'|" "$ver_dir/server.ts"

  cat > "$mcp_file" <<MCPEOF
{
  "mcpServers": {
    "$ch_name": {
      "command": "bun",
      "args": ["run", "--cwd", "${ver_dir}", "--shell=bun", "--silent", "start"],
      "env": {
        "$env_key": "$state_dir"
      }
    }
  }
}
MCPEOF
}

# ── Usage / help ──────────────────────────────────────────
if [[ "${1:-}" =~ ^(-h|--help|help)$ ]]; then
  cat <<EOF
Usage: ./start.sh <channel> [channel ...]

Channels (pick one per invocation):
  Channel plugins (launches Claude Code + bot in one process):
    telegram        Telegram bot (requires TELEGRAM_BOT_TOKEN)
    discord         Discord bot  (requires DISCORD_BOT_TOKEN)

  Broker channels (runs a standalone polling process, no Claude Code):
    slack           Slack polling broker   (requires SLACK_BOT_TOKEN)
    line            LINE webhook broker    (requires LINE_CHANNEL_ACCESS_TOKEN, LINE_CHANNEL_SECRET)
    line-relay      LINE relay bridge      (requires LINE_RELAY_URL, LINE_RELAY_SECRET)
    whatsapp        WhatsApp relay bridge  (requires WA_RELAY_URL, WA_RELAY_SECRET)
    teams           Teams relay bridge     (requires TEAMS_RELAY_URL, TEAMS_RELAY_SECRET)

Default: telegram (if no argument given)

Examples:
  Channel plugins (starts Claude Code + bot in one process):
    ./start.sh                  # Telegram (default)
    ./start.sh telegram         # Telegram (explicit)
    ./start.sh discord          # Discord

  Broker channels (starts a standalone broker process):
    ./start.sh slack            # Slack polling broker
    ./start.sh line-relay       # LINE relay bridge
    ./start.sh whatsapp         # WhatsApp relay bridge
    ./start.sh teams            # Teams relay bridge

Environment:
  Copy .env.example to .env and fill in the required tokens.
  See docs/<channel>/install.md for setup guides.
EOF
  exit 0
fi

CHANNELS=("${@:-telegram}")

# Check if any channel is a broker type
for ch in "${CHANNELS[@]}"; do
  broker="${BROKER_CHANNELS[$ch]:-}"
  if [[ -n "$broker" ]]; then
    # Derive state dir name: line-relay -> line (shared state with line broker)
    state_name="${ch%%-*}"
    export "${state_name^^}_STATE_DIR=$PROJECT_DIR/.claude/channels/$state_name"
    echo "Starting $ch broker..."
    exec bun run "$broker"
  fi
done

# Otherwise, use Claude Code --channels
CHANNEL_ARGS=()
for ch in "${CHANNELS[@]}"; do
  plugin="${CHANNEL_PLUGINS[$ch]:-}"
  if [[ -z "$plugin" ]]; then
    echo "Error: unknown channel '$ch'"
    echo "Available: ${!CHANNEL_PLUGINS[*]} ${!BROKER_CHANNELS[*]}"
    exit 1
  fi
  export "${ch^^}_STATE_DIR=$PROJECT_DIR/.claude/channels/$ch"
  CHANNEL_ARGS+=(--channels "$plugin")

  # Patch plugin cache .mcp.json → local fork code + project-local state dir.
  # This is idempotent and re-applied on every start (survives plugin updates).
  local_dir="${CHANNEL_LOCAL[$ch]:-}"
  if [[ -n "$local_dir" && -f "$local_dir/server.ts" ]]; then
    local_abs="$(cd "$local_dir" && pwd)"
    cache_base=$(resolve_cache_base "$plugin")

    # Install deps if node_modules is missing
    if [[ ! -d "$local_dir/node_modules" ]]; then
      echo "Installing dependencies for $ch..."
      bun install --cwd "$local_abs" --no-summary
    fi

    # Patch each cached version dir's .mcp.json
    if [[ -d "$cache_base" ]]; then
      for ver_dir in "$cache_base"/*/; do
        [[ -d "$ver_dir" ]] || continue
        # Restore original dir if a previous symlink exists
        if [[ -L "$ver_dir" ]]; then
          rm "$ver_dir"
          [[ -d "${ver_dir}.official" ]] && mv "${ver_dir}.official" "$ver_dir"
        fi
        patch_cache_mcp "$ver_dir" "$local_abs" "$ch"
        echo "Patched $(basename "$ver_dir")/server.ts + .mcp.json ← $local_abs"
      done
    else
      echo "WARNING: plugin cache not found for $ch"
      echo "  Run once: claude --channels $plugin"
      echo "  This initializes the cache, then re-run ./start.sh"
    fi
  fi
done

echo "Starting Claude Code with channel(s): ${CHANNELS[*]}"
exec claude "${CHANNEL_ARGS[@]}"
