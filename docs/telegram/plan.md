# Claude Code Channels x Telegram Integration Plan

## Context

Using the official **Claude Code Channels** (2026/3/20 research preview) to connect a Claude Code session with a Telegram Bot for bidirectional communication: send commands from Telegram to Claude Code, receive results back on Telegram.

**Architecture:**

```text
Telegram App (Mobile/Desktop)
    | (Bot API, outbound polling by plugin)
Telegram Plugin (Bun subprocess, MCP Server)
    | (stdio transport)
Claude Code Session (local, full filesystem access)
```

No inbound ports, webhooks, or external servers needed. Plugin polls Telegram API outbound, so no firewall config required under WSL2.

---

## Prerequisites

- [x] Telegram Bot Token
- [x] Bun runtime installed
- [x] Claude Code v2.1.80+ (v2.1.81)
- [x] claude.ai login (not API key — required by Channels)

---

## Implementation Steps

### Phase 1: Install Bun

```bash
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc
bun --version
```

### Phase 2: Install Telegram Plugin

Start a Claude Code session:

```bash
claude
```

Inside the session:

```text
/plugin marketplace add anthropics/claude-plugins-official
/plugin install telegram@claude-plugins-official
```

### Phase 3: Configure Bot Token

Inside Claude Code session:

```text
/telegram:configure <YOUR_BOT_TOKEN>
```

This writes the token to `~/.claude/channels/telegram/.env`.

Alternatively, set the environment variable (takes precedence over .env):

```bash
export TELEGRAM_BOT_TOKEN="your-token"
```

### Phase 4: Launch with Channels

Using the launcher script:

```bash
./start.sh telegram
```

Or manually:

```bash
claude --channels plugin:telegram@claude-plugins-official
```

### Phase 5: Pair Telegram Account

1. Send any message to your Bot on Telegram
2. Bot replies with a **6-digit pairing code**
3. In Claude Code terminal:

   ```text
   /telegram:access pair <CODE>
   ```

4. Lock access (allow paired accounts only):

   ```text
   /telegram:access policy allowlist
   ```

### Phase 6: Verification

1. **Basic test**: Send `What files are in my working directory?` on Telegram, confirm Claude Code receives and replies
2. **File test**: Send an image to the Bot (downloaded to `~/.claude/channels/telegram/inbox/`)
3. **Tool check**: Plugin provides three MCP tools:
   - `reply` — Send messages (auto-chunks long text, supports up to 50MB attachments)
   - `react` — Add emoji reactions
   - `edit_message` — Edit previously sent Bot messages

---

## Optional: Project Setup

### Persistent Session

Use `tmux` or `screen` to keep the session alive:

```bash
tmux new -s claude-tg
./start.sh telegram
# Ctrl+B D to detach
```

### Permission Configuration

Add `allow` rules in `.claude/settings.local.json` for frequently-used safe operations, preventing unattended sessions from blocking on permission prompts.

---

## Important Notes

1. **Offline messages lost**: Bot only receives messages while the session is running
2. **Permission blocking**: If Claude hits a permission prompt and you're away from the terminal, the session pauses
3. **Multiple Bot instances**: Use different Bots per project by setting `TELEGRAM_STATE_DIR` to different paths
4. **WSL2 compatible**: Plugin uses outbound polling, no inbound port needed

---

## Key Files

| File | Purpose |
| ---- | ------- |
| `.claude/channels/telegram/.env` | Stores `TELEGRAM_BOT_TOKEN` (gitignored) |
| `.claude/channels/telegram/access.json` | Access control policy & allowlist (gitignored) |
| `.claude/channels/telegram/inbox/` | Received images/files (gitignored) |
| `.claude/settings.local.json` | Claude Code permission config (gitignored) |
| `start.sh` | Multi-channel launcher script |
