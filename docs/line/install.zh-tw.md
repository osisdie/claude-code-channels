# Claude Code x LINE — 安裝與整合筆記

## 概觀

本文件記錄透過 message broker（2026/03）將 Claude Code 連接到 LINE 的實際安裝與整合經驗。

**架構：**

```text
LINE App（手機/桌面）
    | (LINE Platform, webhook POST)
ngrok / Cloudflare Tunnel
    | (轉發到 localhost:3000)
LINE Broker (Bun HTTP server)
    | (子行程：claude -p)
Claude CLI（無狀態，每訊息獨立）
```

---

## 安裝步驟（已執行）

### 1. 建立 LINE 官方帳號

1. 前往 [LINE Developers Console](https://developers.line.biz/console/)
2. 建立 **Provider**（你的組織名稱）
3. 建立 **LINE 官方帳號**並啟用 **Messaging API**
4. 在 channel 設定中：
   - 複製 **Channel Secret**（Basic settings 分頁）
   - 核發 **Channel Access Token**（Messaging API 分頁 > Issue）

**帳號設定建議：**

| 欄位 | 建議值 |
| ---- | ------ |
| 帳號名稱 | `Claude Code Lab`（或類似的 lab/dev 名稱）|
| 業種 | IT・網際網路・通訊 > 軟體・網路服務 |

> **注意：** 業種建立後**無法修改**。請選擇 IT 相關類別。

### 2. 儲存 Token

```bash
echo "LINE_CHANNEL_ACCESS_TOKEN=your-token" >> .env
echo "LINE_CHANNEL_SECRET=your-secret" >> .env
chmod 600 .env
```

> **警告：** 不要將 token 作為指令參數傳遞。見 [Issue #2](../issues.md)。

### 3. 設定 Tunnel

LINE 需要公開的 HTTPS webhook URL。本地開發：

```bash
ngrok http 3000
# 複製 https://xxxx.ngrok-free.app URL
```

> **注意：** ngrok 免費方案的 URL 每次重啟都會變。每次都需要更新 LINE console 的 webhook URL。

### 4. 設定 LINE Console 的 Webhook

**Messaging API** 分頁 > **Webhook settings：**

1. 設定 Webhook URL 為：`https://xxxx.ngrok-free.app/webhook`
2. 點擊 **Verify** 測試連通性
3. 啟用 **Use webhook**（切換為 ON）

> **常見錯誤：** URL 結尾忘記加 `/webhook`。Broker 只監聽 `/webhook` 路徑，不是根路徑 `/`。

### 5. 停用自動回覆

在 [LINE Official Account Manager](https://manager.line.biz/)：

1. 選擇帳號 > **設定** > **回應設定**
2. 將**自動回覆訊息**設為 **OFF**
3. 將**加入好友的歡迎訊息**設為 **OFF**（選用）

不停用的話，LINE 內建自動回覆會攔截訊息，webhook 收不到。

### 6. 啟用群組聊天（選用）

LINE bot 預設**無法被邀請加入群組**。要啟用：

1. [LINE Official Account Manager](https://manager.line.biz/) > **設定** > **帳號設定**
2. 找到**允許被加入群組或多人聊天室** > 設為 **ON**

> **注意：** 沒有啟用此設定，bot 被邀請後會立即離開群組。Broker log 會顯示 `left group: Cxxxxxxx`。

### 7. 設定存取控制

```bash
mkdir -p .claude/channels/line
```

僅限 DM（允許所有人）：

```bash
cat > .claude/channels/line/access.json << 'EOF'
{
  "dmPolicy": "allowlist",
  "allowFrom": [],
  "groups": {},
  "pending": {}
}
EOF
```

限制特定使用者 + 啟用群組：

```bash
cat > .claude/channels/line/access.json << 'EOF'
{
  "dmPolicy": "allowlist",
  "allowFrom": ["Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"],
  "groups": {
    "Cxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx": {
      "allowFrom": []
    }
  },
  "pending": {}
}
EOF
```

**如何找到 ID：**

- **User ID**：向 bot 發送 DM，檢查 broker log 中的 `Uxxxxxxx: [text] ...`
- **Group ID**：邀請 bot 加入群組，檢查 log 中的 `joined group: Cxxxxxxx`
- 群組 `allowFrom: []` 表示**任何成員**都可觸發 bot
- 修改 `access.json` 後不需重啟 — broker 每次收到訊息都會重新讀取

### 8. 啟動

```bash
./start.sh line
```

---

## 已驗證功能

| 功能 | 狀態 |
| ---- | ---- |
| 文字 DM > Claude > 回覆 | 已驗證 |
| 群組訊息 > Claude > 回覆 | 已驗證 |
| 圖片下載 + 分析 | 已驗證 |
| WebSearch 工具（即時資訊）| 已驗證 |
| 頻率限制（每使用者冷卻）| 已驗證 |
| 忙碌防護（並行請求拒絕）| 已驗證 |
| Webhook 簽章驗證 | 已驗證 |
| Reply API（免費）+ Push API 退回 | 已驗證 |
| Log 檔案持久化 | 已驗證 |

---

## 圖片處理

LINE 將圖片作為獨立的 `message` 事件（`type: "image"`）發送。Broker 會：

1. 透過 LINE Content API 下載圖片
2. 儲存到 `.claude/channels/line/inbox/`
3. 將檔案路徑包含在提示中發送給 Claude
4. Claude 讀取並分析圖片

**限制：**

- LINE 不支援在單一訊息中同時發送文字 + 圖片，它們是獨立事件
- 先發送圖片，再發送文字問題（如「What's this?」）
- 僅有圖片的訊息自動提示：「Describe the attached file(s)」
- 圖片最大 10MB

---

## 工具存取

Broker 以 `--allowedTools` 執行 `claude -p`，啟用即時功能：

**預設啟用的工具：**

- `WebSearch` — 搜尋網路（天氣、新聞、價格等）
- `WebFetch` — 抓取網頁
- `Bash(curl:*)` — API 呼叫
- `Bash(python3:*)` — 運算
- `Read` — 讀取本地檔案和圖片

**透過環境變數自訂：**

```bash
BROKER_ALLOWED_TOOLS="WebSearch,Read" ./start.sh line
```

---

## 頻率限制與忙碌防護

| 防護 | 行為 | 預設值 |
| ---- | ---- | ------ |
| **忙碌防護** | Claude 處理中時，新訊息回覆「⏳ Processing...」| 永遠啟用 |
| **頻率限制** | 每使用者的訊息間隔 | 5 秒（`RATE_LIMIT_MS=5000`）|

兩者都使用 LINE Reply API（免費）— 不消耗 Push API 配額。

---

## 安全注意事項

1. **Webhook 簽章驗證** — 每個 webhook 都使用 Channel Secret 進行 HMAC-SHA256 驗證
2. **Token 儲存** — Token 在 `.env`（gitignored），絕不作為指令參數傳遞
3. **存取控制** — `access.json` 控制誰可以互動。`allowFrom` 為空 = 所有人允許
4. **群組隔離** — 群組必須在 `access.json` 中明確 opt-in，未 opt-in 的群組被靜默忽略
5. **無對話持久化** — 每個訊息產生獨立的 `claude -p` 呼叫，無聊天歷史

---

## Tunnel 注意事項

### ngrok 免費方案

- URL 每次重啟都會改變 — 必須每次更新 LINE console 的 webhook URL
- 已認證帳號（有 authtoken）不會顯示瀏覽器攔截頁面
- 執行 `ngrok config add-authtoken <token>` 一次即可認證

### WSL2

- Tunnel 從 WSL2 運作正常（outbound 連線）
- Broker 綁定到 `0.0.0.0:3000`

---

## 設定

| 變數 | 預設值 | 說明 |
| ---- | ------ | ---- |
| `LINE_CHANNEL_ACCESS_TOKEN` | （必要）| Channel Access Token |
| `LINE_CHANNEL_SECRET` | （必要）| Channel Secret（webhook 驗證）|
| `LINE_STATE_DIR` | `.claude/channels/line` | 狀態目錄 |
| `PORT` | `3000` | Webhook server port |
| `CLAUDE_BIN` | `claude` | claude CLI 路徑 |
| `BROKER_ALLOWED_TOOLS` | `WebSearch,WebFetch,...` | 逗號分隔的工具列表 |
| `BROKER_SYSTEM_PROMPT` | （內建）| Claude 的自訂系統提示 |
| `RATE_LIMIT_MS` | `5000` | 每使用者冷卻時間（毫秒）|

---

## 注意事項與經驗教訓

1. **Webhook URL 必須以 `/webhook` 結尾** — Broker 只監聽 `/webhook` 路徑。在 LINE console 設定根 URL（沒有 `/webhook`）會導致 404，收不到訊息
2. **Bot 預設不能加入群組** — 必須在 LINE 官方帳號設定中啟用「允許被加入群組」。否則 bot 被邀請後立即離開（log 顯示 `left group: Cxxxxxxx`）
3. **Group ID 必須在 access.json 中** — 即使啟用了群組聊天，群組訊息仍會被靜默忽略，除非 group ID 加入 `access.json` 的 `groups`
4. **必須停用自動回覆** — LINE 內建自動回覆會攔截訊息。在 Official Account Manager > 回應設定中停用
5. **業種無法更改** — 建立 LINE 官方帳號時選擇正確的業種。建議 IT / 軟體
6. **圖片和文字是獨立事件** — LINE 不支援合併的文字 + 圖片訊息。先發圖片，再發文字
7. **Reply API 免費但 ~60 秒過期** — 若 Claude 處理超過 ~60 秒，replyToken 過期，退回 Push API（每月免費配額 500 則）
8. **ngrok URL 重啟會變** — 每次 ngrok 重啟都須更新 LINE console 的 webhook URL
9. **每訊息無狀態** — 每個訊息產生獨立的 `claude -p` 呼叫，訊息間無對話上下文
10. **頻率限制** — 預設每使用者 5 秒冷卻。忙碌回覆使用 Reply API（免費）
