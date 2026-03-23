# LINE Relay — Cloud Webhook + Local Bridge

## Why

LINE requires a public HTTPS webhook with no polling alternative. The local broker (`./start.sh line`) needs ngrok which is unstable (URL changes on restart). The relay provides a **stable cloud endpoint** that queues LINE messages for a local bridge to process with Claude.

## Architecture

```text
LINE User → LINE Platform → Cloudflare Worker (webhook)
                                    ↓
                              KV Queue (1h TTL)
                                    ↓
Local Bridge (polls every 5s) ← GET /messages
     ↓
claude -p (local, with Claude subscription)
     ↓
POST /reply → Cloudflare Worker → LINE Push API → LINE User
```

- Cloud relay runs 24/7 on Cloudflare Workers (free tier)
- Local bridge runs on your machine with `./start.sh line-relay`
- Claude processes messages locally using your subscription
- Responses sent back to LINE via cloud relay's Push API

---

## Setup

### 1. Prerequisites

- [Cloudflare account](https://dash.cloudflare.com/sign-up) (free)
- `wrangler` CLI: `bun add -g wrangler` or use `bunx wrangler`
- LINE tokens already in `.env` (from LINE setup)

### 2. Create KV Namespace

```bash
cd external_plugins/line-channel/relay
bunx wrangler kv namespace create LINE_QUEUE
```

Copy the `id` from the output and update `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "LINE_QUEUE"
id = "YOUR_KV_NAMESPACE_ID"
```

### 3. Deploy Worker

```bash
cd external_plugins/line-channel/relay
bunx wrangler deploy
```

Note the Worker URL (e.g., `https://line-relay.your-subdomain.workers.dev`).

### 4. Set Secrets

```bash
# Generate a relay secret
openssl rand -hex 32

# Set secrets in Cloudflare Workers
bunx wrangler secret put LINE_CHANNEL_SECRET
bunx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
bunx wrangler secret put RELAY_SECRET
```

### 5. Update LINE Webhook URL

In [LINE Developers Console](https://developers.line.biz/console/):

1. Messaging API tab > Webhook settings
2. Set URL to: `https://line-relay.your-subdomain.workers.dev/webhook`
3. Click **Verify**
4. Enable **Use webhook**

This URL is **permanent** — no more ngrok restarts.

### 6. Configure Local Bridge

Add to project `.env`:

```bash
RELAY_URL=https://line-relay.your-subdomain.workers.dev
RELAY_SECRET=your-64-char-hex-secret
```

### 7. Launch

```bash
./start.sh line-relay
```

---

## Cloud Relay Endpoints

| Method | Path | Auth | Purpose |
| ------ | ---- | ---- | ------- |
| POST | `/webhook` | LINE signature | Receive LINE events, queue to KV |
| GET | `/messages` | RELAY_SECRET | Poll queued messages |
| POST | `/reply` | RELAY_SECRET | Send response via LINE Push API |
| GET | `/content/:id` | RELAY_SECRET | Proxy LINE Content API (images) |
| DELETE | `/messages` | RELAY_SECRET | Ack consumed messages |
| GET | `/health` | none | Health check |

---

## Security

| Layer | Mechanism |
| ----- | --------- |
| LINE > Cloud | HMAC-SHA256 (LINE_CHANNEL_SECRET) |
| Cloud > LINE | Bearer (LINE_CHANNEL_ACCESS_TOKEN) |
| Local > Cloud | Bearer (RELAY_SECRET) |
| KV messages | 1h TTL auto-expire |
| Local access | access.json allowlist |

---

## Configuration

| Variable | Where | Description |
| -------- | ----- | ----------- |
| `LINE_CHANNEL_SECRET` | Cloud (wrangler secret) | Webhook verification |
| `LINE_CHANNEL_ACCESS_TOKEN` | Cloud (wrangler secret) | Push API replies |
| `RELAY_SECRET` | Cloud + Local (.env) | Shared auth token |
| `RELAY_URL` | Local (.env) | Cloud relay URL |
| `POLL_INTERVAL` | Local (.env) | Poll interval in seconds (default: 5) |
| `BROKER_ALLOWED_TOOLS` | Local (.env) | Claude tools (default: WebSearch,Read,...) |

---

## Comparison: Direct Broker vs Relay

| Aspect | `./start.sh line` (direct) | `./start.sh line-relay` |
| ------ | -------------------------- | ----------------------- |
| Webhook | Local (needs ngrok) | Cloud (Cloudflare Workers) |
| Stability | URL changes on restart | Permanent URL |
| Cost | Free (ngrok free) | Free (Workers free tier) |
| Latency | ~1s (direct) | ~5-10s (poll interval + processing) |
| Setup | Simpler | More setup (Workers + KV + secrets) |
| Reply API | Usable (direct, <1min) | Not usable (relay adds latency) |
| Push API | Fallback | Always (500 free/month) |
| Dependencies | ngrok | Cloudflare account |

---

## Troubleshooting

### Verify cloud relay is running

```bash
curl https://line-relay.your-subdomain.workers.dev/health
# Expected: ok
```

### Check queued messages

```bash
curl -H "Authorization: Bearer $RELAY_SECRET" \
  https://line-relay.your-subdomain.workers.dev/messages
```

### Test reply endpoint

```bash
curl -X POST -H "Authorization: Bearer $RELAY_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"userId":"Uxxxxxxxx","text":"test reply"}' \
  https://line-relay.your-subdomain.workers.dev/reply
```

### Check Worker logs

```bash
cd external_plugins/line-channel/relay
bunx wrangler tail
```
