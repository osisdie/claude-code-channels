# Claude Code x Telegram Channel - Installation & Integration Notes

## Overview

This document records the actual installation and integration experience of connecting Claude Code to Telegram via the official Channels plugin (research preview, 2026/03).

**Environment:**

- OS: WSL2 (Linux 6.6.87.2-microsoft-standard-WSL2)
- Claude Code: v2.1.81
- Model: Claude Opus 4.6 (1M context)
- Runtime: Bun

---

## Installation Steps (Executed)

### 1. Install Bun

```bash
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc
bun --version
```

### 2. Install Telegram Plugin

Inside a Claude Code session:

```text
/plugin marketplace add anthropics/claude-plugins-official
/plugin install telegram@claude-plugins-official
```

### 3. Configure Bot Token

```text
/telegram:configure <BOT_TOKEN>
```

Token is stored at `~/.claude/channels/telegram/.env` (or project-level `.claude/channels/telegram/.env` if `TELEGRAM_STATE_DIR` is set).

### 4. Launch with Channels

```bash
claude --channels plugin:telegram@claude-plugins-official
```

Or use the project's `start.sh`:

```bash
./start.sh
```

### 5. Pair Telegram Account

1. Send any message to the Bot on Telegram
2. Bot replies with a **6-digit pairing code**
3. In Claude Code terminal:

   ```text
   /telegram:access pair <CODE>
   ```

4. Lock access to allowlist only:

   ```text
   /telegram:access policy allowlist
   ```

---

## Verified Features

### Basic Messaging (Bidirectional)

| Direction               | How                                                          | Status   |
| ----------------------- | ------------------------------------------------------------ | -------- |
| Telegram -> Claude Code | User sends message to Bot, appears as `<channel>` in session | Verified |
| Claude Code -> Telegram | `mcp__plugin_telegram_telegram__reply` tool with `chat_id`   | Verified |

### MCP Tools Available

| Tool                  | Description                                                                        | Tested |
| --------------------- | ---------------------------------------------------------------------------------- | ------ |
| `reply`               | Send message to Telegram (supports text, MarkdownV2, file attachments up to 50MB) | Yes    |
| `react`               | Add emoji reaction to a message                                                    | -      |
| `edit_message`        | Edit a previously sent Bot message                                                 | -      |
| `download_attachment` | Download file attached to incoming message                                         | -      |

### Reply Threading

Use `reply_to` parameter with a `message_id` to thread replies to specific messages:

```text
reply(chat_id="...", text="...", reply_to="13")
```

### Approval Flow via Telegram

A key pattern tested: using Telegram as a human-in-the-loop approval channel.

**Flow:**

1. Claude Code sends an approval request to Telegram via `reply`
2. Session pauses, waiting for next conversation turn
3. User replies `approve` or `reject` on Telegram
4. Reply arrives as a `<channel>` message in the session
5. Claude Code proceeds based on the response and reports result back

**Example approval request:**

```text
Action: Execute command echo "Hello from approval test"
Environment: Local session
Risk: Low

Please reply:
approve - to proceed
reject - to cancel
```

**Characteristics:**

- "Soft wait" - session waits for the next conversation turn (Telegram or local terminal input)
- No built-in timeout mechanism; session stays idle until input arrives
- Works well for CI/CD approval gates, deployment confirmations, etc.

---

## Permission Configuration

### Whitelisted Tools (`.claude/settings.local.json`)

Commands auto-approved without user confirmation:

```json
{
  "permissions": {
    "allow": [
      "Bash(npm list:*)",
      "Bash(pip list:*)",
      "Bash(bun --version)",
      "Bash(claude --version)",
      "Bash(npm config:*)",
      "WebSearch",
      "mcp__plugin_telegram_telegram__reply"
    ]
  }
}
```

Key: `mcp__plugin_telegram_telegram__reply` is whitelisted so the Bot can always respond without blocking on permission prompts.

Commands **not** whitelisted will trigger an approval prompt in the terminal (or can be routed through the Telegram approval flow described above).

---

## Architecture

```text
Telegram App (Mobile/Desktop)
    | (Bot API, outbound polling by plugin)
    v
Telegram Plugin (Bun subprocess, MCP Server)
    | (stdio transport)
    v
Claude Code Session (local, full filesystem access)
```

- **No inbound ports needed** - plugin polls Telegram API outbound
- **WSL2 compatible** - no firewall configuration required
- **No external server** - everything runs locally

---

## Key Files

| File                                        | Purpose                                        |
| ------------------------------------------- | ---------------------------------------------- |
| `start.sh`                                  | Launch script with `--channels` flag           |
| `.env.example`                              | Template for environment variables             |
| `.gitignore`                                | Excludes secrets, channel state, local settings |
| `.claude/settings.local.json`               | Permission whitelist (gitignored)              |
| `.claude/channels/telegram/.env`            | Bot token (gitignored)                         |
| `.claude/channels/telegram/access.json`     | Access control & allowlist (gitignored)        |
| `docs/claude_code_channel_telegram_plan.md` | Original planning document                     |

---

## Gotchas & Lessons Learned

1. **Offline messages are lost** - Bot only receives messages while the session is running
2. **Permission blocking** - Non-whitelisted tool calls block the session until approved in terminal; whitelist frequently-used safe tools
3. **State directory** - Set `TELEGRAM_STATE_DIR` to project-level path for per-project isolation
4. **Bot API limitation** - No message history or search; only real-time messages are visible
5. **MarkdownV2 formatting** - Requires escaping special characters per Telegram's rules; use `format: "text"` for plain messages to avoid issues
