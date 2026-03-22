# Claude Code x Slack Integration Plan

## Important: Slack Plugin Is NOT a Channel Plugin

Unlike Telegram and Discord, the official `slack@claude-plugins-official` is **NOT** a channel plugin. It is an **MCP tool integration** that provides outbound Slack actions (search, send, canvas) via OAuth to `mcp.slack.com`.

| Aspect | Discord / Telegram | Slack |
| ------ | ------------------ | ----- |
| Plugin type | **Channel** (`claude/channel` capability) | **MCP tools** |
| Connection | Bot Token → WebSocket / polling | OAuth → `mcp.slack.com` HTTP |
| Bidirectional DM | Yes (bot receives & sends) | No (outbound actions only) |
| Token source | `.env` file (`*_BOT_TOKEN`) | OAuth flow (browser-based) |
| Pairing / access.json | Yes | No |
| `start.sh` integration | Yes (`--channels plugin:...`) | No (loaded as regular plugin) |

A true Slack **channel** plugin (bidirectional DM bridge matching the Telegram/Discord pattern) **does not exist yet** in the official plugin repository.

---

## Current State: MCP Tool Integration

### What the Slack Plugin Provides

The plugin connects to Slack's MCP server at `https://mcp.slack.com/mcp` via HTTP + OAuth and exposes:

- **Search**: Find messages, files, users, and channels (public + private)
- **Messaging**: Send messages, retrieve channel histories, access threaded conversations
- **Canvas**: Create and share formatted documents, export as markdown
- **User Management**: Retrieve user profiles, custom fields, status

### Installation

```text
/plugin install slack@claude-plugins-official
```

On first use, you will be prompted to authenticate via OAuth in your browser. No `.env` tokens needed.

### MCP Configuration

```json
{
  "mcpServers": {
    "slack": {
      "type": "http",
      "url": "https://mcp.slack.com/mcp",
      "oauth": {
        "clientId": "1601185624273.8899143856786",
        "callbackPort": 3118
      }
    }
  }
}
```

### Available Skills / Commands

| Command | Description |
| ------- | ----------- |
| `/slack:slack-messaging` | Guidance for composing Slack messages (mrkdwn syntax) |
| `/slack:slack-search` | Guidance for searching Slack effectively |
| `/slack:summarize-channel` | Summarize recent activity in a channel |
| `/slack:channel-digest` | Digest across multiple channels |
| `/slack:find-discussions` | Find discussions about a topic |
| `/slack:standup` | Generate standup update from recent activity |
| `/slack:draft-announcement` | Draft a Slack announcement |

---

## Future: Slack Channel Plugin (Bidirectional)

To achieve the same bidirectional DM experience as Telegram/Discord, a dedicated Slack **channel** plugin would need to be built with:

### Architecture (Proposed)

```text
Slack App (Desktop/Mobile/Web)
    | (Socket Mode / WebSocket, plugin connects outbound)
Slack Channel Plugin (Bun subprocess, MCP Server)
    | (stdio transport)
Claude Code Session (local, full filesystem access)
```

### Requirements

- [ ] Socket Mode enabled (App-Level Token `xapp-*` for WebSocket, no public URL needed)
- [ ] Bot Token (`xoxb-*`) with scopes: `chat:write`, `im:history`, `im:read`, `im:write`, `reactions:write`
- [ ] Event subscriptions: `message.im` for DMs
- [ ] `claude/channel` capability in plugin.json
- [ ] `server.ts` matching the Discord/Telegram pattern: STATE_DIR resolution, access gating, pairing flow
- [ ] MCP tools: `reply`, `react`, `edit_message`, `fetch_messages`, `download_attachment`

### Token Security

When a Slack channel plugin is built:

1. **Never pass tokens as slash command arguments** — they leak into conversation history (see [Issue #2](../issues.md))
2. **Use project-level `.env`** for token storage
3. **Two tokens required**: Bot Token (`xoxb-*`) + App-Level Token (`xapp-*`)

### Key Differences from Telegram/Discord

| Aspect | Telegram | Discord | Slack (proposed) |
| ------ | -------- | ------- | ---------------- |
| Connection | HTTP long-polling | WebSocket Gateway | Socket Mode (WebSocket) |
| Tokens needed | 1 (Bot Token) | 1 (Bot Token) | 2 (Bot + App-Level) |
| Thread support | Reply-to | Thread inherit | Native threads |
| Message history | Not available | `fetch_messages` | Web API `conversations.history` |
| File limit | 50MB | 25MB, max 10 | TBD |
| Rate limits | Lenient | Moderate | Strict (1 msg/sec/channel) |

---

## Notes

- The current `slack@claude-plugins-official` is maintained by Slack (not Anthropic's channel team)
- Source: [slackapi/slack-mcp-cursor-plugin](https://github.com/slackapi/slack-mcp-cursor-plugin)
- Slack tokens (`SLACK_BOT_TOKEN` / `SLACK_APP_TOKEN`) go in project root `.env` for direct API use (e.g., `scripts/verify_slack.sh`). The MCP plugin itself uses OAuth
- To use the MCP plugin, authenticate via OAuth when prompted — no manual token setup needed
