# Claude Code x Slack - Installation & Integration Notes

## Overview

Slack integration uses a **message broker** that polls Slack DMs, forwards them to `claude` CLI, and replies with the response. This is different from Telegram/Discord which use Claude Code's built-in `--channels` plugin system.

**Why a broker?** The official `slack@claude-plugins-official` is an MCP tool integration (outbound only), and Claude Code's `--channels server:` mode has a bug where dev channels are never approved (see [Issue #4](../issues.md)). The broker bypasses both limitations.

**Architecture:**

```text
Slack App (Desktop/Mobile/Web)
    | (Slack Web API, polling by broker)
Slack Broker (Bun process)
    | (subprocess: claude -p)
Claude CLI (stateless, per-message)
```

**Environment:**

- OS: WSL2 (Linux 6.6.87.2-microsoft-standard-WSL2)
- Claude Code: v2.1.81
- Runtime: Bun
- Broker: `external_plugins/slack-channel/broker.ts`

---

## Installation Steps

### 1. Create Slack App

1. Go to [Slack API -- Your Apps](https://api.slack.com/apps)
2. Click **Create New App** > **From scratch**
3. Name: `Claude Code Bot`, select workspace
4. Navigate to **OAuth & Permissions** > **Bot Token Scopes**, add:
   - `chat:write` -- send messages
   - `channels:read`, `channels:history` -- read public channels
   - `im:read`, `im:write`, `im:history` -- DM access
   - `files:read`, `files:write` -- file sharing
   - `reactions:write` -- emoji reactions
   - `users:read` -- user info lookup
5. **Install to Workspace** and copy **Bot User OAuth Token** (`xoxb-*`)

### 2. Enable DM with Bot

1. In Slack App settings, navigate to **App Home**
2. Under **Show Tabs**, enable **Messages Tab**
3. Check: **"Allow users to send Slash commands and messages from the messages tab"**
4. **Reinstall** the app if prompted

Without this, users see "Sending messages to this app has been turned off".

### 3. Store Token

Write the Bot Token to project-level `.env` (gitignored):

```bash
echo "SLACK_BOT_TOKEN=xoxb-..." >> .env
chmod 600 .env
```

> **Warning:** Do NOT pass tokens as command arguments. They leak into conversation history. See [Issue #2](../issues.md).

### 4. Verify Token

```bash
./scripts/verify_slack.sh
```

Expected output:

```text
========================================
  SLACK VERIFICATION
========================================

--- 1. Bot Token (auth.test) ---
  Bot: claude_code (U0AMVM0FJTD) on osisdie
[PASS] Bot Token valid
...
  RESULT: 4 passed, 0 failed, 0 warnings
========================================
```

### 5. Set Up Access Control

Create `access.json` to control who can DM the bot:

```bash
mkdir -p .claude/channels/slack

# Find your Slack user ID:
# Go to your Slack profile > ... > Copy member ID
# Or run: ./scripts/verify_slack.sh (shows user IDs in DM list)

cat > .claude/channels/slack/access.json << 'EOF'
{
  "dmPolicy": "allowlist",
  "allowFrom": ["YOUR_SLACK_USER_ID"],
  "groups": {},
  "pending": {}
}
EOF
```

If `allowFrom` is empty (`[]`), **all users** who DM the bot will get responses.

### 6. Launch

```bash
./start.sh slack
```

This runs the broker which:

1. Connects to Slack using the Bot Token
2. Polls DM channels every 5 seconds
3. For each new message from an allowed user:
   - Reacts with 👀 (processing)
   - Downloads any attached images
   - Runs `claude -p --output-format text "<message>"`
   - Replies in a thread
   - Reacts with ✅ (done) or ❌ (error)

---

## How It Works

### Message Flow

```text
1. User DMs bot on Slack
2. Broker polls conversations.history, finds new message
3. Broker downloads attached files (images, etc.) to inbox/
4. Broker spawns: claude -p --output-format text "user message + file paths"
5. Claude CLI processes and returns text response
6. Broker sends response as threaded reply on Slack
7. Cursor updated — message won't be processed again
```

### Polling vs Socket Mode

The broker uses **polling** (Slack Web API) instead of Socket Mode because:

- No `SLACK_APP_TOKEN` needed (only `SLACK_BOT_TOKEN`)
- Simpler — no WebSocket connection management
- Resilient — missed polls just get picked up next cycle
- Trade-off: 5-second latency (configurable via `POLL_INTERVAL`)

### Image/File Handling

When a Slack message includes files:

1. Broker downloads them via `url_private` (with Bot Token auth)
2. Saves to `.claude/channels/slack/inbox/`
3. Includes file paths in the prompt sent to Claude
4. Claude can read/analyze the files

### Access Control

The broker reads `.claude/channels/slack/access.json`:

- `allowFrom: ["U12345"]` -- only these Slack user IDs can interact
- `allowFrom: []` -- anyone who DMs the bot gets a response
- Bot's own messages and Slackbot are always skipped

### Cursor Tracking

The broker saves `broker_cursors.json` to track the last processed message per DM channel. On restart, it picks up from where it left off (not from scratch).

---

## Configuration

| Variable | Default | Description |
| -------- | ------- | ----------- |
| `SLACK_BOT_TOKEN` | (required) | Bot User OAuth Token (`xoxb-*`) |
| `SLACK_STATE_DIR` | `.claude/channels/slack` | State directory for access, cursors, inbox |
| `POLL_INTERVAL` | `5` | Seconds between polls |
| `CLAUDE_BIN` | `claude` | Path to claude CLI binary |

---

## Verified Features

| Feature | Status |
| ------- | ------ |
| Text DM → Claude → threaded reply | Verified |
| Image attachment download + analysis | Verified |
| Access control (allowlist) | Verified |
| Ack reaction (👀) + done (✅) / error (❌) | Verified |
| Cursor persistence across restarts | Verified |
| Multi-chunk responses (>4000 chars) | Verified |
| Verify script (`scripts/verify_slack.sh`) | Verified |

---

## Key Files

| File | Purpose |
| ---- | ------- |
| `external_plugins/slack-channel/broker.ts` | Slack message broker |
| `scripts/verify_slack.sh` | Token verification & smoke test |
| `.env` | `SLACK_BOT_TOKEN` (gitignored) |
| `.claude/channels/slack/access.json` | Access control (gitignored) |
| `.claude/channels/slack/broker_cursors.json` | Poll cursor state (gitignored) |
| `.claude/channels/slack/inbox/` | Downloaded attachments (gitignored) |
| `docs/slack/design.md` | Channel plugin design (future) |

---

## Differences from Telegram/Discord

| Aspect | Telegram / Discord | Slack |
| ------ | ------------------ | ----- |
| Integration | Claude Code `--channels` plugin | Standalone broker |
| Claude invocation | In-session (stateful) | `claude -p` per message (stateless) |
| Connection | Plugin's MCP server | Slack Web API polling |
| Latency | Real-time | ~5s poll interval |
| Session context | Shared across messages | Independent per message |
| Token type | Bot Token only | Bot Token only |
| Launch | `./start.sh telegram` | `./start.sh slack` |

---

## Gotchas & Lessons Learned

1. **Stateless per message** -- Each DM spawns a fresh `claude -p` call. No conversation context between messages (unlike Telegram/Discord which share a session)
2. **Messages Tab required** -- Must enable in App Home settings, then reinstall the app
3. **`conversations.list` needs GET** -- Slack's API returns wrong results if called with POST JSON for list/history endpoints
4. **Claude Code `--channels server:` is broken** -- Dev channels are never approved due to a Claude Code bug. The broker bypasses this entirely. See [Issue #4](../issues.md)
5. **Poll interval** -- Default 5s. Set `POLL_INTERVAL=2` for faster response, but watch Slack rate limits
6. **First run processes old messages** -- On first launch with no cursor file, processes recent messages. Delete `broker_cursors.json` to reprocess
