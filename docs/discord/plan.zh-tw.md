# Claude Code Channels × Discord 串接計畫

## Context

使用官方 **Claude Code Channels** Discord 插件，將 Claude Code session 與 Discord Bot 串接，實現雙向溝通。架構與 Telegram 相同：outbound 連線，不需要開 inbound port。

**架構概覽：**

```text
Discord App (桌面/手機/網頁)
    | (WebSocket Gateway, plugin 主動連線)
Discord Plugin (Bun subprocess, MCP Server)
    | (stdio transport)
Claude Code Session (本地，有完整檔案系統存取)
```

---

## 前置條件

- [x] Bun runtime（已為 Telegram 安裝）
- [x] Claude Code v2.1.80+（v2.1.81）
- [ ] Discord Bot Token（從 Discord Developer Portal 取得）
- [ ] Discord Bot 已加入目標伺服器並設定正確權限

---

## 實作步驟

### Phase 1: 建立 Discord Bot

1. 前往 [Discord Developer Portal](https://discord.com/developers/applications)
2. 點擊 **New Application**，命名
3. 進入 **Bot** 區段：
   - 建立 username
   - 點擊 **Reset Token** 並複製（僅顯示一次）
   - 啟用 **Message Content Intent**（位於 Privileged Gateway Intents）
4. 進入 **OAuth2 > URL Generator**：
   - Scope: `bot`
   - 權限：
     - View Channels
     - Send Messages
     - Send Messages in Threads
     - Read Message History
     - Attach Files
     - Add Reactions
   - Integration type: **Guild Install**
5. 開啟產生的 URL，將 Bot 加入你的伺服器

### Phase 2: 安裝 Discord Plugin

在 Claude Code session 內執行：

```text
/plugin install discord@claude-plugins-official
/discord:configure <DISCORD_BOT_TOKEN>
```

Token 儲存於專案層級：`.claude/channels/discord/.env`

### Phase 3: 啟動 Discord Channel

```bash
./start.sh discord
# 或同時啟動兩個 channel：
./start.sh telegram discord
```

### Phase 4: 配對 Discord 帳號

1. 在 Discord 私訊你的 Bot
2. Bot 回覆 **配對碼**
3. 在 Claude Code terminal 輸入：

   ```text
   /discord:access pair <CODE>
   ```

4. 鎖定存取：

   ```text
   /discord:access policy allowlist
   ```

### Phase 5: 驗證測試

1. **基本測試**：私訊 Bot，確認 Claude Code 收到並回覆
2. **伺服器頻道**：以頻道 ID 加入（opt-in）一個伺服器頻道
3. **審批流程**：透過 Discord 測試 approve/reject 模式
4. **附件測試**：發送檔案，確認 `download_attachment` 正常運作

---

## MCP 工具一覽

| 工具                  | 說明                                                                       |
| --------------------- | -------------------------------------------------------------------------- |
| `reply`               | 發送訊息（`chat_id` + `text`，可選 `reply_to` 串接回覆、`files` 附件，最多 10 檔/25MB） |
| `react`               | 添加 emoji 回應（unicode 或自訂 `<:name:id>` 格式）                        |
| `edit_message`        | 編輯 Bot 先前發送的訊息                                                    |
| `fetch_messages`      | 取得最近 100 則訊息（由舊到新，含 message ID）                             |
| `download_attachment` | 下載訊息中的附件到 `inbox/`                                                |

**注意：** Discord plugin 有 `fetch_messages`（Telegram 沒有），可讀取頻道歷史訊息。

---

## 與 Telegram 的差異

| 面向     | Telegram          | Discord                          |
| -------- | ----------------- | -------------------------------- |
| 連線方式 | HTTP long-polling | WebSocket Gateway                |
| 訊息歷史 | 不可用            | `fetch_messages`（最多 100 則）  |
| 附件處理 | 自動下載          | 需明確呼叫 `download_attachment` |
| ID 格式  | 數字 chat_id      | Snowflake ID（數字）             |
| 群組存取 | 透過白名單        | 以頻道 ID 逐一 opt-in            |
| 檔案限制 | 每檔 50MB         | 每檔 25MB，最多 10 檔            |

---

## 權限設定

在 `.claude/settings.local.json` 中加入：

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

## 關鍵檔案

| 檔案                                    | 用途                          |
| --------------------------------------- | ----------------------------- |
| `.claude/channels/discord/.env`         | `DISCORD_BOT_TOKEN`（gitignored） |
| `.claude/channels/discord/access.json`  | 存取控制與白名單（gitignored）    |
| `.claude/channels/discord/inbox/`       | 下載的附件（gitignored）          |
| `docs/discord/plan.md`                  | 本計畫文件（英文版）              |
| `docs/discord/install.md`               | 安裝筆記（待建立）                |
