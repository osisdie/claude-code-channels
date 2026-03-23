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
)

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
