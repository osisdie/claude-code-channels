# Microsoft Teams — Installation Guide

## Prerequisites

- [Bun](https://bun.sh/) runtime + Claude Code v2.1.80+ ([shared setup](../prerequisites.md))
- [Cloudflare](https://dash.cloudflare.com/) account (free tier)
- [Azure](https://portal.azure.com/) account (free tier)
- Microsoft Teams (desktop or web)

## Step 1: Create an Azure Bot

1. Go to [Azure Portal](https://portal.azure.com/) > **Create a resource** > search "Azure Bot"
2. Click **Create**
3. Fill in:
   - **Bot handle:** e.g., "claude-code-bot"
   - **Subscription:** your subscription
   - **Resource group:** create new or use existing
   - **Pricing tier:** F0 (Free)
   - **Type of app:** Multi Tenant
   - **Creation type:** Create new Microsoft App ID
4. Click **Review + Create** > **Create**

## Step 2: Get Credentials

1. After creation, go to the bot resource > **Configuration**
2. Note the **Microsoft App ID**
3. Click **Manage Password** (goes to App Registration)
4. Under **Certificates & secrets** > **New client secret**
5. Copy the **Value** (this is `MICROSOFT_APP_PASSWORD`) — it's only shown once

## Step 3: Deploy the Relay Worker

```bash
cd external_plugins/teams-channel/relay

# Create KV namespace
npx wrangler kv namespace create TEAMS_QUEUE
# Copy the ID to wrangler.toml

# Set secrets
npx wrangler secret put MICROSOFT_APP_ID
npx wrangler secret put MICROSOFT_APP_PASSWORD
npx wrangler secret put RELAY_SECRET           # openssl rand -hex 32

# Deploy
npx wrangler deploy
```

Note the worker URL (e.g., `https://teams-relay.your-subdomain.workers.dev`).

## Step 4: Configure Bot Endpoint

1. In Azure Portal > your bot resource > **Configuration**
2. Set **Messaging endpoint** to: `https://teams-relay.your-subdomain.workers.dev/api/messages`
3. Save

## Step 5: Enable Teams Channel

1. In Azure Portal > your bot resource > **Channels**
2. Click **Microsoft Teams** > **Apply**

## Step 6: Create Teams App Manifest

1. Edit `external_plugins/teams-channel/manifest/manifest.json`:
   - Replace both `REPLACE_WITH_MICROSOFT_APP_ID` with your App ID
2. Add icons:
   - `color.png` — 192x192 full-color app icon
   - `outline.png` — 32x32 transparent outline icon
3. Create ZIP: `cd manifest && zip ../claude-bot.zip *`

## Step 7: Install in Teams

### Sideloading (Development)

1. In Teams > **Apps** > **Manage your apps** > **Upload a custom app**
2. Upload `claude-bot.zip`
3. Click **Add** to install for yourself

### Organization (Production)

1. In Teams Admin Center > **Manage apps** > **Upload new app**
2. Upload the ZIP
3. Approve for your organization

## Step 8: Configure Local Broker

Add to your `.env` file:

```bash
TEAMS_RELAY_URL=https://teams-relay.your-subdomain.workers.dev
TEAMS_RELAY_SECRET=<same value as wrangler secret>
```

Optionally create `access.json` in `.claude/channels/teams/`:

```json
{
  "allowFrom": ["aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"],
  "groups": {}
}
```

User IDs are Azure AD Object IDs (GUIDs). Empty `allowFrom` means all users are allowed.

## Step 9: Launch

```bash
./start.sh teams
```

## Step 10: Test

1. In Teams, find your bot in the Apps section
2. Start a 1:1 chat and send "Hello"
3. Check the terminal for `[teams] <user>: [text] Hello` log
4. Bot should reply within 10-30 seconds

## Using in Channels

To use the bot in a Teams channel:

1. Go to the channel > **+** (Add a tab) or right-click channel > **Manage channel** > **Apps**
2. Add your bot app
3. @mention the bot: `@Claude Bot /ask What's the weather?`

## Gotchas

- **Sideloading must be enabled:** Teams admin must allow custom app uploads. Check Teams Admin Center > **Org-wide app settings** > **Custom apps** = On.
- **JWT key rotation:** Microsoft rotates JWKS keys periodically. The relay worker caches keys for 1 hour and refreshes automatically.
- **Service URL varies:** Azure Bot Service uses different service URLs per region. The relay stores `serviceUrl` from each activity and uses it for replies.
- **@mention stripping:** In channels, the activity text includes `<at>BotName</at>`. This is automatically stripped by the relay worker.
- **Conversation ID format:** Teams conversation IDs are long strings (not GUIDs). They change between 1:1, group, and channel contexts.
- **Free tier:** Azure Bot Service F0 tier includes unlimited messages for standard channels (Teams, Slack, etc.).
- **Access control:** `access.json` uses Azure AD Object IDs (GUIDs), not display names. Find these in Azure Portal > Users, or from the bot's activity logs.
