# WhatsApp 整合規劃

## 概述

WhatsApp 整合採用 **relay broker** 模式：Cloudflare Worker 接收 Meta Cloud API 的 webhook 事件，存入 KV 佇列，本地 bridge 輪詢並透過 `claude -p` 處理。

## 架構

```text
WhatsApp 使用者
    |
    v (webhook POST)
Meta Cloud API ──> Cloudflare Worker (whatsapp-relay)
                     - 驗證 HMAC (X-Hub-Signature-256)
                     - 訊息存入 KV 佇列 (1h TTL)
                     - 代理媒體下載 (Graph API)
                     - 透過 Graph API 發送回覆
                     ^
                     | (poll / reply)
                   本地 broker-relay.ts
                     - 每 5 秒輪詢 relay
                     - 安全層（過濾、配額、稽核）
                     - 對話記憶（STM + LTM）
                     - 執行 claude -p
                     - 透過 relay 發送回應
```

## API 細節

- **平台：** Meta Cloud API（免費方案）
- **驗證：** HMAC-SHA256，使用 App Secret（`X-Hub-Signature-256`）
- **Webhook 驗證：** GET 請求帶 `hub.verify_token` + `hub.challenge` 回傳
- **訊息格式：** `entry[].changes[].value.messages[]`
- **回覆：** POST `https://graph.facebook.com/v21.0/{PHONE_NUMBER_ID}/messages`
- **媒體：** 兩步驟 — 取得媒體 metadata → 從 URL 下載二進位檔
- **24 小時視窗：** 使用者主動發起的對話可在 24 小時內自由回覆
- **訊息上限：** 4096 字元（自動分段）

## 支援的訊息類型

| 類型 | 處理 | 備註 |
| ---- | ---- | ---- |
| text | 是 | 主要訊息類型 |
| image | 是 | 透過 relay 代理下載 |
| document | 是 | 下載並保留檔名 |
| audio | 是 | 下載為 .ogg |
| video | 是 | 下載為 .mp4 |
| sticker | 忽略 | 對 AI 無用 |
| location | 忽略 | 擷取經緯度但不處理 |
| contacts | 忽略 | |

## 檔案結構

```text
external_plugins/whatsapp-channel/
  broker-relay.ts              # 本地輪詢器
  relay/
    src/index.ts               # Cloudflare Worker
    wrangler.toml              # Wrangler 設定
```

## 環境變數

### Relay Worker（Cloudflare secrets）

| 變數 | 說明 |
| ---- | ---- |
| `WA_VERIFY_TOKEN` | Webhook 註冊時的驗證字串（自定義） |
| `WA_APP_SECRET` | Facebook App Secret（HMAC 驗證） |
| `WA_ACCESS_TOKEN` | System User 永久 Token |
| `WA_PHONE_NUMBER_ID` | 發送用的電話號碼 ID |
| `RELAY_SECRET` | Broker 驗證用的共享密鑰 |

### 本地 Broker（.env）

| 變數 | 說明 |
| ---- | ---- |
| `WA_RELAY_URL` | Cloudflare Worker URL |
| `WA_RELAY_SECRET` | 共享密鑰 |
| `WA_STATE_DIR` | 狀態目錄（預設：`.claude/channels/whatsapp`） |

## 群組聊天

- 需要觸發前綴：`/ask`、`/ai`、`/bot`、`/claude`
- 每位使用者的圖片緩衝區，5 分鐘 TTL
- 跳過 AI 標籤：`[skip ai]`、`[no ai]`、`[ai skip]`

## 與 LINE Relay 的差異

| 面向 | LINE | WhatsApp |
| ---- | ---- | -------- |
| Webhook 驗證 | HMAC-SHA256（base64） | HMAC-SHA256（hex，`sha256=` 前綴） |
| 媒體下載 | 單步驟（Content API） | 兩步驟（metadata → URL → 二進位） |
| 回覆 API | Push API | Graph API |
| 訊息上限 | 5000 字元 | 4096 字元 |
| 使用者 ID 格式 | 不透明 ID | 電話號碼 |
| 已讀回條 | 不支援 | 支援（標記為已讀） |
