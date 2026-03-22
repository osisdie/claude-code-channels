# Claude Code x Slack - Installation & Integration Notes

## Overview

This document records the actual installation and integration experience of connecting Claude Code to Slack via the official plugin (2026/03).

**Important:** The `slack@claude-plugins-official` plugin is an **MCP tool integration** (outbound only), not a **channel plugin** like Discord/Telegram. It cannot receive inbound DMs or act as a bidirectional bridge. See [docs/issues.md Issue #3](../issues.md) for details.

**Environment:**

- OS: WSL2 (Linux 6.6.87.2-microsoft-standard-WSL2)
- Claude Code: v2.1.81
- Runtime: Bun
- Plugin: `slack@claude-plugins-official` v1.0.0
- Source: [slackapi/slack-mcp-cursor-plugin](https://github.com/slackapi/slack-mcp-cursor-plugin)

---

## Plugin Architecture (MCP, Not Channel)

```text
Claude Code Session
    | (MCP tool call)
Slack MCP Plugin (HTTP client)
    | (OAuth + HTTPS)
mcp.slack.com (Slack's MCP server)
    | (Slack Web API)
Slack Workspace
```

| Aspect | Channel plugins (Discord/Telegram) | Slack MCP plugin |
| ------ | ----------------------------------- | ---------------- |
| Type | `claude/channel` capability | MCP tools via HTTP |
| Direction | Bidirectional (DM bridge) | Outbound only |
| Connection | Bot Token -> local `server.ts` | OAuth -> `mcp.slack.com` |
| Launch | `./start.sh discord` | Auto-loaded in session |
| Auth | `.env` file (Bot Token) | OAuth (browser) |
| Pairing | Yes (`/channel:access pair`) | No |

---

## Installation Steps (Executed)

### 1. Create Slack App

1. Go to [Slack API -- Your Apps](https://api.slack.com/apps)
2. Click **Create New App** > **From scratch**
3. Name: `Claude Code Bot`, select workspace
4. Navigate to **OAuth & Permissions** > **Bot Token Scopes**, add:
   - `chat:write` -- send messages
   - `channels:read`, `channels:history` -- read channels
   - `im:read`, `im:write`, `im:history` -- DM access
   - `files:read`, `files:write` -- file sharing
   - `reactions:write` -- emoji reactions
   - `users:read` -- user info lookup
5. **Install to Workspace** and copy **Bot User OAuth Token** (`xoxb-*`)

### 2. Enable DM with Bot (Required for smoke test)

1. In Slack App settings, navigate to **App Home**
2. Under **Show Tabs**, enable **Messages Tab**
3. Check: **"Allow users to send Slash commands and messages from the messages tab"**
4. **Reinstall** the app if prompted

### 3. Enable Socket Mode (For future channel plugin)

> This step is optional for the current MCP plugin but prepares for a future channel plugin.

1. Navigate to **Socket Mode** in app settings
2. Toggle **Enable Socket Mode** ON
3. Generate an **App-Level Token** (`xapp-*`) with `connections:write` scope
4. Navigate to **Event Subscriptions** > enable, add **Bot Events**: `message.im`

### 4. Store Tokens

Write tokens to project-level `.env` (gitignored):

```bash
# Project root .env
echo "SLACK_BOT_TOKEN=xoxb-..." >> .env
echo "SLACK_APP_TOKEN=xapp-..." >> .env
chmod 600 .env
```

> **Warning:** Do NOT pass tokens as command arguments. They leak into conversation history. See [docs/issues.md Issue #2](../issues.md).

### 5. Install Slack Plugin

Inside a Claude Code session:

```text
/plugin install slack@claude-plugins-official
```

On first use of any `/slack:*` command, you will be prompted to authenticate via OAuth in your browser.

### 6. Verify Tokens

Run the verification script:

```bash
./scripts/verify_slack.sh
```

Or manually:

```bash
# Verify Bot Token
source .env
curl -s -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  https://slack.com/api/auth.test | python3 -m json.tool

# Verify App Token (Socket Mode)
curl -s -H "Authorization: Bearer $SLACK_APP_TOKEN" \
  -X POST https://slack.com/api/apps.connections.open | python3 -m json.tool
```

---

## Verified Features

### MCP Plugin (Outbound)

| Feature | Command / Skill | Status |
| ------- | --------------- | ------ |
| Send message | `/slack:slack-messaging` | Verified |
| Search messages | `/slack:slack-search` | Available |
| Summarize channel | `/slack:summarize-channel` | Available |
| Channel digest | `/slack:channel-digest` | Available |
| Find discussions | `/slack:find-discussions` | Available |
| Generate standup | `/slack:standup` | Available |
| Draft announcement | `/slack:draft-announcement` | Available |

### Direct API (Bot Token)

| Feature | API | Status |
| ------- | --- | ------ |
| `auth.test` | Verify bot identity | Verified |
| `apps.connections.open` | Verify Socket Mode | Verified |
| `conversations.list` (type=im) | List DM channels | Verified |
| `users.info` | Resolve user ID to name | Verified |
| `chat.postMessage` | Send message to DM | Verified |

### Smoke Test Results

```text
Bot identity:  claude_code (U0AMVM0FJTD) on osisdie.slack.com
Bot name:      Claude Code Bot (B0ANWB1933J)
DM channels:   3 (bot self, user osisdie, Slackbot)
User DM:       D0AN5L9LEUC -> osisdie (UMU9QLY79)
Send message:  ok (to user DM)
Socket Mode:   ok (WSS URL returned)
```

---

## Bidirectional DM: Not Supported Yet

DMing the bot shows "Sending messages to this app has been turned off" until the **Messages Tab** is enabled (Step 2 above). Even after enabling, the bot receives your DMs at the Slack API level but **does not forward them to Claude Code** because:

1. The Slack plugin has **no `server.ts`** (no local process listening for events)
2. It has **no `claude/channel` capability** (no MCP notification bridge)
3. It connects to `mcp.slack.com` via HTTP, not to Slack's Socket Mode WebSocket

A true bidirectional Slack channel would require a new plugin. See [docs/slack/plan.md](plan.md) for the proposed architecture.

---

## Key Files

| File | Purpose |
| ---- | ------- |
| `.env` | `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN` (gitignored) |
| `scripts/verify_slack.sh` | Token verification & smoke test script |
| `docs/slack/plan.md` | Integration plan & future channel architecture |
| `docs/slack/install.md` | This document |
| `docs/issues.md` | Known issues (Issue #3: Slack not a channel) |

---

## Gotchas & Lessons Learned

1. **Not a channel plugin** -- `slack@claude-plugins-official` is MCP tools only (outbound). Cannot receive DMs or act as bidirectional bridge. See [Issue #3](../issues.md)
2. **Messages Tab must be enabled** -- Without it, users see "Sending messages to this app has been turned off" when trying to DM the bot
3. **OAuth vs Bot Token** -- The MCP plugin uses OAuth to `mcp.slack.com`. The Bot Token (`xoxb-*`) is for direct API calls and future channel plugin use
4. **Two tokens needed** -- Bot Token (`xoxb-*`) for API actions, App-Level Token (`xapp-*`) for Socket Mode. Both stored in `.env`
5. **`./start.sh slack` will error** -- Slack is not in the channel plugins map. Use `/slack:*` commands inside any Claude Code session instead
6. **Token leakage** -- Same as Discord/Telegram: never pass tokens as slash command arguments
