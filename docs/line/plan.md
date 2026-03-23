# Claude Code Channels x LINE Integration Plan

## Context

Using the LINE Messaging API to connect a Claude Code session with a LINE Official Account, enabling bidirectional communication. Unlike Telegram/Discord/Slack which all use outbound connections, **LINE requires a public HTTPS webhook** — there is no polling API.

**Architecture:**

```text
LINE App (Mobile/Desktop)
    | (LINE Platform, webhook POST to your server)
LINE Broker (Bun process, local HTTP server + tunnel)
    | (subprocess: claude -p)
Claude CLI (stateless, per-message)
```

**Key difference:** LINE requires an **inbound webhook**, breaking the "no inbound ports" pattern used by other channels. A tunnel (ngrok, Cloudflare Tunnel) is needed for local development.

---

## Prerequisites

- [x] Bun runtime (see [prerequisites](../prerequisites.md))
- [x] Claude Code v2.1.80+
- [ ] LINE Official Account (via [LINE Developers Console](https://developers.line.biz/console/))
- [ ] Channel Access Token (`LINE_CHANNEL_ACCESS_TOKEN`)
- [ ] Channel Secret (`LINE_CHANNEL_SECRET`)
- [ ] Public HTTPS URL for webhook (tunnel for local dev)

---

## Implementation Steps

### Phase 1: Create LINE Official Account

1. Go to [LINE Developers Console](https://developers.line.biz/console/)
2. Log in or create a LINE account
3. Accept the LINE Developers Agreement
4. Create a **Provider** (your organization or personal name)
5. Create a **LINE Official Account** and enable **Messaging API**
   - This automatically creates a Messaging API channel
6. In the channel settings:
   - Copy **Channel Secret** (Basic settings tab)
   - Issue a **Channel Access Token** (Messaging API tab > Issue)

### Phase 2: Configure Webhook

LINE requires a publicly accessible HTTPS endpoint. For local development:

#### Option A: ngrok (recommended for dev)

```bash
# Install ngrok
brew install ngrok  # or: snap install ngrok

# Start tunnel (after broker is running on port 3000)
ngrok http 3000
# Copy the https://xxxx.ngrok-free.app URL
```

#### Option B: Cloudflare Tunnel

```bash
cloudflared tunnel --url http://localhost:3000
```

Set the webhook URL in LINE Developers Console:

- Messaging API tab > Webhook settings
- Webhook URL: `https://xxxx.ngrok-free.app/webhook`
- Click **Verify** to test
- Enable **Use webhook**

### Phase 3: Store Tokens

Write tokens to project-level `.env` (gitignored):

```bash
echo "LINE_CHANNEL_ACCESS_TOKEN=your-token" >> .env
echo "LINE_CHANNEL_SECRET=your-secret" >> .env
chmod 600 .env
```

> **Warning:** Do NOT pass tokens as command arguments. They leak into conversation history. See [docs/issues.md Issue #2](../issues.md).

### Phase 4: Launch LINE Broker

```bash
./start.sh line
```

The broker will:

1. Start a local HTTP server on port 3000 (configurable)
2. Receive webhook events from LINE Platform
3. Verify webhook signature using Channel Secret
4. For each user message:
   - Download any attached images/files
   - Run `claude -p --output-format text "<message>"`
   - Reply using the Reply API (free) or Push API (if replyToken expired)

### Phase 5: Set Up Access Control

```bash
mkdir -p .claude/channels/line
cat > .claude/channels/line/access.json << 'EOF'
{
  "dmPolicy": "allowlist",
  "allowFrom": ["YOUR_LINE_USER_ID"],
  "groups": {},
  "pending": {}
}
EOF
```

LINE user IDs are opaque strings (e.g., `U1234567890abcdef...`). Find yours:

- Send a message to the bot
- Check broker logs for the `userId` field

### Phase 6: Verify

1. **Basic test**: Send a text message to the bot on LINE, confirm Claude replies
2. **Image test**: Send an image, verify it's downloaded and analyzed
3. **Webhook verify**: Use LINE console's "Verify" button to confirm connectivity
4. **Tunnel stability**: Ensure ngrok/cloudflare tunnel stays connected

---

## Reply API vs Push API

LINE has two ways to send messages:

| Aspect | Reply API | Push API |
| ------ | --------- | -------- |
| Cost | Free | Paid (monthly quota) |
| Trigger | Requires `replyToken` from webhook | Can send anytime with user ID |
| Limit | 1 reply per user event | 500/month (free tier) |
| Token validity | ~1 minute | N/A |
| Use case | Immediate response | Async / delayed response |

**Strategy for the broker:**

1. **Try Reply API first** — it's free and has the replyToken from the webhook event
2. **Fall back to Push API** — if the response takes longer than ~1 minute (replyToken expired)
3. **Rate awareness** — track monthly Push API usage to avoid overages

---

## Expected MCP Tools (Broker)

Since LINE will use the broker pattern (like Slack), these are implemented as broker features rather than MCP tools:

| Feature | Implementation | Status |
| ------- | -------------- | ------ |
| Text reply | Reply API / Push API | Planned |
| Image download | GET `/v2/bot/message/{id}/content` | Planned |
| Sticker (receive) | Parse sticker event, log package/sticker ID | Planned |
| File download | Same content API as images | Planned |
| Rich reply | Flex Messages (optional, future) | Future |

---

## Key Differences from Other Channels

| Aspect | Telegram | Discord | Slack | LINE |
| ------ | -------- | ------- | ----- | ---- |
| Connection | Outbound polling | Outbound WebSocket | Outbound polling | **Inbound webhook** |
| Public URL needed | No | No | No | **Yes** |
| Tokens | 1 (Bot Token) | 1 (Bot Token) | 1 (Bot Token) | 2 (Access Token + Secret) |
| Integration | `--channels` plugin | `--channels` plugin | Broker (polling) | Broker (webhook) |
| Reply model | Async (send anytime) | Async (send anytime) | Async (send anytime) | Reply (free) + Push (paid) |
| Text limit | 4096 chars | 2000 chars | 4000 chars | 5000 chars |
| File limit | 50MB | 25MB | Varies | 10MB (images) |
| Message history | Not available | `fetch_messages` | `conversations.history` | Not available (no API) |
| Cost | Free | Free | Free | Free (Reply) / Paid (Push) |
| SDK | grammy | discord.js | Slack Web API | @line/bot-sdk |

---

## Webhook Security

LINE webhook events must be verified using the Channel Secret:

```typescript
import { validateSignature } from '@line/bot-sdk'

// X-Line-Signature header contains HMAC-SHA256 of body using Channel Secret
const isValid = validateSignature(body, channelSecret, signature)
```

This prevents spoofed webhook calls. The broker must reject requests with invalid signatures.

---

## Important Notes

1. **Webhook is mandatory** — LINE has no polling API. You must expose a public HTTPS URL. Use ngrok or Cloudflare Tunnel for local development
2. **WSL2 considerations** — Tunnels work from WSL2 since they make outbound connections. The local HTTP server binds to `0.0.0.0:3000`
3. **ReplyToken expires in ~1 minute** — If Claude takes longer to respond, the replyToken becomes invalid. Fall back to Push API
4. **Push API costs money** — Free tier: 500 messages/month. Production plans have higher limits. Reply API is always free
5. **No message history** — LINE Bot API has no equivalent to Discord's `fetch_messages` or Slack's `conversations.history`. Only real-time webhook events
6. **User IDs are channel-scoped** — Same LINE user has different IDs across different channels/providers
7. **Bot auto-reply should be disabled** — In LINE Official Account settings, disable "Auto-reply messages" to prevent conflicts with the broker

---

## Broker Architecture (Proposed)

```text
LINE Platform
    | (HTTPS POST to webhook URL)
    v
ngrok / Cloudflare Tunnel
    | (forwards to localhost:3000)
    v
LINE Broker (Bun HTTP server)
    | 1. Verify X-Line-Signature
    | 2. Parse webhook events
    | 3. Download attachments
    | 4. Spawn: claude -p "<message>"
    | 5. Reply via Reply API (or Push API fallback)
    v
Claude CLI (stateless, per-message)
```

Unlike the Slack broker (which polls), the LINE broker is an **HTTP server** that receives webhook POSTs. The rest of the flow is identical: download files, run `claude -p`, send response.

---

## Key Files

| File | Purpose |
| ---- | ------- |
| `external_plugins/line-channel/broker.ts` | LINE webhook broker (planned) |
| `.env` | `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET` (gitignored) |
| `.claude/channels/line/access.json` | Access control (gitignored) |
| `.claude/channels/line/inbox/` | Downloaded attachments (gitignored) |
| `docs/line/plan.md` | This planning document |

---

## References

- [LINE Messaging API Overview](https://developers.line.biz/en/docs/messaging-api/overview/)
- [LINE Developers Console](https://developers.line.biz/console/)
- [LINE Bot SDK for Node.js](https://github.com/line/line-bot-sdk-nodejs)
- [Webhook Events](https://developers.line.biz/en/docs/messaging-api/receiving-messages/)
- [Send Messages](https://developers.line.biz/en/docs/messaging-api/sending-messages/)
- [Channel Access Tokens](https://developers.line.biz/en/docs/messaging-api/channel-access-tokens/)
