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

# Channel plugins (bidirectional DM bridge via --channels)
declare -A CHANNEL_PLUGINS=(
  [telegram]="plugin:telegram@claude-plugins-official"
  [discord]="plugin:discord@claude-plugins-official"
  # [line]="plugin:line@claude-plugins-official"
)

# MCP-only plugins (tool integrations, no --channels flag)
# These are installed globally via /plugin install and loaded automatically.
# Slack: outbound only (search, send, canvas) — not a channel plugin.
# See docs/slack/plan.md and docs/issues.md Issue #3.

CHANNELS=("${@:-telegram}")

CHANNEL_ARGS=""
for ch in "${CHANNELS[@]}"; do
  plugin="${CHANNEL_PLUGINS[$ch]:-}"
  if [[ -z "$plugin" ]]; then
    echo "Error: unknown channel '$ch' (not a channel plugin)"
    echo "Available channels: ${!CHANNEL_PLUGINS[*]}"
    echo "Note: Slack is an MCP plugin (outbound only), not a channel. Use /slack:* commands inside a session."
    exit 1
  fi
  export "${ch^^}_STATE_DIR=$PROJECT_DIR/.claude/channels/$ch"
  CHANNEL_ARGS+=" --channels $plugin"
done

echo "Starting Claude Code with channel(s): ${CHANNELS[*]}"
exec claude $CHANNEL_ARGS
