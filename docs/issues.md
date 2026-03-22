# Known Issues (Cross-Channel)

## Issue #1: State Directory Path Mismatch (Pairing Fails)

**Status:** Workaround applied / [PR #866](https://github.com/anthropics/claude-plugins-official/pull/866) pending
**Date:** 2026-03-21
**Affects:** Discord and Telegram channel plugins

### Symptom

Running `/discord:access pair <code>` reports "code not found" even though the bot successfully sent a pairing code to the user on Discord.

### Root Cause

The `start.sh` launcher sets `DISCORD_STATE_DIR` to a **project-level** path:

```bash
# start.sh line 31
export "${ch^^}_STATE_DIR=$PROJECT_DIR/.claude/channels/$ch"
# Result: DISCORD_STATE_DIR=/path/to/project/.claude/channels/discord
```

The channel server (`server.ts`) respects this variable:

```ts
// server.ts line 32
const STATE_DIR = process.env.DISCORD_STATE_DIR ?? join(homedir(), '.claude', 'channels', 'discord')
```

So the server writes `access.json` (including pending pairing entries) to the **project directory**:

```text
<project>/.claude/channels/discord/access.json
```

However, the `/discord:access` skill hardcodes the path to the **home directory**:

```text
~/.claude/channels/discord/access.json
```

The skill reads from `~/.claude/channels/discord/access.json` which doesn't exist, so it never finds the pending entry.

### Workaround

Manually edit the `access.json` at the correct project-level path:

```bash
# Read the actual file
cat .claude/channels/discord/access.json

# Manually approve by editing the file:
# 1. Move senderId from pending to allowFrom
# 2. Remove the pending entry
# 3. Write the approved/<senderId> file with chatId as contents
mkdir -p .claude/channels/discord/approved
echo -n "<chatId>" > .claude/channels/discord/approved/<senderId>
```

Or have Claude Code do it by pointing it to the correct path.

### Proper Fix

The `/discord:access` skill should resolve the state directory using the same logic as the server:

1. Check `DISCORD_STATE_DIR` environment variable first
2. Fall back to `~/.claude/channels/discord/` only if the env var is unset

This is an upstream issue in the official plugin's skill definition. Fix submitted as [PR #866](https://github.com/anthropics/claude-plugins-official/pull/866).

---

## Issue #2: Token Leakage via Command Arguments

**Status:** Documented
**Date:** 2026-03-21
**Affects:** All channel plugins (Discord, Telegram, etc.)

### Symptom

Running `/discord:configure <BOT_TOKEN>` or `/telegram:configure <BOT_TOKEN>` records the token in plaintext in the conversation history.

### Root Cause

The skill accepts the bot token as an inline argument. Claude Code's conversation history persists this, making the credential visible in logs.

### Workaround

Write the token directly to the `.env` file instead of using the configure skill:

```bash
mkdir -p .claude/channels/discord
echo "DISCORD_BOT_TOKEN=<YOUR_TOKEN>" > .claude/channels/discord/.env
chmod 600 .claude/channels/discord/.env
```

### Proper Fix

The configure skill should use an interactive prompt (e.g., `AskUserQuestion`) to collect the token, rather than accepting it as a command argument.

---

## Issue #3: Slack Plugin Is Not a Channel Plugin

**Status:** By design (not a bug)
**Date:** 2026-03-22
**Affects:** Slack integration expectations

### Symptom

After installing `slack@claude-plugins-official` and configuring `SLACK_BOT_TOKEN` / `SLACK_APP_TOKEN`, DMing the Slack bot produces no response. The bot appears online but does not process inbound messages.

### Root Cause

The `slack@claude-plugins-official` plugin is an **MCP tool integration**, not a **channel plugin**:

| Aspect | Channel plugins (Discord/Telegram) | Slack plugin |
| ------ | ----------------------------------- | ------------ |
| Type | `claude/channel` capability | MCP tools via HTTP |
| Connection | Bot Token → local `server.ts` | OAuth → `mcp.slack.com` |
| Inbound messages | Yes (bidirectional DM bridge) | No (outbound actions only) |
| Pairing / access.json | Yes | No |
| `--channels` flag | Yes | No |

The Slack plugin is maintained by Slack (source: [slackapi/slack-mcp-cursor-plugin](https://github.com/slackapi/slack-mcp-cursor-plugin)), while Discord/Telegram channel plugins are built by Anthropic's channel team.

### Workaround

Use the Slack plugin for **outbound actions** only:

- `/slack:slack-messaging` — send messages
- `/slack:slack-search` — search workspace
- `/slack:summarize-channel` — summarize channels
- `/slack:draft-announcement` — draft announcements

Authentication is via OAuth (browser-based), not `.env` tokens.

### Proper Fix

A true Slack **channel** plugin (bidirectional DM bridge matching the Discord/Telegram pattern) would need to be built. See [docs/slack/plan.md](slack/plan.md) for the proposed architecture. In the meantime, a **message broker** (`./start.sh slack`) provides bidirectional DM via polling + `claude -p`. See [docs/slack/install.md](slack/install.md).

---

## Issue #4: Claude Code `--channels server:` Dev Mode Never Approved

**Status:** Claude Code bug (unresolved)
**Date:** 2026-03-22
**Affects:** Any custom channel plugin using `server:` type

### Symptom

Running `claude --channels server:slack-channel --dangerously-load-development-channels server:slack-channel` shows the development channels warning prompt, but after confirming, the channel notifications are silently dropped with:

```text
Channel notifications skipped: server slack-channel is not on the approved channels allowlist
```

### Root Cause

Claude Code's channel approval logic checks a remote feature flag (`tengu_harbor_ledger`) for approved `plugin:` channels, and a `dev` flag for development channels. The `--dangerously-load-development-channels` flag is parsed and shows the UI prompt, but **never sets `dev: true`** on the channel entry. The `setAllowedChannels()` function is defined but never called.

This means `server:` type channels can never receive inbound notifications, even in development mode.

### Workaround

Use the **message broker** approach instead of Claude Code's `--channels` system:

```bash
./start.sh slack  # runs broker.ts, not --channels
```

The broker polls Slack DMs directly and invokes `claude -p` per message, bypassing the channel plugin system entirely.

### Proper Fix

Anthropic needs to fix Claude Code to properly wire `--dangerously-load-development-channels` to the channel approval logic. The `dev` flag should bypass the remote allowlist check for `server:` entries.
