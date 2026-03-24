# Microsoft Teams Integration Plan

## Overview

Teams integration via **relay broker** pattern: Cloudflare Worker receives bot activities from Azure Bot Service, queues in KV, local bridge polls and processes with `claude -p`.

## Architecture

```text
Teams User (1:1 / Group / Channel)
    |
    v (message activity)
Azure Bot Service ──> Cloudflare Worker (teams-relay)
                        - Validate JWT (JWKS from Microsoft)
                        - Queue activities in KV (1h TTL)
                        - Send replies via Bot Connector API
                        ^
                        | (poll / reply)
                      Local broker-relay.ts
                        - Poll relay every 5s
                        - Strip @mention tags
                        - Safety layers (filter, quota, audit)
                        - Session memory (STM + LTM)
                        - Run claude -p
                        - Send response back through relay
```

## API Details

- **Platform:** Azure Bot Framework (Bot Connector REST API)
- **Auth (incoming):** JWT in `Authorization` header, validated against Microsoft JWKS
- **Auth (outgoing):** OAuth2 client credentials → `https://api.botframework.com/.default`
- **Reply:** POST `{serviceUrl}/v3/conversations/{conversationId}/activities`
- **Formatting:** Teams supports markdown (bold, italic, code, lists, code blocks)
- **Bot receives:** All messages in 1:1 chat; @mentioned messages in channels; configurable for group chats

## Activity Types

| Type | Handled | Notes |
| ---- | ------- | ----- |
| message | Yes | Text messages, @mentions stripped |
| messageReaction | Ignored | |
| conversationUpdate | Ignored | Member join/leave events |
| invoke | Ignored | Adaptive Card actions |

## Files

```text
external_plugins/teams-channel/
  broker-relay.ts              # Local poller
  relay/
    src/index.ts               # Cloudflare Worker (JWT validation)
    wrangler.toml              # Wrangler config
  manifest/
    manifest.json              # Teams app manifest (v1.16)
    color.png                  # 192x192 app icon
    outline.png                # 32x32 outline icon
```

## Environment Variables

### Relay Worker (Cloudflare secrets)

| Variable | Description |
| -------- | ----------- |
| `MICROSOFT_APP_ID` | Azure Bot App ID |
| `MICROSOFT_APP_PASSWORD` | Azure Bot client secret |
| `RELAY_SECRET` | Shared secret for broker auth |

### Local Broker (.env)

| Variable | Description |
| -------- | ----------- |
| `TEAMS_RELAY_URL` | Cloudflare Worker URL |
| `TEAMS_RELAY_SECRET` | Shared secret |
| `TEAMS_STATE_DIR` | State directory (default: `.claude/channels/teams`) |

## Group Chat & Channels

- **1:1 chat:** Bot receives all messages, no trigger prefix needed
- **Group chat:** Bot may receive all messages; trigger prefix (`/ask`, `/ai`) filters noise
- **Teams channel:** Bot only receives @mentioned messages; mention tag is stripped before processing
- Skip AI tags: `[skip ai]`, `[no ai]`, `[ai skip]`

## JWT Validation Flow

1. Azure Bot Service sends activity with JWT in `Authorization: Bearer <token>`
2. Worker fetches JWKS from `https://login.botframework.com/v1/.well-known/openidconfiguration` (cached 1h)
3. Validates: expiry, audience (= App ID), issuer (Microsoft), signature (RSA-SHA256)
4. If valid, activity is queued in KV

## Differences from LINE/WhatsApp Relay

| Aspect | LINE/WhatsApp | Teams |
| ------ | ------------- | ----- |
| Incoming auth | HMAC signature | JWT (JWKS validation) |
| Outgoing auth | Static token | OAuth2 client credentials |
| Reply target | userId / phone | serviceUrl + conversationId |
| @mention | Not available (LINE) | Native, stripped before processing |
| Formatting | Plain text | Markdown |
| Media | Content API / Graph API | Attachment URLs in activity |
| App packaging | N/A | Teams manifest ZIP |
