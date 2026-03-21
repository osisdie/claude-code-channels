#!/usr/bin/env bash
# Launch Claude Code with specified channel(s)
#
# Usage:
#   ./start.sh                    # default: telegram
#   ./start.sh telegram           # single channel
#   ./start.sh telegram discord   # multiple channels
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

# Channel -> plugin mapping
declare -A CHANNEL_PLUGINS=(
  [telegram]="plugin:telegram@claude-plugins-official"
  [discord]="plugin:discord@claude-plugins-official"
  # [slack]="plugin:slack@claude-plugins-official"
  # [line]="plugin:line@claude-plugins-official"
)

CHANNELS=("${@:-telegram}")

CHANNEL_ARGS=""
for ch in "${CHANNELS[@]}"; do
  plugin="${CHANNEL_PLUGINS[$ch]:-}"
  if [[ -z "$plugin" ]]; then
    echo "Error: unknown channel '$ch'"
    echo "Available: ${!CHANNEL_PLUGINS[*]}"
    exit 1
  fi
  export "${ch^^}_STATE_DIR=$PROJECT_DIR/.claude/channels/$ch"
  CHANNEL_ARGS+=" --channels $plugin"
done

echo "Starting Claude Code with channel(s): ${CHANNELS[*]}"
exec claude $CHANNEL_ARGS
