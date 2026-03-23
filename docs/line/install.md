# Claude Code x LINE - Installation & Integration Notes

## Overview

This document records the actual installation and integration experience of connecting Claude Code to LINE via the message broker (2026/03).

**Architecture:**

```text
LINE App (Mobile/Desktop)
    | (LINE Platform, webhook POST)
ngrok / Cloudflare Tunnel
    | (forwards to localhost:3000)
LINE Broker (Bun HTTP server)
    | (subprocess: claude -p)
Claude CLI (stateless, per-message)
```

**Environment:**

- OS: WSL2 (Linux 6.6.87.2-microsoft-standard-WSL2)
- Claude Code: v2.1.81
- Runtime: Bun
- Tunnel: ngrok
- LINE Official Account: Claude Code Lab

---

## Installation Steps (Executed)

### 1. Create LINE Official Account

1. Go to [LINE Developers Console](https://developers.line.biz/console/)
2. Create a **Provider** (your organization name)
3. Create a **LINE Official Account** with **Messaging API** enabled
4. In channel settings:
   - Copy **Channel Secret** (Basic settings tab)
   - Issue **Channel Access Token** (Messaging API tab > Issue)

**Account settings:**

| Field | Recommended |
| ----- | ----------- |
| Account name | `Claude Code Lab` (or similar lab/dev name) |
| Category | IT / Internet / Communication > Software / Web Services |

> **Note:** Category (業種) cannot be changed after creation. Choose IT-related category.

### 2. Store Tokens

```bash
echo "LINE_CHANNEL_ACCESS_TOKEN=your-token" >> .env
echo "LINE_CHANNEL_SECRET=your-secret" >> .env
chmod 600 .env
```

> **Warning:** Do NOT pass tokens as command arguments. They leak into conversation history. See [Issue #2](../issues.md).

### 3. Set Up Tunnel

LINE requires a public HTTPS webhook URL. For local development:

```bash
ngrok http 3000
# Copy the https://xxxx.ngrok-free.app URL
```

> **Important:** ngrok free plan URLs change on every restart. Update the webhook URL in LINE console each time.

### 4. Configure Webhook in LINE Console

**Messaging API** tab > **Webhook settings:**

1. Set Webhook URL to: `https://xxxx.ngrok-free.app/webhook`
2. Click **Verify** to test connectivity
3. Enable **Use webhook** (toggle ON)

> **Common mistake:** Forgetting `/webhook` at the end of the URL. The broker only listens on `/webhook` path, not the root `/`.

### 5. Disable Auto-Reply

In [LINE Official Account Manager](https://manager.line.biz/):

1. Select your account > **Settings** > **Response settings**
2. Set **Auto-reply messages** to **OFF**
3. Set **Greeting messages** to **OFF** (optional)

Without this, LINE's built-in auto-reply intercepts messages before they reach the webhook.

### 6. Enable Group Chat (Optional)

By default, LINE bots **cannot be invited to group chats**. To enable:

1. [LINE Official Account Manager](https://manager.line.biz/) > **Settings** > **Account settings**
2. Find **Allow bot to join group chats** > set to **ON**

Or in [LINE Developers Console](https://developers.line.biz/console/):

1. Select channel > **Messaging API** tab
2. **Allow bot to join group chats** > **Enabled**

> **Gotcha:** Without this setting, the bot will immediately leave any group it's invited to. The broker log shows `left group: Cxxxxxxx` as the symptom.

### 7. Set Up Access Control

```bash
mkdir -p .claude/channels/line
```

For DM only (allow all users):

```bash
cat > .claude/channels/line/access.json << 'EOF'
{
  "dmPolicy": "allowlist",
  "allowFrom": [],
  "groups": {},
  "pending": {}
}
EOF
```

To restrict to specific users + enable a group:

```bash
cat > .claude/channels/line/access.json << 'EOF'
{
  "dmPolicy": "allowlist",
  "allowFrom": ["Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"],
  "groups": {
    "Cxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx": {
      "allowFrom": []
    }
  },
  "pending": {}
}
EOF
```

**How to find IDs:**

- **User ID**: Send a DM to the bot, check broker logs for `Uxxxxxxx: [text] ...`
- **Group ID**: Invite bot to group, check logs for `joined group: Cxxxxxxx`
- `allowFrom: []` in groups means **any member** can trigger the bot
- `allowFrom: ["Uxxxxxx"]` restricts to specific users

> **Note:** The broker re-reads `access.json` on every message — no restart needed after editing.

### 8. Launch

```bash
./start.sh line
```

Expected output:

```text
Starting line broker...
[broker] LINE webhook server running on port 3000
[broker] webhook URL: http://localhost:3000/webhook
[broker] project: /mnt/c/writable/git/nwpie/ClawProjects/claude-claw
[broker] state: .../. claude/channels/line
```

---

## Verified Features

| Feature | Status |
| ------- | ------ |
| Text DM > Claude > reply | Verified |
| Group message > Claude > reply | Verified |
| Image download + analysis | Verified |
| WebSearch tool (real-time info) | Verified |
| Rate limiting (per-user cooldown) | Verified |
| Busy guard (concurrent request rejection) | Verified |
| Webhook signature verification | Verified |
| Reply API (free) with Push API fallback | Verified |
| Multi-chunk response (>5000 chars) | Verified |
| Log file persistence | Verified |

---

## Image Handling

LINE sends images as separate `message` events with `type: "image"`. The broker:

1. Downloads the image via LINE Content API (`/v2/bot/message/{id}/content`)
2. Saves to `.claude/channels/line/inbox/`
3. Includes the file path in the prompt to Claude
4. Claude reads and analyzes the image

**Limitations:**

- LINE doesn't support sending text + image in a single message. They arrive as separate events
- Send the image first, then follow up with a text question if needed
- Image-only messages auto-prompt: "Describe the attached file(s)"
- Max image size: 10MB

---

## Tool Access

The broker runs `claude -p` with `--allowedTools` to enable real-time capabilities:

**Default tools enabled:**

- `WebSearch` — search the web (weather, news, prices, etc.)
- `WebFetch` — fetch web pages
- `Bash(curl:*)` — API calls
- `Bash(python3:*)` — computation
- `Read` — read local files and images

**Customize via environment variable:**

```bash
BROKER_ALLOWED_TOOLS="WebSearch,Read" ./start.sh line
```

**System prompt:** The broker includes a system prompt that instructs Claude to use tools proactively for real-time queries. Customize via `BROKER_SYSTEM_PROMPT` env var.

---

## Rate Limiting & Busy Guard

| Protection | Behavior | Default |
| ---------- | -------- | ------- |
| **Busy guard** | If Claude is processing a message, new messages get "⏳ Processing..." reply | Always active |
| **Rate limit** | Per-user cooldown between messages | 5 seconds (`RATE_LIMIT_MS=5000`) |

Both use LINE's Reply API (free) — no Push API quota consumed for rejection messages.

---

## Security Notes

1. **Webhook signature verification** — Every incoming webhook is verified using HMAC-SHA256 with Channel Secret. Invalid signatures return 403
2. **Token storage** — Tokens in `.env` (gitignored). Never pass as command arguments
3. **Access control** — `access.json` controls who can interact. Empty `allowFrom` = all users allowed
4. **No conversation persistence** — Each message spawns a fresh `claude -p` call. No chat history stored
5. **Group isolation** — Groups must be explicitly opted-in via `access.json`. Non-opted groups are silently ignored
6. **File permissions** — Downloaded files saved to `inbox/` (gitignored). Bot state in `.claude/channels/line/` (gitignored)

---

## Tunnel Considerations

### ngrok Free Plan

- URL changes on every restart — must update LINE webhook URL each time
- Authenticated accounts (with authtoken) don't show browser interstitial
- Run `ngrok config add-authtoken <token>` once to authenticate
- Consider ngrok paid plan or Cloudflare Tunnel for stable URLs

### Cloudflare Tunnel (Alternative)

```bash
cloudflared tunnel --url http://localhost:3000
```

- Free, no interstitial
- URL also changes on restart (unless using named tunnels with paid plan)

### WSL2

- Tunnels work from WSL2 (outbound connections)
- Broker binds to `0.0.0.0:3000` — accessible from WSL2 localhost

---

## Configuration

| Variable | Default | Description |
| -------- | ------- | ----------- |
| `LINE_CHANNEL_ACCESS_TOKEN` | (required) | Channel Access Token |
| `LINE_CHANNEL_SECRET` | (required) | Channel Secret (for webhook verification) |
| `LINE_STATE_DIR` | `.claude/channels/line` | State directory |
| `PORT` | `3000` | Webhook server port |
| `CLAUDE_BIN` | `claude` | Path to claude CLI |
| `BROKER_ALLOWED_TOOLS` | `WebSearch,WebFetch,...` | Comma-separated tool list |
| `BROKER_SYSTEM_PROMPT` | (built-in) | Custom system prompt for Claude |
| `RATE_LIMIT_MS` | `5000` | Per-user cooldown in milliseconds |

---

## Key Files

| File | Purpose |
| ---- | ------- |
| `external_plugins/line-channel/broker.ts` | LINE webhook broker |
| `.env` | `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET` (gitignored) |
| `.claude/channels/line/access.json` | Access control (gitignored) |
| `.claude/channels/line/inbox/` | Downloaded images/files (gitignored) |
| `.claude/channels/line/logs/` | Broker logs by date (gitignored) |
| `docs/line/plan.md` | Integration planning document |
| `docs/line/install.md` | This document |

---

## Gotchas & Lessons Learned

1. **Webhook URL must end with `/webhook`** — The broker only listens on the `/webhook` path. Setting the root URL (without `/webhook`) in LINE console will result in 404 and no messages received
2. **Bot cannot join groups by default** — Must enable "Allow bot to join group chats" in LINE Official Account settings. Without this, the bot immediately leaves any group (log shows `left group: Cxxxxxxx`)
3. **Group ID must be in access.json** — Even after enabling group chat, messages from groups are silently ignored unless the group ID is added to `access.json` `groups` field
4. **Auto-reply must be disabled** — LINE's built-in auto-reply intercepts messages before they reach the webhook. Disable in Official Account Manager > Response settings
5. **Category (業種) cannot be changed** — Choose the right category when creating the LINE Official Account. IT / Software is recommended
6. **Image and text are separate events** — LINE doesn't support combined text + image messages. Send image first, then text as follow-up
7. **Reply API free but expires in ~60s** — If Claude takes longer than ~60 seconds, the replyToken expires. Broker falls back to Push API (monthly quota: 500 free)
8. **ngrok URL changes on restart** — Must update webhook URL in LINE console each time ngrok restarts. Consider paid tunnel for stable URL
9. **Stateless per message** — Each message spawns an independent `claude -p` call. No conversation context between messages
10. **Rate limiting** — Default 5s cooldown per user. Busy messages use Reply API (free). Configure via `RATE_LIMIT_MS`
