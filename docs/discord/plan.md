# Claude Code Channels x Discord Integration Plan

## Context

Using the official **Claude Code Channels** Discord plugin to connect Claude Code session with a Discord Bot, enabling bidirectional communication. Same architecture as Telegram: outbound polling, no inbound ports.

**Architecture:**
```
Discord App (Desktop/Mobile/Web)
    | (WebSocket Gateway, plugin connects outbound)
Discord Plugin (Bun subprocess, MCP Server)
    | (stdio transport)
Claude Code Session (local, full filesystem access)
```

---

## Prerequisites

- [x] Bun runtime (already installed for Telegram)
- [x] Claude Code v2.1.80+ (v2.1.81)
- [ ] Discord Bot Token (from Discord Developer Portal)
- [ ] Discord Bot added to target server with correct permissions

---

## Implementation Steps

### Phase 1: Create Discord Bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application**, name it
3. Navigate to **Bot** section:
   - Create username
   - Click **Reset Token** and copy (shown only once)
   - Enable **Message Content Intent** under Privileged Gateway Intents
4. Navigate to **OAuth2 > URL Generator**:
   - Scope: `bot`
   - Permissions:
     - View Channels
     - Send Messages
     - Send Messages in Threads
     - Read Message History
     - Attach Files
     - Add Reactions
   - Integration type: **Guild Install**
5. Open generated URL to add bot to your server

### Phase 2: Install Discord Plugin

Inside Claude Code session:
```
/plugin install discord@claude-plugins-official
/discord:configure <DISCORD_BOT_TOKEN>
```

Token stored at project-level: `.claude/channels/discord/.env`

### Phase 3: Launch with Discord Channel

Update `start.sh` to support discord:
```bash
./start.sh discord
# or both channels:
./start.sh telegram discord
```

### Phase 4: Pair Discord Account

1. DM the Bot on Discord
2. Bot replies with a **pairing code**
3. In Claude Code terminal:
   ```
   /discord:access pair <CODE>
   ```
4. Lock access:
   ```
   /discord:access policy allowlist
   ```

### Phase 5: Verify

1. **Basic test**: DM the Bot, confirm Claude Code receives and replies
2. **Guild channel**: Opt-in a server channel by its ID
3. **Approval flow**: Test approve/reject pattern via Discord
4. **Attachments**: Send a file, verify `download_attachment` works

---

## MCP Tools Available

| Tool | Description |
|------|-------------|
| `reply` | Send message to channel (`chat_id` + `text`, optional `reply_to`, `files` max 10/25MB each) |
| `react` | Add emoji reaction (unicode or custom `<:name:id>`) |
| `edit_message` | Edit previously sent Bot message |
| `fetch_messages` | Pull up to 100 recent messages (oldest-first, includes message IDs) |
| `download_attachment` | Download attachments from a message to `inbox/` |

**Note:** Discord plugin has `fetch_messages` which Telegram does not — allows reading recent channel history.

---

## Key Differences from Telegram

| Aspect | Telegram | Discord |
|--------|----------|---------|
| Connection | HTTP long-polling | WebSocket Gateway |
| Message history | Not available | `fetch_messages` (up to 100) |
| Attachments | Auto-download? | Explicit `download_attachment` call |
| ID format | Numeric chat_id | Snowflake IDs (numeric) |
| Group access | Via allowlist | Opt-in per channel ID |
| File limit | 50MB per file | 25MB per file, max 10 files |

---

## Permission Configuration

Add to `.claude/settings.local.json`:
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

## Key Files

| File | Purpose |
|------|---------|
| `.claude/channels/discord/.env` | `DISCORD_BOT_TOKEN` (gitignored) |
| `.claude/channels/discord/access.json` | Access control & allowlist (gitignored) |
| `.claude/channels/discord/inbox/` | Downloaded attachments (gitignored) |
| `docs/discord/plan.md` | This planning document |
| `docs/discord/install.md` | Post-installation notes (to be created) |
