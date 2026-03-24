# Microsoft Teams — 安裝指南

## 前置需求

- [Bun](https://bun.sh/) 執行環境 + Claude Code v2.1.80+ ([共用設定](../prerequisites.zh-tw.md))
- [Cloudflare](https://dash.cloudflare.com/) 帳號（免費方案）
- [Azure](https://portal.azure.com/) 帳號（免費方案）
- Microsoft Teams（桌面版或網頁版）

## 步驟 1：建立 Azure Bot

1. 前往 [Azure Portal](https://portal.azure.com/) > **建立資源** > 搜尋 "Azure Bot"
2. 點擊 **建立**
3. 填寫：
   - **Bot handle：** 例如 "claude-code-bot"
   - **訂閱：** 你的訂閱
   - **資源群組：** 建立新的或使用現有的
   - **定價層：** F0（免費）
   - **應用程式類型：** Multi Tenant
   - **建立類型：** 建立新的 Microsoft App ID
4. 點擊 **檢閱 + 建立** > **建立**

## 步驟 2：取得憑證

1. 建立完成後，前往 Bot 資源 > **設定**
2. 記下 **Microsoft App ID**
3. 點擊 **管理密碼**（前往 App Registration）
4. 在 **憑證與密碼** > **新增用戶端密碼**
5. 複製 **值**（這是 `MICROSOFT_APP_PASSWORD`）— 只顯示一次

## 步驟 3：部署 Relay Worker

```bash
cd external_plugins/teams-channel/relay

# 建立 KV namespace
npx wrangler kv namespace create TEAMS_QUEUE
# 將 ID 複製到 wrangler.toml

# 設定 secrets
npx wrangler secret put MICROSOFT_APP_ID
npx wrangler secret put MICROSOFT_APP_PASSWORD
npx wrangler secret put RELAY_SECRET           # openssl rand -hex 32

# 部署
npx wrangler deploy
```

記下 Worker URL（例如 `https://teams-relay.your-subdomain.workers.dev`）。

## 步驟 4：設定 Bot 端點

1. 在 Azure Portal > Bot 資源 > **設定**
2. 設定 **訊息端點** 為：`https://teams-relay.your-subdomain.workers.dev/api/messages`
3. 儲存

## 步驟 5：啟用 Teams 頻道

1. 在 Azure Portal > Bot 資源 > **頻道**
2. 點擊 **Microsoft Teams** > **套用**

## 步驟 6：建立 Teams App Manifest

1. 編輯 `external_plugins/teams-channel/manifest/manifest.json`：
   - 將兩處 `REPLACE_WITH_MICROSOFT_APP_ID` 替換為你的 App ID
2. 新增圖示：
   - `color.png` — 192x192 全彩應用程式圖示
   - `outline.png` — 32x32 透明輪廓圖示
3. 建立 ZIP：`cd manifest && zip ../claude-bot.zip *`

## 步驟 7：安裝到 Teams

### 側載（開發用）

1. 在 Teams > **應用程式** > **管理你的應用程式** > **上傳自訂應用程式**
2. 上傳 `claude-bot.zip`
3. 點擊 **新增** 安裝

### 組織（正式環境）

1. 在 Teams 系統管理中心 > **管理應用程式** > **上傳新的應用程式**
2. 上傳 ZIP
3. 為組織核准

## 步驟 8：設定本地 Broker

在 `.env` 檔案中新增：

```bash
TEAMS_RELAY_URL=https://teams-relay.your-subdomain.workers.dev
TEAMS_RELAY_SECRET=<與 wrangler secret 相同的值>
```

可選擇在 `.claude/channels/teams/` 建立 `access.json`：

```json
{
  "allowFrom": ["aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"],
  "groups": {}
}
```

使用者 ID 為 Azure AD Object ID（GUID）。`allowFrom` 為空表示允許所有使用者。

## 步驟 9：啟動

```bash
./start.sh teams
```

## 步驟 10：測試

1. 在 Teams 中找到你的 Bot 應用程式
2. 開始 1:1 聊天並傳送 "Hello"
3. 檢查終端機是否出現 `[teams] <user>: [text] Hello` 日誌
4. Bot 應在 10-30 秒內回覆

## 注意事項

- **必須啟用側載：** Teams 管理員必須允許自訂應用程式上傳。檢查 Teams 系統管理中心 > **組織設定** > **自訂應用程式** = 開啟。
- **JWT 金鑰輪換：** Microsoft 定期輪換 JWKS 金鑰。Relay Worker 快取金鑰 1 小時並自動更新。
- **Service URL 因地區而異：** Azure Bot Service 不同地區使用不同的 Service URL。Relay 會儲存每個 Activity 的 `serviceUrl`。
- **@提及剝離：** 在頻道中，Activity 文字包含 `<at>BotName</at>`。Relay Worker 會自動移除。
- **免費方案：** Azure Bot Service F0 方案包含標準頻道（Teams、Slack 等）的無限訊息。
- **存取控制：** `access.json` 使用 Azure AD Object ID（GUID），非顯示名稱。
