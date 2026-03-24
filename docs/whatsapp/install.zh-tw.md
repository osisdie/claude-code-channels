# WhatsApp — 安裝指南

## 前置需求

- [Bun](https://bun.sh/) 執行環境 + Claude Code v2.1.80+ ([共用設定](../prerequisites.zh-tw.md))
- [Cloudflare](https://dash.cloudflare.com/) 帳號（免費方案）
- [Meta Developer](https://developers.facebook.com/) 帳號

## 步驟 1：建立 Facebook App

1. 前往 [developers.facebook.com/apps](https://developers.facebook.com/apps/)
2. 點擊 **Create App** > **Business** > **Next**
3. 命名（例如 "Claude Bot"）並建立
4. 在應用程式儀表板中，點擊 **Add Product** > **WhatsApp** > **Set Up**

## 步驟 2：取得憑證

在 WhatsApp 產品區域：

1. **Getting Started** 頁面顯示：
   - **Temporary Access Token**（24 小時後過期 — 僅供測試）
   - **Phone Number ID**（測試號碼）
   - **WhatsApp Business Account ID**
2. 正式使用請在 [Meta Business Suite](https://business.facebook.com/settings/system-users) 建立 **System User**：
   - 新增 System User > Admin 角色
   - 產生具有 `whatsapp_business_messaging` 權限的 Token
   - 此 Token 不會過期

## 步驟 3：部署 Relay Worker

```bash
cd external_plugins/whatsapp-channel/relay

# 建立 KV namespace
npx wrangler kv namespace create WA_QUEUE
# 將 ID 複製到 wrangler.toml

# 設定 secrets
npx wrangler secret put WA_VERIFY_TOKEN       # 任意字串
npx wrangler secret put WA_APP_SECRET          # App Settings > App Secret
npx wrangler secret put WA_ACCESS_TOKEN        # 步驟 2 取得
npx wrangler secret put WA_PHONE_NUMBER_ID     # 步驟 2 取得
npx wrangler secret put RELAY_SECRET           # openssl rand -hex 32

# 部署
npx wrangler deploy
```

記下 Worker URL（例如 `https://whatsapp-relay.your-subdomain.workers.dev`）。

## 步驟 4：設定 Webhook

1. 在 Facebook App > **WhatsApp** > **Configuration**
2. 設定 **Callback URL** 為：`https://whatsapp-relay.your-subdomain.workers.dev/webhook`
3. 設定 **Verify Token** 為與 `WA_VERIFY_TOKEN` 相同的值
4. 點擊 **Verify and Save**
5. **重要：訂閱 `messages` webhook 欄位** — 點擊 Webhook fields 旁的 **Manage**，確認 `messages` 已勾選。如果沒有勾選，即使 webhook URL 驗證成功，bot 也不會收到任何訊息。

## 步驟 5：設定本地 Broker

在 `.env` 檔案中新增：

```bash
WA_RELAY_URL=https://whatsapp-relay.your-subdomain.workers.dev
WA_RELAY_SECRET=<與 wrangler secret 相同的值>
```

可選擇在 `.claude/channels/whatsapp/` 建立 `access.json`：

```json
{
  "allowFrom": ["886912345678"],
  "groups": {}
}
```

`allowFrom` 陣列為空表示允許所有使用者。

## 步驟 6：啟動

```bash
./start.sh whatsapp
```

## 步驟 7：測試

1. 從 WhatsApp 發送文字訊息到測試號碼
2. 檢查終端機是否出現 `[whatsapp] <phone>: [text] ...` 日誌
3. Bot 應在 10-30 秒內回覆

## 注意事項

- **Webhook 欄位訂閱：** 驗證 webhook URL 後，必須另外訂閱 `messages` 欄位。驗證步驟只確認 URL 可達 — 不會自動訂閱任何事件。前往 WhatsApp > Configuration > Webhook fields > Manage > 勾選 `messages`。
- **24 小時視窗：** Bot 只能在使用者最後一則訊息的 24 小時內回覆。超過後需要經核准的訊息範本。
- **臨時 Token：** "Getting Started" 的測試 Token 24 小時後過期。正式部署請使用 System User Token。
- **測試號碼：** Meta 提供的測試號碼只能傳訊給「允許清單」中的號碼。正式使用需註冊自己的號碼。
- **存取控制：** `access.json` 使用電話號碼（例如 `"886912345678"`，不含 `+` 前綴）。
