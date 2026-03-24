#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

# Channel plugins (bidirectional DM bridge via --channels)
declare -A CHANNEL_PLUGINS=(
  [telegram]="plugin:telegram@claude-plugins-official"
  [discord]="plugin:discord@claude-plugins-official"
)

# Broker channels (standalone polling, no --channels needed)
declare -A BROKER_CHANNELS=(
  [slack]="external_plugins/slack-channel/broker.ts"
  [line]="external_plugins/line-channel/broker.ts"
  [line-relay]="external_plugins/line-channel/broker-relay.ts"
  [whatsapp]="external_plugins/whatsapp-channel/broker-relay.ts"
  [teams]="external_plugins/teams-channel/broker-relay.ts"
)

# ── Usage / help ──────────────────────────────────────────
if [[ "${1:-}" =~ ^(-h|--help|help)$ ]]; then
  cat <<EOF
Usage: ./start.sh <channel> [channel ...]

Channels (pick one per invocation):
  Channel plugins (bidirectional DM via Claude Code --channels):
    telegram        Telegram bot (requires TELEGRAM_BOT_TOKEN)
    discord         Discord bot  (requires DISCORD_BOT_TOKEN)

  Broker channels (standalone process, no --channels flag):
    slack           Slack polling broker   (requires SLACK_BOT_TOKEN)
    line            LINE webhook broker    (requires LINE_CHANNEL_ACCESS_TOKEN, LINE_CHANNEL_SECRET)
    line-relay      LINE relay bridge      (requires LINE_RELAY_URL, LINE_RELAY_SECRET)
    whatsapp        WhatsApp relay bridge  (requires WA_RELAY_URL, WA_RELAY_SECRET)
    teams           Teams relay bridge     (requires TEAMS_RELAY_URL, TEAMS_RELAY_SECRET)

Default: telegram (if no argument given)

Examples:
  ./start.sh                  # start Telegram channel
  ./start.sh slack            # start Slack broker
  ./start.sh line-relay       # start LINE relay bridge
  ./start.sh whatsapp         # start WhatsApp relay bridge
  ./start.sh teams            # start Teams relay bridge
  ./start.sh discord          # start Discord channel

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
CHANNEL_ARGS=""
for ch in "${CHANNELS[@]}"; do
  plugin="${CHANNEL_PLUGINS[$ch]:-}"
  if [[ -z "$plugin" ]]; then
    echo "Error: unknown channel '$ch'"
    echo "Available: ${!CHANNEL_PLUGINS[*]} ${!BROKER_CHANNELS[*]}"
    exit 1
  fi
  export "${ch^^}_STATE_DIR=$PROJECT_DIR/.claude/channels/$ch"
  CHANNEL_ARGS+=" --channels $plugin"
done

echo "Starting Claude Code with channel(s): ${CHANNELS[*]}"
exec claude $CHANNEL_ARGS
