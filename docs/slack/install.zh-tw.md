# Claude Code x Slack — 安裝與整合筆記

## 概觀

本文件記錄透過官方插件（2026/03）將 Claude Code 連接到 Slack 的實際安裝與整合經驗。

**重要：** `slack@claude-plugins-official` 插件是 **MCP 工具整合**（僅 outbound），不是像 Discord/Telegram 那樣的 **channel 插件**。它無法接收 inbound DM 或作為雙向橋接。見 [docs/issues.md Issue #3](../issues.md)。

**環境：**

- OS: WSL2 (Linux 6.6.87.2-microsoft-standard-WSL2)
- Claude Code: v2.1.81
- Runtime: Bun
- 插件：`slack@claude-plugins-official` v1.0.0
- 原始碼：[slackapi/slack-mcp-cursor-plugin](https://github.com/slackapi/slack-mcp-cursor-plugin)

---

## 插件架構（MCP，非 Channel）

```text
Claude Code Session
    | (MCP 工具呼叫)
Slack MCP Plugin (HTTP client)
    | (OAuth + HTTPS)
mcp.slack.com (Slack 的 MCP server)
    | (Slack Web API)
Slack Workspace
```

| 面向   | Channel 插件（Discord/Telegram） | Slack MCP 插件       |
| ------ | -------------------------------- | -------------------- |
| 類型   | `claude/channel` 能力           | MCP 工具（HTTP）     |
| 方向   | 雙向（DM 橋接）                 | 僅 outbound          |
| 連線   | Bot Token -> 本地 `server.ts`   | OAuth -> `mcp.slack.com` |
| 啟動   | `./start.sh discord`            | 在 session 中自動載入 |
| 認證   | `.env` 檔案（Bot Token）        | OAuth（瀏覽器）      |
| 配對   | 有（`/channel:access pair`）    | 無                   |

---

## 安裝步驟（已執行）

### 1. 建立 Slack App

1. 前往 [Slack API — Your Apps](https://api.slack.com/apps)
2. 點擊 **Create New App** > **From scratch**
3. 名稱：`Claude Code Bot`，選擇 workspace
4. 前往 **OAuth & Permissions** > **Bot Token Scopes**，新增：
   - `chat:write` — 發送訊息
   - `channels:read`、`channels:history` — 讀取頻道
   - `im:read`、`im:write`、`im:history` — DM 存取
   - `files:read`、`files:write` — 檔案分享
   - `reactions:write` — emoji 反應
   - `users:read` — 使用者資訊查詢
5. **安裝到 Workspace** 並複製 **Bot User OAuth Token**（`xoxb-*`）

### 2. 啟用與 Bot 的 DM（煙霧測試必要）

1. 在 Slack App 設定中，前往 **App Home**
2. 在 **Show Tabs** 下，啟用 **Messages Tab**
3. 勾選：**「Allow users to send Slash commands and messages from the messages tab」**
4. 若提示則**重新安裝** app

### 3. 啟用 Socket Mode（為未來的 channel 插件準備）

> 此步驟對目前的 MCP 插件為選擇性，但為未來的 channel 插件做準備。

1. 前往 app 設定中的 **Socket Mode**
2. 開啟 **Enable Socket Mode**
3. 產生 **App-Level Token**（`xapp-*`），範圍為 `connections:write`
4. 前往 **Event Subscriptions** > 啟用，新增 **Bot Events**：`message.im`

### 4. 儲存 Token

將 token 寫入專案級 `.env`（gitignored）：

```bash
# 專案根目錄 .env
echo "SLACK_BOT_TOKEN=xoxb-..." >> .env
echo "SLACK_APP_TOKEN=xapp-..." >> .env
chmod 600 .env
```

> **警告：** 不要將 token 作為指令參數傳遞。它們會洩漏到對話歷史中。見 [docs/issues.md Issue #2](../issues.md)。

### 5. 安裝 Slack 插件

在 Claude Code session 內：

```text
/plugin install slack@claude-plugins-official
```

首次使用任何 `/slack:*` 指令時，會提示你透過瀏覽器進行 OAuth 認證。

### 6. 驗證 Token

執行驗證腳本：

```bash
./scripts/verify_slack.sh
```

或手動：

```bash
# 驗證 Bot Token
source .env
curl -s -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  https://slack.com/api/auth.test | python3 -m json.tool

# 驗證 App Token（Socket Mode）
curl -s -H "Authorization: Bearer $SLACK_APP_TOKEN" \
  -X POST https://slack.com/api/apps.connections.open | python3 -m json.tool
```

---

## 已驗證功能

### MCP 插件（Outbound）

| 功能       | 指令 / Skill                | 狀態   |
| ---------- | --------------------------- | ------ |
| 發送訊息   | `/slack:slack-messaging`    | 已驗證 |
| 搜尋訊息   | `/slack:slack-search`       | 可用   |
| 頻道摘要   | `/slack:summarize-channel`  | 可用   |
| 頻道摘要集 | `/slack:channel-digest`     | 可用   |
| 搜尋討論   | `/slack:find-discussions`   | 可用   |
| 產生站會   | `/slack:standup`            | 可用   |
| 草擬公告   | `/slack:draft-announcement` | 可用   |

### 直接 API（Bot Token）

| 功能                         | API                  | 狀態   |
| ---------------------------- | -------------------- | ------ |
| `auth.test`                  | 驗證 bot 身份        | 已驗證 |
| `apps.connections.open`      | 驗證 Socket Mode     | 已驗證 |
| `conversations.list` (type=im) | 列出 DM 頻道      | 已驗證 |
| `users.info`                 | 解析使用者 ID 為名稱 | 已驗證 |
| `chat.postMessage`           | 發送訊息到 DM        | 已驗證 |

### 煙霧測試結果

```text
Bot 身份:   claude_code (U0AMVM0FJTD) on osisdie.slack.com
Bot 名稱:   Claude Code Bot (B0ANWB1933J)
DM 頻道:    3 (bot 自己、使用者 osisdie、Slackbot)
使用者 DM:  D0AN5L9LEUC -> osisdie (UMU9QLY79)
發送訊息:   ok（到使用者 DM）
Socket Mode: ok（已回傳 WSS URL）
```

---

## 雙向 DM：尚未支援

DM bot 時會顯示「Sending messages to this app has been turned off」，直到啟用 **Messages Tab**（上方步驟 2）。即使啟用後，bot 在 Slack API 層級接收到你的 DM，但**不會轉發到 Claude Code**，因為：

1. Slack 插件**沒有 `server.ts`**（沒有本地行程監聽事件）
2. 它**沒有 `claude/channel` 能力**（沒有 MCP 通知橋接）
3. 它連接到 `mcp.slack.com`（HTTP），而非 Slack 的 Socket Mode WebSocket

真正的雙向 Slack channel 需要建立新的插件。見 [docs/slack/plan.md](plan.md) 了解提議的架構。

---

## 關鍵檔案

| 檔案                        | 用途                                   |
| --------------------------- | -------------------------------------- |
| `.env`                      | `SLACK_BOT_TOKEN`、`SLACK_APP_TOKEN`（gitignored）|
| `scripts/verify_slack.sh`   | Token 驗證與煙霧測試腳本              |
| `docs/slack/plan.md`       | 整合計畫與未來 channel 架構            |
| `docs/slack/install.md`    | 本文件（英文版）                       |
| `docs/issues.md`           | 已知問題（Issue #3：Slack 非 channel） |

---

## 注意事項與經驗教訓

1. **非 channel 插件** — `slack@claude-plugins-official` 僅為 MCP 工具（outbound）。無法接收 DM 或作為雙向橋接。見 [Issue #3](../issues.md)
2. **必須啟用 Messages Tab** — 否則使用者 DM bot 時會看到「Sending messages to this app has been turned off」
3. **OAuth vs Bot Token** — MCP 插件使用 OAuth 連接 `mcp.slack.com`。Bot Token（`xoxb-*`）用於直接 API 呼叫和未來的 channel 插件
4. **需要兩個 token** — Bot Token（`xoxb-*`）用於 API 操作，App-Level Token（`xapp-*`）用於 Socket Mode。兩者都存在 `.env`
5. **`./start.sh slack` 會報錯** — Slack 不在 channel 插件對應表中。請在任何 Claude Code session 內使用 `/slack:*` 指令
6. **Token 洩漏** — 與 Discord/Telegram 相同：絕不要將 token 作為 slash command 參數傳遞
