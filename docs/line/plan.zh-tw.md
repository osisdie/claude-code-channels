# Claude Code Channels x LINE 整合規劃

## 背景

使用 LINE Messaging API 將 Claude Code session 連接到 LINE 官方帳號，實現雙向通訊。與 Telegram/Discord/Slack 都使用 outbound 連線不同，**LINE 需要公開的 HTTPS webhook** — 沒有 polling API。

**架構：**

```text
LINE App（手機/桌面）
    | (LINE Platform，webhook POST 到你的伺服器)
LINE Broker (Bun 行程，本地 HTTP server + tunnel)
    | (子行程：claude -p)
Claude CLI（無狀態，每訊息獨立）
```

**關鍵差異：** LINE 需要 **inbound webhook**，打破了其他 channel 使用的「不需要 inbound port」模式。本地開發需要 tunnel（ngrok、Cloudflare Tunnel）。

---

## 前置條件

- [x] Bun runtime（見[前置條件](../prerequisites.zh-tw.md)）
- [x] Claude Code v2.1.80+
- [ ] LINE 官方帳號（透過 [LINE Developers Console](https://developers.line.biz/console/)）
- [ ] Channel Access Token（`LINE_CHANNEL_ACCESS_TOKEN`）
- [ ] Channel Secret（`LINE_CHANNEL_SECRET`）
- [ ] 公開的 HTTPS URL 供 webhook 使用（本地開發需 tunnel）

---

## 實作步驟

### Phase 1: 建立 LINE 官方帳號

1. 前往 [LINE Developers Console](https://developers.line.biz/console/)
2. 登入或建立 LINE 帳號
3. 接受 LINE Developers Agreement
4. 建立 **Provider**（你的組織或個人名稱）
5. 建立 **LINE 官方帳號**並啟用 **Messaging API**
   - 這會自動建立 Messaging API channel
6. 在 channel 設定中：
   - 複製 **Channel Secret**（Basic settings 分頁）
   - 核發 **Channel Access Token**（Messaging API 分頁 > Issue）

### Phase 2: 設定 Webhook

LINE 需要可公開存取的 HTTPS endpoint。本地開發選項：

#### 選項 A: ngrok（推薦用於開發）

```bash
# 安裝 ngrok
brew install ngrok  # 或: snap install ngrok

# 啟動 tunnel（broker 在 port 3000 運行後）
ngrok http 3000
# 複製 https://xxxx.ngrok-free.app URL
```

#### 選項 B: Cloudflare Tunnel

```bash
cloudflared tunnel --url http://localhost:3000
```

在 LINE Developers Console 設定 webhook URL：

- Messaging API 分頁 > Webhook settings
- Webhook URL: `https://xxxx.ngrok-free.app/webhook`
- 點擊 **Verify** 測試
- 啟用 **Use webhook**

### Phase 3: 儲存 Token

將 token 寫入專案級 `.env`（gitignored）：

```bash
echo "LINE_CHANNEL_ACCESS_TOKEN=your-token" >> .env
echo "LINE_CHANNEL_SECRET=your-secret" >> .env
chmod 600 .env
```

> **警告：** 不要將 token 作為指令參數傳遞。它們會洩漏到對話歷史中。見 [docs/issues.md Issue #2](../issues.md)。

### Phase 4: 啟動 LINE Broker

```bash
./start.sh line
```

Broker 會：

1. 在 port 3000（可設定）啟動本地 HTTP server
2. 從 LINE Platform 接收 webhook 事件
3. 使用 Channel Secret 驗證 webhook 簽章
4. 對每個使用者訊息：
   - 下載附件（圖片/檔案）
   - 執行 `claude -p --output-format text "<訊息>"`
   - 使用 Reply API（免費）或 Push API（replyToken 過期時）回覆

### Phase 5: 設定存取控制

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

LINE user ID 是不透明字串（如 `U1234567890abcdef...`）。找到你的 ID：

- 向 bot 發送訊息
- 檢查 broker 日誌中的 `userId` 欄位

### Phase 6: 驗證

1. **基本測試**：在 LINE 上向 bot 發送文字訊息，確認 Claude 回覆
2. **圖片測試**：發送圖片，驗證被下載並分析
3. **Webhook 驗證**：使用 LINE console 的「Verify」按鈕確認連通性
4. **Tunnel 穩定性**：確保 ngrok/cloudflare tunnel 持續連線

---

## Reply API vs Push API

LINE 有兩種發送訊息的方式：

| 面向 | Reply API | Push API |
| ---- | --------- | -------- |
| 費用 | 免費 | 付費（月配額）|
| 觸發 | 需要 webhook 事件的 `replyToken` | 可隨時用 user ID 發送 |
| 限制 | 每個使用者事件 1 次回覆 | 500 則/月（免費方案）|
| Token 有效期 | ~1 分鐘 | 不適用 |
| 使用時機 | 即時回應 | 非同步/延遲回應 |

**Broker 策略：**

1. **優先使用 Reply API** — 免費且有 webhook 事件的 replyToken
2. **退回 Push API** — 若回應時間超過 ~1 分鐘（replyToken 過期）
3. **配額意識** — 追蹤每月 Push API 使用量以避免超額

---

## 預期功能（Broker）

| 功能 | 實作方式 | 狀態 |
| ---- | -------- | ---- |
| 文字回覆 | Reply API / Push API | 規劃中 |
| 圖片下載 | GET `/v2/bot/message/{id}/content` | 規劃中 |
| 貼圖（接收）| 解析 sticker 事件 | 規劃中 |
| 檔案下載 | 同圖片的 content API | 規劃中 |
| 豐富回覆 | Flex Messages（選用，未來）| 未來 |

---

## 與其他 Channel 的差異

| 面向 | Telegram | Discord | Slack | LINE |
| ---- | -------- | ------- | ----- | ---- |
| 連線方式 | Outbound polling | Outbound WebSocket | Outbound polling | **Inbound webhook** |
| 需要公開 URL | 否 | 否 | 否 | **是** |
| Token 數量 | 1（Bot Token）| 1（Bot Token）| 1（Bot Token）| 2（Access Token + Secret）|
| 整合方式 | `--channels` 插件 | `--channels` 插件 | Broker（polling）| Broker（webhook）|
| 回覆模式 | 非同步 | 非同步 | 非同步 | Reply（免費）+ Push（付費）|
| 文字限制 | 4096 字元 | 2000 字元 | 4000 字元 | 5000 字元 |
| 檔案限制 | 50MB | 25MB | 各異 | 10MB（圖片）|
| 訊息歷史 | 不可用 | `fetch_messages` | `conversations.history` | 不可用 |
| 費用 | 免費 | 免費 | 免費 | 免費（Reply）/ 付費（Push）|

---

## Webhook 安全

LINE webhook 事件必須使用 Channel Secret 驗證：

```typescript
import { validateSignature } from '@line/bot-sdk'

// X-Line-Signature header 包含使用 Channel Secret 計算的 HMAC-SHA256
const isValid = validateSignature(body, channelSecret, signature)
```

這可防止偽造的 webhook 呼叫。Broker 必須拒絕簽章無效的請求。

---

## 重要事項

1. **Webhook 是強制的** — LINE 沒有 polling API。必須公開 HTTPS URL。本地開發使用 ngrok 或 Cloudflare Tunnel
2. **WSL2 考量** — Tunnel 從 WSL2 運作正常（它們建立 outbound 連線）。本地 HTTP server 綁定到 `0.0.0.0:3000`
3. **ReplyToken 在 ~1 分鐘後過期** — 若 Claude 回應較久，replyToken 會失效。退回 Push API
4. **Push API 要收費** — 免費方案：500 則/月。正式環境方案有更高額度。Reply API 永遠免費
5. **沒有訊息歷史** — LINE Bot API 沒有類似 Discord `fetch_messages` 或 Slack `conversations.history` 的功能
6. **User ID 是 channel 層級** — 同一 LINE 使用者在不同 channel/provider 有不同 ID
7. **應停用 Bot 自動回覆** — 在 LINE 官方帳號設定中，停用「自動回覆訊息」以避免與 broker 衝突

---

## 關鍵檔案

| 檔案 | 用途 |
| ---- | ---- |
| `external_plugins/line-channel/broker.ts` | LINE webhook broker（規劃中）|
| `.env` | `LINE_CHANNEL_ACCESS_TOKEN`、`LINE_CHANNEL_SECRET`（gitignored）|
| `.claude/channels/line/access.json` | 存取控制（gitignored）|
| `.claude/channels/line/inbox/` | 下載的附件（gitignored）|
| `docs/line/plan.md` | 本規劃文件（英文版）|

---

## 參考資料

- [LINE Messaging API 概觀](https://developers.line.biz/en/docs/messaging-api/overview/)
- [LINE Developers Console](https://developers.line.biz/console/)
- [LINE Bot SDK for Node.js](https://github.com/line/line-bot-sdk-nodejs)
- [Webhook Events](https://developers.line.biz/en/docs/messaging-api/receiving-messages/)
- [發送訊息](https://developers.line.biz/en/docs/messaging-api/sending-messages/)
- [Channel Access Tokens](https://developers.line.biz/en/docs/messaging-api/channel-access-tokens/)
