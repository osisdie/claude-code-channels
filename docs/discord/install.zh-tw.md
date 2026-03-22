# Claude Code x Discord Channel — 安裝與整合筆記

## 概觀

本文件記錄透過官方 Channels 插件（研究預覽版，2026/03）將 Claude Code 連接到 Discord 的實際安裝與整合經驗。

**環境：**

- OS: WSL2 (Linux 6.6.87.2-microsoft-standard-WSL2)
- Claude Code: v2.1.81
- Model: Claude Opus 4.6 (1M context)
- Runtime: Bun

---

## 安裝步驟（已執行）

### 1. 建立 Discord Bot

1. 前往 [Discord Developer Portal](https://discord.com/developers/applications)
2. 點擊 **New Application**，命名
3. 前往 **Bot** 區段：
   - 建立使用者名稱
   - 點擊 **Reset Token** 並複製（僅顯示一次）
   - 在 Privileged Gateway Intents 下啟用 **Message Content Intent**
4. 前往 **OAuth2 > URL Generator**：
   - 範圍：`bot`
   - 權限：View Channels、Send Messages、Send Messages in Threads、Read Message History、Attach Files、Add Reactions
   - Integration type：**Guild Install**
5. 開啟產生的 URL 將 bot 加入你的伺服器

### 2. 安裝 Discord 插件

在 Claude Code session 內：

```text
/plugin marketplace add anthropics/claude-plugins-official
/plugin install discord@claude-plugins-official
```

### 3. 設定 Bot Token

將 token 直接寫入 `.env` 檔案：

```bash
mkdir -p .claude/channels/discord
echo "DISCORD_BOT_TOKEN=<YOUR_TOKEN>" > .claude/channels/discord/.env
chmod 600 .claude/channels/discord/.env
```

> **警告：** 不要將 token 作為指令參數傳遞（如 `/discord:configure <token>`）。這會將 token 洩漏到對話歷史中。請直接寫入 `.env` 檔案。見 [docs/issues.md Issue #2](../issues.md)。

### 4. 啟動 Channel

```bash
./start.sh discord
# 或同時啟動兩個 channel：
./start.sh telegram discord
```

### 5. 配對 Discord 帳號

1. 在 Discord 上 DM Bot
2. Bot 回覆一組 **6 位配對碼**
3. 在 Claude Code 終端：

   ```text
   /discord:access pair <CODE>
   ```

4. Bot 確認："Paired! Say hi to Claude."
5. 鎖定存取為白名單模式：

   ```text
   /discord:access policy allowlist
   ```

---

## 已驗證功能

### 基本訊息（雙向）

| 方向                   | 方式                                                     | 狀態   |
| ---------------------- | -------------------------------------------------------- | ------ |
| Discord -> Claude Code | 使用者 DM Bot，在 session 中顯示為 `<channel>`           | 已驗證 |
| Claude Code -> Discord | 使用 `mcp__plugin_discord_discord__reply` 工具加 `chat_id` | 已驗證 |

### 可用 MCP 工具

| 工具                  | 說明                                                           | 已測試 |
| --------------------- | -------------------------------------------------------------- | ------ |
| `reply`               | 發送訊息到 Discord（支援文字、最大 25MB 附件、最多 10 個檔案）| 是     |
| `react`               | 添加 emoji 反應（unicode 或自訂 `<:name:id>`）                | -      |
| `edit_message`        | 編輯先前發送的 Bot 訊息                                       | -      |
| `fetch_messages`      | 取得最近 100 則訊息（由舊到新）                                | -      |
| `download_attachment` | 下載收到的附件                                                 | -      |

**備註：** Discord 插件有 `fetch_messages`，Telegram 沒有 — 可以查看頻道歷史訊息。

### 透過 Discord 的審批流程

與 Telegram 相同的模式：

1. Claude Code 透過 `reply` 發送審批請求到 Discord
2. Session 暫停，等待下一個對話輪次
3. 使用者在 Discord 上回覆 `approve` 或 `reject`
4. 回覆作為 `<channel>` 訊息進入 session
5. Claude Code 根據回應繼續執行

---

## 權限設定

### 白名單工具（`.claude/settings.local.json`）

將 Discord reply 加入權限白名單，讓 Bot 可以隨時回應：

```json
{
  "permissions": {
    "allow": [
      "mcp__plugin_discord_discord__reply"
    ]
  }
}
```

---

## 架構

```text
Discord App（桌面/手機/網頁）
    | (WebSocket Gateway, plugin 以 outbound 連線)
Discord Plugin (Bun subprocess, MCP Server)
    | (stdio transport)
Claude Code Session（本地，有完整檔案系統存取）
```

- **不需要 inbound port** — 插件以 outbound 方式透過 WebSocket 連線
- **WSL2 相容** — 不需要防火牆設定
- **不需要外部伺服器** — 一切在本地執行

---

## 關鍵檔案

| 檔案                                      | 用途                             |
| ----------------------------------------- | -------------------------------- |
| `start.sh`                                | 啟動腳本（含 `--channels` 旗標）|
| `.env.example`                            | 環境變數範本                     |
| `.gitignore`                              | 排除機密、channel 狀態、本地設定 |
| `.claude/settings.local.json`             | 權限白名單（gitignored）         |
| `.claude/channels/discord/.env`           | Bot token（gitignored）          |
| `.claude/channels/discord/access.json`    | 存取控制與白名單（gitignored）   |
| `docs/discord/plan.md`                   | 規劃文件                         |
| `docs/discord/install.md`                | 本文件（英文版）                 |
| `docs/issues.md`                         | 已知問題（跨 channel）           |

---

## 與 Telegram 的主要差異

| 面向         | Telegram          | Discord                      |
| ------------ | ----------------- | ---------------------------- |
| 連線方式     | HTTP long-polling | WebSocket Gateway            |
| 訊息歷史     | 不可用            | `fetch_messages`（最多 100） |
| ID 格式      | 數值 chat_id      | Snowflake ID（數值）         |
| 群組存取     | 透過白名單        | 按 channel ID 啟用           |
| 檔案限制     | 每檔 50MB         | 每檔 25MB，最多 10 個檔案    |

---

## 注意事項與經驗教訓

1. **離線訊息會遺失** — Bot 僅在 session 運行時接收訊息
2. **權限阻塞** — 未加白名單的工具呼叫會阻塞 session 直到在終端核准；請將常用的安全工具加入白名單
3. **State 目錄路徑不符** — 見 [docs/issues.md](../issues.md) 了解 `DISCORD_STATE_DIR` 與 skill 路徑不符的問題
4. **Token 安全** — 絕不要將 bot token 作為指令參數傳遞；直接寫入 `.env` 檔案
5. **Bot API 速率限制** — Discord 的速率限制比 Telegram 嚴格；插件會內部處理
