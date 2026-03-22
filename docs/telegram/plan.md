# Claude Code Channels x Telegram Integration Plan

## Context

Using the official **Claude Code Channels** Telegram plugin to connect a Claude Code session with a Telegram Bot, enabling bidirectional communication. Outbound polling, no inbound ports.

**Architecture:**

```text
Telegram App (Mobile/Desktop)
    | (Bot API, outbound polling by plugin)
Telegram Plugin (Bun subprocess, MCP Server)
    | (stdio transport)
Claude Code Session (local, full filesystem access)
```

No inbound ports, webhooks, or external servers needed. WSL2 compatible.

---

## Prerequisites

- [x] Bun runtime (see [prerequisites](../prerequisites.md))
- [x] Claude Code v2.1.80+ (v2.1.81)
- [x] claude.ai login (not API key — required by Channels)
- [x] Telegram Bot Token (from [@BotFather](https://t.me/BotFather))

---

## Implementation Steps

### Phase 1: Create Telegram Bot

1. Open [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot`, follow prompts to create a bot
3. Copy the **Bot Token** (format: `123456789:AAH...`)
4. Optionally: `/setdescription`, `/setabouttext`, `/setuserpic`

### Phase 2: Install Telegram Plugin

Inside Claude Code session:

```text
/plugin install telegram@claude-plugins-official
```

### Phase 3: Configure Bot Token

Write the token directly to the `.env` file:

```bash
mkdir -p .claude/channels/telegram
echo "TELEGRAM_BOT_TOKEN=<YOUR_TOKEN>" > .claude/channels/telegram/.env
chmod 600 .claude/channels/telegram/.env
```

> **Warning:** Do NOT pass the token as a command argument (e.g., `/telegram:configure <token>`). This leaks the token into conversation history. See [docs/issues.md Issue #2](../issues.md).

### Phase 4: Launch with Telegram Channel

```bash
./start.sh telegram
# or multiple channels:
./start.sh telegram discord
```

Or manually:

```bash
claude --channels plugin:telegram@claude-plugins-official
```

### Phase 5: Pair Telegram Account

1. Send any message to your Bot on Telegram
2. Bot replies with a **6-character pairing code**
3. In Claude Code terminal:

   ```text
   /telegram:access pair <CODE>
   ```

4. Lock access:

   ```text
   /telegram:access policy allowlist
   ```

### Phase 6: Verify

1. **Basic test**: Send a message on Telegram, confirm Claude Code receives and replies
2. **File test**: Send an image to the Bot (downloaded to `inbox/`)
3. **Approval flow**: Test approve/reject pattern via Telegram
4. **Attachments**: Send a file, verify `download_attachment` works

---

## MCP Tools Available

| Tool                  | Description                                                                             |
| --------------------- | --------------------------------------------------------------------------------------- |
| `reply`               | Send message (`chat_id` + `text`, optional `reply_to`, `files` up to 50MB, MarkdownV2) |
| `react`               | Add emoji reaction (Telegram fixed whitelist only)                                      |
| `edit_message`        | Edit previously sent Bot message (supports MarkdownV2)                                  |
| `download_attachment` | Download file by `file_id` to `inbox/`                                                  |

**Note:** Telegram has no `fetch_messages` — only real-time inbound messages are visible. Discord has this capability.

---

## Key Differences from Discord

| Aspect          | Telegram            | Discord                      |
| --------------- | ------------------- | ---------------------------- |
| Connection      | HTTP long-polling   | WebSocket Gateway            |
| Message history | Not available       | `fetch_messages` (up to 100) |
| Attachments     | Photos auto-download, docs on-demand | Explicit `download_attachment` call |
| ID format       | Numeric chat_id     | Snowflake IDs (numeric)      |
| Group access    | Via allowlist       | Opt-in per channel ID        |
| File limit      | 50MB per file       | 25MB per file, max 10 files  |
| Emoji reactions | Fixed whitelist     | Unicode + custom             |
| Formatting      | MarkdownV2          | None                         |

---

## Permission Configuration

Add to `.claude/settings.local.json`:

```json
{
  "permissions": {
    "allow": [
      "mcp__plugin_telegram_telegram__reply"
    ]
  }
}
```

---

## Important Notes

1. **Offline messages lost**: Bot only receives messages while the session is running
2. **Permission blocking**: Non-whitelisted tool calls block the session until approved in terminal
3. **Multiple Bot instances**: Use different Bots per project by setting `TELEGRAM_STATE_DIR` to different paths
4. **WSL2 compatible**: Plugin uses outbound polling, no inbound port needed
5. **Persistent session**: Use `tmux` or `screen` to keep the session alive

---

## Key Files

| File                                       | Purpose                                 |
| ------------------------------------------ | --------------------------------------- |
| `.claude/channels/telegram/.env`           | `TELEGRAM_BOT_TOKEN` (gitignored)       |
| `.claude/channels/telegram/access.json`    | Access control & allowlist (gitignored) |
| `.claude/channels/telegram/inbox/`         | Downloaded attachments (gitignored)     |
| `docs/telegram/plan.md`                   | This planning document                  |
| `docs/telegram/install.md`                | Post-installation notes                 |
