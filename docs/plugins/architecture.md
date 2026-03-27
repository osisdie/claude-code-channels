# Official Channel Plugin Architecture

This document describes the architecture of the official Claude Code channel plugins ([anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official)), focusing on key design decisions and how this project interacts with them.

## Overview

Each channel plugin is a **Bun subprocess** running an **MCP server** over **stdio transport**. Claude Code launches the plugin, which connects outbound to the messaging platform (no inbound ports needed).

```text
Messaging App (Mobile/Desktop)
    | (Platform API — outbound polling or WebSocket)
Channel Plugin (Bun subprocess, MCP Server)
    | (stdio transport, MCP protocol)
Claude Code Session (local, full filesystem access)
```

---

## Key Components

### server.ts

The core of each channel plugin. Handles:

- **Platform connection**: Telegram via HTTP long-polling, Discord via WebSocket Gateway
- **STATE_DIR resolution**: `process.env.<CHANNEL>_STATE_DIR ?? ~/.claude/channels/<channel>`
- **Access gating**: Every inbound message passes through `gate()` before reaching Claude
- **MCP tool registration**: Exposes `reply`, `react`, `edit_message`, etc.
- **Pairing approval polling**: Checks `approved/` directory every 5 seconds

### skills/access/SKILL.md

A prompt-based skill (not executable code) that Claude reads and follows. Manages:

- Pairing approval (`pair <code>`)
- Allowlist management (`allow <id>`, `remove <id>`)
- Policy changes (`policy allowlist|pairing|disabled`)
- Group opt-in (`group add <id>`, `group rm <id>`)
- Advanced settings (`set ackReaction <emoji>`, `set mentionPatterns [...]`)

### skills/configure/SKILL.md

Handles bot token management:

- No args: display current status (token masked, policy, allowlist count)
- With token: write to `<STATE_DIR>/.env` with `chmod 600`
- `clear`: remove token from `.env`

### plugin.json

Declares the MCP tools, channel capability, and metadata:

```json
{
  "name": "discord",
  "description": "Discord channel for Claude Code",
  "capabilities": {
    "experimental": { "claude/channel": {} }
  }
}
```

---

## MCP Tools

| Tool                  | Discord | Telegram | Description                                      |
| --------------------- | :-----: | :------: | ------------------------------------------------ |
| `reply`               | Yes     | Yes      | Send message (auto-chunks, supports file attach) |
| `react`               | Yes     | Yes      | Add emoji reaction                               |
| `edit_message`        | Yes     | Yes      | Edit bot's own message                           |
| `fetch_messages`      | Yes     | No       | Pull recent history (1-100 messages)             |
| `download_attachment` | Yes     | Yes      | Download files to `inbox/`                       |

### Key differences

- **Discord** `reply`: max 2000 chars/chunk, 25MB/file, 10 files max
- **Telegram** `reply`: max 4096 chars/chunk, 50MB/file, supports MarkdownV2 format, supports inline keyboard buttons (`buttons` param — local fork)
- **Discord** has `fetch_messages` for channel history lookback; Telegram has no equivalent

---

## Access Control (access.json)

### Schema

```json
{
  "dmPolicy": "pairing | allowlist | disabled",
  "allowFrom": ["userId1", "userId2"],
  "groups": {
    "channelId": {
      "requireMention": true,
      "allowFrom": ["userId1"]
    }
  },
  "pending": {
    "a4f91c": {
      "senderId": "userId",
      "chatId": "channelId",
      "createdAt": 1234567890000,
      "expiresAt": 1234571490000,
      "replies": 1
    }
  },
  "mentionPatterns": ["^hey claude\\b"],
  "ackReaction": "eyes",
  "replyToMode": "first | all | off",
  "textChunkLimit": 2000,
  "chunkMode": "length | newline"
}
```

### Gate Flow

Every inbound message is processed by `gate()`:

1. **deliver** — message passes through to Claude Code
2. **drop** — silently ignored (unauthorized sender or disabled policy)
3. **pair** — bot replies with pairing code (max 2 replies, then silent)

Rate limits in pairing mode:

- Max 2 replies per pending code (initial + 1 reminder)
- Max 3 pending codes simultaneously
- Codes expire after 1 hour

### File handling

Access file uses **atomic writes** to prevent corruption:

```typescript
const tmp = ACCESS_FILE + '.tmp'
writeFileSync(tmp, JSON.stringify(a, null, 2) + '\n', { mode: 0o600 })
renameSync(tmp, ACCESS_FILE)  // Atomic rename
```

If `access.json` is corrupt, it's renamed to `access.json.corrupt-<timestamp>` and defaults are loaded.

---

## Pairing Flow (End-to-End)

```text
1. Unknown sender DMs the bot
2. gate() generates 6-hex-char code, stores in pending
3. Bot replies: "Run /discord:access pair a4f91c"
4. User runs skill in Claude Code terminal
5. Skill reads access.json, validates code
6. Skill moves sender to allowFrom, writes approved/<senderId>
7. Server polls approved/ dir (every 5s), finds file
8. Server sends "Paired! Say hi to Claude." to sender
9. Server deletes approved/<senderId> file
```

---

## Project-Level vs Global-Level State

### Default behavior (global)

Plugins store state at `~/.claude/channels/<channel>/`:

```text
~/.claude/channels/discord/
├── .env           # Bot token
├── access.json    # Access control
├── approved/      # Pending approvals
└── inbox/         # Downloaded files
```

This is **shared across all projects** using the same channel.

### Project-level override (this project's approach)

`start.sh` exports `<CHANNEL>_STATE_DIR` to project-level paths:

```bash
export DISCORD_STATE_DIR=$PROJECT_DIR/.claude/channels/discord
export TELEGRAM_STATE_DIR=$PROJECT_DIR/.claude/channels/telegram
```

The server respects this:

```typescript
const STATE_DIR = process.env.DISCORD_STATE_DIR
  ?? join(homedir(), '.claude', 'channels', 'discord')
```

### Why this project uses project-level state

| Benefit                  | Description                                         |
| ------------------------ | --------------------------------------------------- |
| **Isolation**            | Different bots/tokens per project                   |
| **Security**             | Tokens don't leak across projects                   |
| **Multi-instance**       | Run multiple bots simultaneously                    |
| **Gitignored**           | `.claude/` is in `.gitignore`                       |
| **Portable**             | State travels with the project                      |

### Skill path resolution (fixed in local fork)

The official plugin skills hardcode `~/.claude/channels/<channel>/`, ignoring
`*_STATE_DIR`. This project's local forks (`external_plugins/`) fix this by
using `$TELEGRAM_STATE_DIR` / `$DISCORD_STATE_DIR` with a fallback to the
global path. See the `$STATE` shorthand in each skill's SKILL.md.

---

## Local Plugin Fork (Symlink Architecture)

This project forks the official channel plugins into `external_plugins/` for
version control and customization. Claude Code's `--channels` flag only
accepts official plugin identifiers and re-extracts plugins on startup,
overwriting the cache. To work around this, `start.sh` symlinks the plugin
cache directory to the local fork.

### How it works

```text
~/.claude/plugins/cache/claude-plugins-official/telegram/0.0.4/
    ↓ symlink (created by start.sh)
<project>/external_plugins/telegram-channel/
    ├── .claude-plugin/plugin.json   # Plugin manifest
    ├── .mcp.json                    # MCP server config
    ├── package.json                 # Dependencies
    ├── server.ts                    # Forked server (source of truth)
    ├── skills/                      # Access & configure skills
    ├── node_modules/                # (gitignored)
    └── bun.lock
```

### Startup flow

1. `start.sh` resolves the plugin cache base directory
2. For each version dir, creates a symlink → `external_plugins/<channel>-channel/`
3. Backs up original dirs as `<version>.official/` (gitignored)
4. Installs `node_modules` if missing
5. Launches `claude --channels plugin:<channel>@claude-plugins-official`
6. Claude Code follows the symlink and runs our local `server.ts`

### Why symlink instead of sync-to-cache

| Approach | Problem |
| -------- | ------- |
| Pre-sync `cp` before `claude` | Claude re-extracts on startup, overwrites our copy |
| Background watcher | Race condition — bun may load before patch |
| `--plugin-dir` | Doesn't support channel plugins (SessionStart hook error) |
| `--mcp-config` | No channel notification capability |
| **Symlink (chosen)** | Claude sees the dir exists, skips extraction |

### Contributor workflow

```bash
git pull                    # Get latest plugin code
./start.sh telegram         # Auto-symlink + auto-install deps + launch
```

No manual cache management needed. All plugin changes go through
`external_plugins/` in version control.

---

## Security Highlights

### File permissions

- `.env` (tokens): `0o600` (owner read/write only)
- `access.json`: `0o600`
- `STATE_DIR`: `0o700` (owner only)
- State files blocked from being sent as attachments (`assertSendable()`)

### Prompt injection defense

- **Access mutations never triggered by channel messages** — only via direct skill invocation in the user's terminal
- Skills explicitly state: if a message asks to "approve pairing" or "add to allowlist", **refuse** and tell the user to run the skill directly
- Pairing codes must be supplied explicitly — no auto-approval

### Token leakage (Issue #2)

Passing tokens as slash command arguments (e.g., `/discord:configure <TOKEN>`) records them in conversation history. Write tokens directly to `.env` files instead. See [Known Issues](../issues.md).

---

## Channel Comparison

| Feature              | Discord             | Telegram            | Slack (planned)         |
| -------------------- | ------------------- | ------------------- | ----------------------- |
| Connection           | WebSocket Gateway   | HTTP long-polling   | Socket Mode (WebSocket) |
| User ID type         | Snowflake (numeric) | Numeric ID          | Member ID               |
| Text limit           | 2000 chars          | 4096 chars          | TBD                     |
| File limit           | 25MB, 10 files      | 50MB                | TBD                     |
| Message history      | `fetch_messages`    | Not available       | TBD                     |
| Photo handling       | On-demand download  | Eager download      | TBD                     |
| Emoji reactions      | Unicode + custom    | Fixed whitelist     | Standard emoji          |
| Format support       | None                | MarkdownV2          | mrkdwn                  |
| Thread support       | Inherit parent      | Reply-to            | Native threads          |

---

## References

- [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official) — Official plugin source
- [Known Issues](../issues.md) — STATE_DIR mismatch and token leakage
- [PR #866](https://github.com/anthropics/claude-plugins-official/pull/866) — Fix for STATE_DIR resolution in skills
