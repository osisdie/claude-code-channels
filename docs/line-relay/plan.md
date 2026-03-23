# Plan: LINE Relay System — Cloud Webhook + Local Bridge

## Context

LINE requires a public HTTPS webhook with no polling alternative. The current local broker needs ngrok which is unstable (URL changes on restart). We need a stable cloud endpoint that queues LINE messages, and a local bridge that consumes them using the local Claude Code subscription.

## Architecture

```text
LINE User → LINE Platform → Cloudflare Worker (webhook)
                                    ↓
                              KV Queue (1h TTL)
                                    ↓
Local Bridge (polls every 5s) ← GET /messages
     ↓
claude -p (local, with subscription)
     ↓
POST /reply → Cloudflare Worker → LINE Push API → LINE User
```

**Key decisions:**

- **Cloud: Cloudflare Workers + KV** — free tier (100K req/day), no cold start, KV for queue
- **Always Push API** — replyToken always expires before the relay round-trip completes. Push API is the only viable option (500 free/month)
- **Replies via cloud relay** — centralized LINE token management, local bridge only needs RELAY_SECRET
- **Dedicated poller** (not Telegram bridge) — simpler, same proven broker pattern as Slack

## File Structure

```text
external_plugins/line-channel/
  broker.ts                  # existing direct webhook broker (unchanged)
  broker-relay.ts            # NEW: local bridge that polls cloud relay
  relay/
    src/index.ts             # Cloudflare Worker (webhook + queue + reply)
    wrangler.toml            # Workers config
    package.json             # Worker deps
    .dev.vars.example        # Secrets template
docs/line/
  relay.md                   # NEW: relay deployment guide
```

## Cloud Relay — Cloudflare Worker

### Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/webhook` | LINE signature | Receive LINE events, queue to KV |
| GET | `/messages` | RELAY_SECRET | Poll queued messages |
| POST | `/reply` | RELAY_SECRET | Send response via LINE Push API |
| GET | `/content/:id` | RELAY_SECRET | Proxy LINE Content API (images) |
| DELETE | `/messages` | RELAY_SECRET | Ack consumed messages |
| GET | `/health` | none | Health check |

### Secrets (Cloudflare Workers)

- `LINE_CHANNEL_SECRET` — webhook HMAC verification
- `LINE_CHANNEL_ACCESS_TOKEN` — Push API + Content API
- `RELAY_SECRET` — shared secret for local bridge auth

### Queue Schema (KV)

Key: `msg:{timestamp}:{uuid}` (lexicographic = chronological order)

Value:

```json
{
  "userId": "Uxxxxxxxx",
  "groupId": "Cxxxxxxxx",
  "sourceType": "user|group",
  "messageType": "text|image|file",
  "messageId": "17654...",
  "text": "What's the weather?",
  "timestamp": 1711234567890
}
```

TTL: 1 hour (auto-cleanup)

## Local Bridge — `broker-relay.ts`

Polling loop (same pattern as Slack broker):

1. GET `/messages` with Bearer RELAY_SECRET
2. For each message:
   - Check access.json locally
   - Rate limit / busy guard
   - If image: GET `/content/:messageId`, save to inbox
   - Run `claude -p --allowedTools ... "<prompt>"`
   - POST `/reply` with response text
3. DELETE `/messages` with consumed keys

### Env vars

```bash
RELAY_URL=https://line-relay.your-worker.workers.dev
RELAY_SECRET=<64-char-hex>
POLL_INTERVAL=5
CLAUDE_BIN=claude
BROKER_ALLOWED_TOOLS=WebSearch,WebFetch,Bash(curl:*),Bash(python3:*),Read
```

### start.sh

```bash
declare -A BROKER_CHANNELS=(
  [slack]="external_plugins/slack-channel/broker.ts"
  [line]="external_plugins/line-channel/broker.ts"
  [line-relay]="external_plugins/line-channel/broker-relay.ts"
)
```

Usage: `./start.sh line-relay`

## Implementation Phases

### Phase 1: Cloud Relay (~2-3h)

1. `wrangler init relay` in `external_plugins/line-channel/`
2. Create KV namespace
3. Implement all 5 endpoints
4. Deploy, set secrets
5. Update LINE webhook URL to Workers URL (stable, permanent)

### Phase 2: Local Bridge (~1-2h)

1. Create `broker-relay.ts` — copy structure from Slack broker
2. Replace Slack polling with relay API polling
3. Reuse: runClaude, chunk, loadAccess, logging, rate limiting
4. Add to start.sh

### Phase 3: Test & Document (~1h)

1. E2E: LINE message → cloud → local → response → LINE
2. Image flow
3. Create `docs/line/relay.md`

## Security

| Layer | Mechanism |
|-------|-----------|
| LINE → Cloud | HMAC-SHA256 (LINE_CHANNEL_SECRET) |
| Cloud → LINE | Bearer (LINE_CHANNEL_ACCESS_TOKEN) |
| Local → Cloud | Bearer (RELAY_SECRET) |
| KV messages | 1h TTL auto-expire |
| Local access | access.json allowlist |

## Verification

1. Send text on LINE → appears in KV → local bridge picks up → Claude responds → reply appears on LINE
2. Send image on LINE → cloud stores messageId → local bridge downloads via `/content/:id` → Claude analyzes → reply
3. `./start.sh line-relay` starts the local bridge
4. Cloud relay stays running 24/7 (Cloudflare Workers, no maintenance)

## Files to Modify

- `external_plugins/line-channel/relay/` — NEW: entire Cloudflare Worker
- `external_plugins/line-channel/broker-relay.ts` — NEW: local bridge
- `start.sh` — add `line-relay` to BROKER_CHANNELS
- `docs/line/relay.md` — NEW: deployment guide
- `.env.example` — add RELAY_URL, RELAY_SECRET
