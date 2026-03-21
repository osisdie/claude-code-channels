# Claude Code x Discord Channel - Installation & Integration Notes

## Overview

This document records the actual installation and integration experience of connecting Claude Code to Discord via the official Channels plugin (research preview, 2026/03).

**Environment:**

- OS: WSL2 (Linux 6.6.87.2-microsoft-standard-WSL2)
- Claude Code: v2.1.81
- Model: Claude Opus 4.6 (1M context)
- Runtime: Bun

---

## Installation Steps (Executed)

### 1. Create Discord Bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application**, name it
3. Navigate to **Bot** section:
   - Create username
   - Click **Reset Token** and copy (shown only once)
   - Enable **Message Content Intent** under Privileged Gateway Intents
4. Navigate to **OAuth2 > URL Generator**:
   - Scope: `bot`
   - Permissions: View Channels, Send Messages, Send Messages in Threads, Read Message History, Attach Files, Add Reactions
   - Integration type: **Guild Install**
5. Open generated URL to add bot to your server

### 2. Install Discord Plugin

Inside a Claude Code session:

```text
/plugin marketplace add anthropics/claude-plugins-official
/plugin install discord@claude-plugins-official
```

### 3. Configure Bot Token

Write the token directly to the `.env` file:

```bash
mkdir -p .claude/channels/discord
echo "DISCORD_BOT_TOKEN=<YOUR_TOKEN>" > .claude/channels/discord/.env
chmod 600 .claude/channels/discord/.env
```

> **Warning:** Do NOT pass the token as a command argument (e.g., `/discord:configure <token>`). This leaks the token into conversation history. Write it to the `.env` file directly instead.

### 4. Launch with Channels

```bash
./start.sh discord
# or both channels:
./start.sh telegram discord
```

### 5. Pair Discord Account

1. DM the Bot on Discord
2. Bot replies with a **6-character pairing code**
3. In Claude Code terminal:

   ```text
   /discord:access pair <CODE>
   ```

4. Bot confirms: "Paired! Say hi to Claude."
5. Lock access to allowlist only:

   ```text
   /discord:access policy allowlist
   ```

---

## Verified Features

### Basic Messaging (Bidirectional)

| Direction              | How                                                      | Status   |
| ---------------------- | -------------------------------------------------------- | -------- |
| Discord -> Claude Code | User DMs Bot, appears as `<channel>` in session          | Verified |
| Claude Code -> Discord | `mcp__plugin_discord_discord__reply` tool with `chat_id` | Verified |

### MCP Tools Available

| Tool                  | Description                                                                         | Tested |
| --------------------- | ----------------------------------------------------------------------------------- | ------ |
| `reply`               | Send message to Discord (supports text, file attachments up to 25MB, max 10 files) | Yes    |
| `react`               | Add emoji reaction (unicode or custom `<:name:id>`)                                 | -      |
| `edit_message`        | Edit a previously sent Bot message                                                  | -      |
| `fetch_messages`      | Pull up to 100 recent messages (oldest-first)                                       | -      |
| `download_attachment` | Download file attached to incoming message                                          | -      |

**Note:** Discord plugin has `fetch_messages` which Telegram does not — allows reading recent channel history.

### Approval Flow via Discord

Same pattern as Telegram:

1. Claude Code sends an approval request to Discord via `reply`
2. Session pauses, waiting for next conversation turn
3. User replies `approve` or `reject` on Discord
4. Reply arrives as a `<channel>` message in the session
5. Claude Code proceeds based on the response

---

## Permission Configuration

### Whitelisted Tools (`.claude/settings.local.json`)

Add Discord reply to the permission whitelist so the Bot can always respond:

```json
{
  "permissions": {
    "allow": [
      "mcp__plugin_discord_discord__reply"
    ]
  }
}
```

---

## Architecture

```text
Discord App (Desktop/Mobile/Web)
    | (WebSocket Gateway, plugin connects outbound)
Discord Plugin (Bun subprocess, MCP Server)
    | (stdio transport)
Claude Code Session (local, full filesystem access)
```

- **No inbound ports needed** - plugin connects outbound via WebSocket
- **WSL2 compatible** - no firewall configuration required
- **No external server** - everything runs locally

---

## Key Files

| File                                       | Purpose                              |
| ------------------------------------------ | ------------------------------------ |
| `start.sh`                                 | Launch script with `--channels` flag |
| `.env.example`                             | Template for environment variables   |
| `.gitignore`                               | Excludes secrets, channel state, local settings |
| `.claude/settings.local.json`              | Permission whitelist (gitignored)    |
| `.claude/channels/discord/.env`            | Bot token (gitignored)               |
| `.claude/channels/discord/access.json`     | Access control & allowlist (gitignored) |
| `docs/discord/plan.md`                     | Planning document                    |
| `docs/discord/install.md`                  | This document                        |
| `docs/discord/issue.md`                    | Known issues                         |

---

## Key Differences from Telegram

| Aspect          | Telegram          | Discord                      |
| --------------- | ----------------- | ---------------------------- |
| Connection      | HTTP long-polling | WebSocket Gateway            |
| Message history | Not available     | `fetch_messages` (up to 100) |
| ID format       | Numeric chat_id   | Snowflake IDs (numeric)      |
| Group access    | Via allowlist     | Opt-in per channel ID        |
| File limit      | 50MB per file     | 25MB per file, max 10 files  |

---

## Gotchas & Lessons Learned

1. **Offline messages are lost** - Bot only receives messages while the session is running
2. **Permission blocking** - Non-whitelisted tool calls block the session until approved in terminal; whitelist frequently-used safe tools
3. **State directory path mismatch** - See [issue.md](issue.md) for details on the `DISCORD_STATE_DIR` vs skill path mismatch
4. **Token security** - Never pass bot tokens as command arguments; write directly to `.env` file
5. **Bot API rate limits** - Discord has stricter rate limits than Telegram; the plugin handles this internally
