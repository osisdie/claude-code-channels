# WhatsApp — Installation Guide

## Prerequisites

- [Bun](https://bun.sh/) runtime + Claude Code v2.1.80+ ([shared setup](../prerequisites.md))
- [Cloudflare](https://dash.cloudflare.com/) account (free tier)
- [Meta Developer](https://developers.facebook.com/) account

## Step 1: Create a Facebook App

1. Go to [developers.facebook.com/apps](https://developers.facebook.com/apps/)
2. Click **Create App** > **Business** > **Next**
3. Name it (e.g., "Claude Bot") and create
4. In the app dashboard, click **Add Product** > **WhatsApp** > **Set Up**

## Step 2: Get Credentials

In the WhatsApp product section:

1. **Getting Started** page shows:
   - **Temporary Access Token** (expires in 24h — use for testing)
   - **Phone Number ID** (your test number)
   - **WhatsApp Business Account ID**
2. For production, create a **System User** in [Meta Business Suite](https://business.facebook.com/settings/system-users):
   - Add System User > Admin role
   - Generate token with `whatsapp_business_messaging` permission
   - This token does not expire

## Step 3: Deploy the Relay Worker

```bash
cd external_plugins/whatsapp-channel/relay

# Create KV namespace
npx wrangler kv namespace create WA_QUEUE
# Copy the ID to wrangler.toml

# Set secrets
npx wrangler secret put WA_VERIFY_TOKEN       # any string you choose
npx wrangler secret put WA_APP_SECRET          # App Settings > App Secret
npx wrangler secret put WA_ACCESS_TOKEN        # from Step 2
npx wrangler secret put WA_PHONE_NUMBER_ID     # from Step 2
npx wrangler secret put RELAY_SECRET           # openssl rand -hex 32

# Deploy
npx wrangler deploy
```

Note the worker URL (e.g., `https://whatsapp-relay.your-subdomain.workers.dev`).

## Step 4: Configure Webhook

1. In the Facebook App > **WhatsApp** > **Configuration**
2. Set **Callback URL** to: `https://whatsapp-relay.your-subdomain.workers.dev/webhook`
3. Set **Verify Token** to the same value as `WA_VERIFY_TOKEN`
4. Click **Verify and Save**
5. **IMPORTANT: Subscribe to the `messages` webhook field** — click **Manage** next to Webhook fields and ensure `messages` is checked. Without this, the bot will never receive incoming messages even though the webhook URL is verified.

## Step 5: Configure Local Broker

Add to your `.env` file:

```bash
WA_RELAY_URL=https://whatsapp-relay.your-subdomain.workers.dev
WA_RELAY_SECRET=<same value as wrangler secret>
```

Optionally create `access.json` in `.claude/channels/whatsapp/`:

```json
{
  "allowFrom": ["886912345678"],
  "groups": {}
}
```

Empty `allowFrom` array means all users are allowed.

## Step 6: Launch

```bash
./start.sh whatsapp
```

## Step 7: Test

1. Send a text message from WhatsApp to the test number
2. Check the terminal for `[whatsapp] <phone>: [text] ...` log
3. Bot should reply within 10-30 seconds

## Gotchas

- **Webhook field subscription:** After verifying the webhook URL, you must separately subscribe to the `messages` field. The verification step only confirms the URL is reachable — it does NOT auto-subscribe to any events. Go to WhatsApp > Configuration > Webhook fields > Manage > check `messages`.
- **24-hour window:** Bot can only reply within 24 hours of the user's last message. After that, you need approved message templates (not applicable for interactive chat use).
- **Temporary token:** The test token from "Getting Started" expires in 24h. Use a System User token for persistent deployment.
- **Phone number:** The test number provided by Meta can only message numbers added to the "Allow List" in WhatsApp > Getting Started. For production, register your own number.
- **Rate limits:** Business tier allows 80 messages/second. The broker's per-user rate limiting (default 5s) is well within this.
- **Media download:** Two-step process (get URL → fetch binary) is handled by the relay worker's `/media/:id` endpoint. The broker only sees a single HTTP call.
- **Access control:** `access.json` uses phone numbers (e.g., `"886912345678"` without the `+` prefix).
