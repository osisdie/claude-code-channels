# Slack Channel Plugin — Design Document

## Goal

Build a bidirectional Slack DM bridge matching the Telegram/Discord channel plugin experience: inbound messages forwarded to Claude Code, outbound replies sent back, with access control and pairing.

The current `slack@claude-plugins-official` is an MCP tool integration (outbound only). This design covers a **true channel plugin** with `claude/channel` capability.

---

## Architecture

```text
Slack App (Desktop/Mobile/Web)
    | (Socket Mode WebSocket, plugin connects outbound)
Slack Channel Plugin (Bun subprocess, MCP Server)
    | (stdio transport, MCP protocol)
Claude Code Session (local, full filesystem access)
```

- **Socket Mode**: WebSocket connection initiated outbound (no public URL, no webhook)
- **Two tokens**: Bot Token (`xoxb-*`) for API calls + App-Level Token (`xapp-*`) for Socket Mode
- **No inbound ports**: Consistent with Telegram/Discord approach, WSL2 compatible

---

## Complexity Analysis

### Codebase Comparison

| Metric | Discord | Telegram | Slack (estimated) |
| ------ | ------- | -------- | ----------------- |
| server.ts lines | 741 | 862 | ~800 |
| MCP tools | 5 | 4 | 5 |
| SDK | discord.js | grammy | @slack/bolt |
| Connection | WebSocket Gateway | HTTP long-polling | Socket Mode (WebSocket) |
| Text limit | 2000 chars | 4096 chars | ~4000 chars |
| File limit | 25MB, 10 files | 50MB | 1GB (paid), varies |
| Thread model | Inherit parent channel | Reply-to | Native threads |

### Code Reusability (~62% from existing plugins)

| Section | Lines | Reusability | Notes |
| ------- | ----- | ----------- | ----- |
| Types (PendingEntry, Access, etc.) | ~30 | 100% | Copy verbatim |
| Access Control (read/save/prune) | ~90 | 98% | Only path constants change |
| Gate Logic | ~80 | 85% | ID extraction is platform-specific |
| Approval Polling | ~40 | 90% | Send method differs |
| Message Chunking | ~20 | 100% | Only chunk limit constant differs |
| Tool Implementation | ~120 | 40% | Slack API is different |
| Inbound Handlers | ~100 | 50% | Event binding is platform-specific |
| Client Setup | ~50 | 0% | Completely different SDK |
| MCP Notification | ~30 | 85% | Identical MCP interface |

### Effort Estimate

| Phase | Hours | Notes |
| ----- | ----- | ----- |
| Boilerplate adaptation | 2-3 | Copy access control, gate, chunking from Discord |
| Slack SDK integration | 3-4 | @slack/bolt, Socket Mode, token loading |
| Tool implementations | 4-5 | reply, react, edit_message, fetch_messages, download_attachment |
| Inbound handlers | 3-4 | Socket Mode events, mention detection, DM routing |
| Testing & edge cases | 3-4 | Pairing flow, rate limits, thread support |
| **Total** | **15-20** | One developer, full plugin |

---

## Key Components

### 1. server.ts (~800 lines)

The core file. Structure mirrors Discord/Telegram:

```text
[1]  Imports & constants
[2]  STATE_DIR resolution (SLACK_STATE_DIR env var)
[3]  Token loading (.env: SLACK_BOT_TOKEN + SLACK_APP_TOKEN)
[4]  Type definitions (reuse verbatim)
[5]  Access control functions (reuse verbatim)
[6]  Gate function (adapt for Slack user/channel IDs)
[7]  Mention detection (Slack @mention + app_mention event)
[8]  Approval polling (reuse, adapt send method)
[9]  Message chunking (reuse, set limit to ~4000)
[10] MCP tool registration (Slack API specific)
[11] Inbound message handler (Socket Mode events)
[12] Socket Mode connection setup
```

### 2. plugin.json

```json
{
  "name": "slack-channel",
  "description": "Slack channel for Claude Code — messaging bridge with built-in access control",
  "version": "0.0.1",
  "keywords": ["slack", "messaging", "channel", "mcp"],
  "capabilities": {
    "experimental": { "claude/channel": {} }
  }
}
```

### 3. Skills

- `skills/access/SKILL.md` — Pairing, allowlist, policy (adapt from Discord skill)
- `skills/configure/SKILL.md` — Token management (two tokens instead of one)

---

## Slack-Specific Challenges

### 1. Two Tokens Required

Unlike Discord/Telegram (single Bot Token), Slack needs:

- **Bot Token** (`xoxb-*`): For all API calls (send, react, edit, fetch, download)
- **App-Level Token** (`xapp-*`): For Socket Mode WebSocket connection

Both stored in `.env`:

```bash
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
```

### 2. Socket Mode Connection

```typescript
import { App } from '@slack/bolt';

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
});

// Listen for DM messages
app.message(async ({ message, say }) => {
  // Gate check, then forward to Claude Code
});

await app.start();
```

**Advantages over Events API:**

- No public URL needed (matches project's no-inbound-port philosophy)
- Lower latency than HTTP webhooks
- Simpler deployment (no ngrok, no tunnel)

**Trade-off:**

- Requires App-Level Token (extra setup step)
- Socket Mode is still in "general availability" but not as battle-tested as Events API

### 3. Rate Limits (Strict)

Slack enforces per-method rate limits (Tier 1-4):

| Method | Tier | Rate |
| ------ | ---- | ---- |
| `chat.postMessage` | Tier 3 | ~50/min per channel |
| `chat.update` | Tier 3 | ~50/min |
| `reactions.add` | Tier 2 | ~20/min |
| `conversations.history` | Tier 3 | ~50/min |
| `files.uploadV2` | Tier 2 | ~20/min |

**Mitigation:**

- Queue outbound messages with exponential backoff
- Respect `Retry-After` headers
- For chunked messages, add ~200ms delay between chunks

### 4. Thread Model

Slack has **native threads** (unlike Discord's inherit-parent or Telegram's reply-to):

```typescript
// Reply in thread
await client.chat.postMessage({
  channel: channelId,
  text: "response",
  thread_ts: parentMessageTs,  // Creates or continues thread
});
```

**Design decision:** Use threads for multi-turn conversations in channels, flat messages for DMs.

### 5. Mention Detection

Slack mentions use `<@UXXXXXX>` format in message text:

```typescript
function isMentioned(event: MessageEvent, botUserId: string): boolean {
  // Direct mention: <@U0AMVM0FJTD>
  if (event.text?.includes(`<@${botUserId}>`)) return true;
  // app_mention event (separate event type)
  if (event.type === 'app_mention') return true;
  // Regex patterns from access.json
  return matchesMentionPatterns(event.text, access.mentionPatterns);
}
```

### 6. File Handling

Slack's file API is different from Discord/Telegram:

**Upload (outbound):**

```typescript
// files.uploadV2 (new API, recommended)
await client.files.uploadV2({
  channel_id: channelId,
  file: fs.createReadStream(filePath),
  filename: path.basename(filePath),
});
```

**Download (inbound):**

```typescript
// Files shared in messages have a url_private
// Requires Authorization header to download
const response = await fetch(file.url_private, {
  headers: { Authorization: `Bearer ${botToken}` },
});
```

---

## MCP Tools

### reply

Send a message to a Slack channel or DM.

```json
{
  "name": "reply",
  "description": "Send a message to a Slack channel or DM",
  "inputSchema": {
    "type": "object",
    "properties": {
      "chat_id": { "type": "string", "description": "Channel or DM ID" },
      "text": { "type": "string", "description": "Message text (mrkdwn supported)" },
      "reply_to": { "type": "string", "description": "Thread timestamp to reply in" },
      "files": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Absolute file paths to attach"
      }
    },
    "required": ["chat_id", "text"]
  }
}
```

**Implementation:**

- Auto-chunk at ~4000 chars (Slack limit is 4000 for blocks, 40000 for text-only)
- Files uploaded via `files.uploadV2` as separate messages (Slack doesn't combine text + file in one API call)
- mrkdwn formatting by default (Slack's markdown variant)

### react

```json
{
  "name": "react",
  "description": "Add an emoji reaction to a message",
  "inputSchema": {
    "type": "object",
    "properties": {
      "chat_id": { "type": "string" },
      "message_id": { "type": "string", "description": "Message timestamp" },
      "emoji": { "type": "string", "description": "Emoji name without colons (e.g. 'eyes', 'thumbsup')" }
    },
    "required": ["chat_id", "message_id", "emoji"]
  }
}
```

**Note:** Slack uses emoji **names** (e.g., `thumbsup`), not Unicode. Custom workspace emoji also supported by name.

### edit_message

```json
{
  "name": "edit_message",
  "description": "Edit a previously sent message",
  "inputSchema": {
    "type": "object",
    "properties": {
      "chat_id": { "type": "string" },
      "message_id": { "type": "string", "description": "Message timestamp" },
      "text": { "type": "string" }
    },
    "required": ["chat_id", "message_id", "text"]
  }
}
```

### fetch_messages

```json
{
  "name": "fetch_messages",
  "description": "Fetch recent messages from a channel",
  "inputSchema": {
    "type": "object",
    "properties": {
      "channel": { "type": "string" },
      "limit": { "type": "number", "description": "Number of messages (1-100, default 20)" }
    },
    "required": ["channel"]
  }
}
```

**Implementation:** `conversations.history` API. Returns newest-first (reverse to oldest-first for consistency with Discord).

### download_attachment

```json
{
  "name": "download_attachment",
  "description": "Download a file shared in a message",
  "inputSchema": {
    "type": "object",
    "properties": {
      "file_id": { "type": "string", "description": "Slack file ID" }
    },
    "required": ["file_id"]
  }
}
```

**Implementation:** `files.info` to get `url_private`, then HTTP GET with `Authorization: Bearer` header. Save to `STATE_DIR/inbox/`.

---

## Access Control

Reuse `access.json` schema verbatim from Discord/Telegram:

```json
{
  "dmPolicy": "pairing",
  "allowFrom": [],
  "groups": {},
  "pending": {},
  "mentionPatterns": [],
  "ackReaction": "eyes",
  "replyToMode": "first",
  "textChunkLimit": 4000,
  "chunkMode": "length"
}
```

**Slack-specific adaptations:**

- `allowFrom` stores Slack **member IDs** (e.g., `UMU9QLY79`)
- `groups` keyed on **channel IDs** (e.g., `C01234ABCDE`)
- `ackReaction` uses emoji **names** (e.g., `eyes`), not Unicode
- DM detection: `event.channel_type === 'im'`

---

## Pairing Flow

Identical to Discord/Telegram:

```text
1. Unknown user DMs bot
2. gate() generates 6-hex-char code, stores in pending
3. Bot replies: "Run /slack-channel:access pair a4f91c"
4. User runs skill in Claude Code terminal
5. Skill reads access.json, validates code
6. Skill moves user to allowFrom, writes approved/<userId>
7. Server polls approved/ dir (every 5s), finds file
8. Server sends "Paired! Say hi to Claude." via chat.postMessage
9. Server deletes approved/<userId>
```

---

## Inbound Message Flow

```typescript
app.event('message', async ({ event, client }) => {
  // Skip bot's own messages
  if (event.bot_id) return;

  const senderId = event.user;
  const chatId = event.channel;
  const isDM = event.channel_type === 'im';

  // Gate check
  const result = gate(access, senderId, chatId, isDM);

  if (result.action === 'drop') return;
  if (result.action === 'pair') {
    await client.chat.postMessage({
      channel: chatId,
      text: `Pairing required — run in Claude Code:\n\n/slack-channel:access pair ${result.code}`,
    });
    return;
  }

  // Deliver to Claude Code
  // Ack reaction
  if (access.ackReaction) {
    await client.reactions.add({
      channel: chatId,
      timestamp: event.ts,
      name: access.ackReaction,
    });
  }

  // Typing indicator
  // (Slack doesn't have a typing API for bots)

  // Build notification
  const notification = {
    type: 'inbound_message',
    senderId,
    chatId,
    text: event.text || '',
    messageId: event.ts,
    threadTs: event.thread_ts,
    attachments: extractAttachments(event),
  };

  // Emit MCP notification
  server.notification({ method: 'notifications/claude/channel', params: notification });
});
```

---

## Token Security

- Tokens stored in project-level `.env` (gitignored)
- `SLACK_STATE_DIR` env var for project-level isolation (same as Discord/Telegram)
- Skills must resolve STATE_DIR from env before falling back to `~/.claude/channels/slack-channel/`
- Never pass tokens as slash command arguments (Issue #2)

---

## Implementation Phases

### Phase 1: Socket Mode + Basic Inbound (3-4h)

- Set up @slack/bolt with Socket Mode
- Listen for `message` events in DMs
- Log inbound messages to console
- Verify WebSocket connection stability

### Phase 2: Gate + Pairing (2-3h)

- Port access.json read/save/prune from Discord
- Implement gate() with Slack ID types
- Pairing code generation and reply
- Approval polling + confirmation message

### Phase 3: MCP Tools — Core (4-5h)

- `reply` — chat.postMessage with chunking
- `react` — reactions.add
- `edit_message` — chat.update
- Register as MCP server with `claude/channel` capability

### Phase 4: MCP Tools — Advanced (3-4h)

- `fetch_messages` — conversations.history
- `download_attachment` — files.info + download
- File upload in `reply` — files.uploadV2

### Phase 5: Polish (3-4h)

- Thread support (reply in thread via `thread_ts`)
- Rate limit handling (queue + backoff)
- Mention detection (@bot + app_mention event + regex patterns)
- Group/channel opt-in support
- Error handling and reconnection

---

## Comparison: MCP Plugin vs Channel Plugin

| Feature | Current MCP Plugin | Proposed Channel Plugin |
| ------- | ------------------ | ----------------------- |
| Direction | Outbound only | Bidirectional |
| Inbound DMs | No | Yes |
| Connection | OAuth -> mcp.slack.com | Socket Mode -> Slack |
| Pairing | No | Yes (access.json) |
| Access control | No | Yes (allowlist, groups) |
| start.sh | Not supported | `./start.sh slack` |
| Authentication | OAuth (browser) | Bot Token + App Token (.env) |
| MCP tools | Search, canvas, messaging | reply, react, edit, fetch, download |
| Dependency | Slack's MCP server | Self-contained |

**Coexistence:** Both plugins can coexist. The channel plugin handles bidirectional DM, while the MCP plugin provides search/canvas capabilities not available through the Bot API.

---

## Open Questions

1. **Thread strategy in DMs**: Should multi-turn DM conversations use threads? Telegram/Discord don't, but Slack threads are natural for long conversations.

2. **Block Kit**: Should `reply` tool support Slack Block Kit (rich layouts) or just mrkdwn text? Start with mrkdwn, add blocks as a future enhancement.

3. **Enterprise Grid**: Enterprise Grid workspaces require additional OAuth scopes and org-level app distribution. Out of scope for v1.

4. **Typing indicator**: Slack Bot API doesn't have a "typing" endpoint like Discord. Consider using `chat.postMessage` with a "thinking..." message that gets edited, or skip typing indicators.

5. **Plugin name**: Use `slack-channel` to distinguish from the existing `slack` MCP plugin? Or replace it entirely?

6. **Upstream contribution**: Should this be contributed to `anthropics/claude-plugins-official` as a new plugin, or maintained in this repo?

---

## Dependencies

```json
{
  "@slack/bolt": "^4.x",
  "@slack/web-api": "^7.x"
}
```

Bun-compatible. @slack/bolt handles Socket Mode internally.

---

## References

- [Slack Bolt for JavaScript](https://slack.dev/bolt-js/)
- [Socket Mode](https://api.slack.com/apis/socket-mode)
- [Slack Web API Methods](https://api.slack.com/methods)
- [Slack Rate Limits](https://api.slack.com/docs/rate-limits)
- [Plugin Architecture](../plugins/architecture.md) — How channel plugins work
- [Known Issues](../issues.md) — Issue #3: Current Slack plugin is not a channel
