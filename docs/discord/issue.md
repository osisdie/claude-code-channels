# Discord Channel - Known Issues

## Issue #1: State Directory Path Mismatch (Pairing Fails)

**Status:** Workaround applied
**Date:** 2026-03-21
**Affects:** Discord (and likely Telegram) channel plugins

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
```
<project>/.claude/channels/discord/access.json
```

However, the `/discord:access` skill hardcodes the path to the **home directory**:
```
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

This is an upstream issue in the official plugin's skill definition.

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
