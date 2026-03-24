# WhatsApp Integration Plan

## Overview

WhatsApp integration via **relay broker** pattern: Cloudflare Worker receives webhook events from Meta Cloud API, queues in KV, local bridge polls and processes with `claude -p`.

## Architecture

```text
WhatsApp User
    |
    v (webhook POST)
Meta Cloud API ──> Cloudflare Worker (whatsapp-relay)
                     - Verify HMAC (X-Hub-Signature-256)
                     - Queue messages in KV (1h TTL)
                     - Proxy media downloads (Graph API)
                     - Send replies via Graph API
                     ^
                     | (poll / reply)
                   Local broker-relay.ts
                     - Poll relay every 5s
                     - Safety layers (filter, quota, audit)
                     - Session memory (STM + LTM)
                     - Run claude -p
                     - Send response back through relay
```

## API Details

- **Platform:** Meta Cloud API (free tier)
- **Auth:** HMAC-SHA256 via App Secret (`X-Hub-Signature-256`)
- **Webhook verification:** GET with `hub.verify_token` + `hub.challenge` echo
- **Message payload:** `entry[].changes[].value.messages[]`
- **Reply:** POST `https://graph.facebook.com/v21.0/{PHONE_NUMBER_ID}/messages`
- **Media:** Two-step — GET media metadata → fetch binary from URL
- **24-hour window:** User-initiated conversations allow free-form replies for 24h
- **Max message:** 4096 chars (auto-chunked)

## Message Types Supported

| Type | Handled | Notes |
| ---- | ------- | ----- |
| text | Yes | Primary message type |
| image | Yes | Downloaded via relay proxy |
| document | Yes | Downloaded, filename preserved |
| audio | Yes | Downloaded as .ogg |
| video | Yes | Downloaded as .mp4 |
| sticker | Ignored | Not useful for AI |
| location | Ignored | Lat/long captured but not processed |
| contacts | Ignored | |

## Files

```text
external_plugins/whatsapp-channel/
  broker-relay.ts              # Local poller
  relay/
    src/index.ts               # Cloudflare Worker
    wrangler.toml              # Wrangler config
```

## Environment Variables

### Relay Worker (Cloudflare secrets)

| Variable | Description |
| -------- | ----------- |
| `WA_VERIFY_TOKEN` | Arbitrary string for webhook registration |
| `WA_APP_SECRET` | Facebook App Secret (HMAC verification) |
| `WA_ACCESS_TOKEN` | System User permanent token |
| `WA_PHONE_NUMBER_ID` | Phone number ID for sending |
| `RELAY_SECRET` | Shared secret for broker auth |

### Local Broker (.env)

| Variable | Description |
| -------- | ----------- |
| `WA_RELAY_URL` | Cloudflare Worker URL |
| `WA_RELAY_SECRET` | Shared secret |
| `WA_STATE_DIR` | State directory (default: `.claude/channels/whatsapp`) |

## Group Chat

- Trigger prefix required: `/ask`, `/ai`, `/bot`, `/claude`
- Per-user image buffer with 5-min TTL
- Skip AI tags: `[skip ai]`, `[no ai]`, `[ai skip]`

## Differences from LINE Relay

| Aspect | LINE | WhatsApp |
| ------ | ---- | -------- |
| Webhook verification | HMAC-SHA256 (base64) | HMAC-SHA256 (hex, `sha256=` prefix) |
| Media download | Single step (Content API) | Two step (metadata → URL → binary) |
| Reply API | Push API | Graph API |
| Message limit | 5000 chars | 4096 chars |
| User ID format | Opaque ID | Phone number |
| Read receipts | Not available | Supported (mark as read) |
