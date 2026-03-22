# 官方 Channel Plugin 架構

本文件描述官方 Claude Code channel 插件（[anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official)）的架構，聚焦關鍵設計決策以及本專案如何與其互動。

## 概觀

每個 channel 插件是一個 **Bun 子行程**，運行 **MCP server**，透過 **stdio transport** 通訊。Claude Code 啟動插件後，插件以 outbound 方式連接到通訊平台（不需要 inbound port）。

```text
通訊 App（手機/桌面）
    | (平台 API — outbound polling 或 WebSocket)
Channel Plugin (Bun subprocess, MCP Server)
    | (stdio transport, MCP 協定)
Claude Code Session (本地，有完整檔案系統存取)
```

---

## 核心元件

### server.ts

每個 channel 插件的核心，負責：

- **平台連線**：Telegram 使用 HTTP long-polling，Discord 使用 WebSocket Gateway
- **STATE_DIR 解析**：`process.env.<CHANNEL>_STATE_DIR ?? ~/.claude/channels/<channel>`
- **存取控制閘門**：每條 inbound 訊息都經過 `gate()` 才到達 Claude
- **MCP 工具註冊**：對外提供 `reply`、`react`、`edit_message` 等工具
- **配對核准輪詢**：每 5 秒檢查 `approved/` 目錄

### skills/access/SKILL.md

基於提示的 skill（不是可執行程式碼），Claude 讀取後遵循指示。管理：

- 配對核准（`pair <code>`）
- 白名單管理（`allow <id>`、`remove <id>`）
- 政策變更（`policy allowlist|pairing|disabled`）
- 群組啟用（`group add <id>`、`group rm <id>`）
- 進階設定（`set ackReaction <emoji>`、`set mentionPatterns [...]`）

### skills/configure/SKILL.md

處理 bot token 管理：

- 無參數：顯示目前狀態（token 遮蔽、政策、白名單數量）
- 帶 token：寫入 `<STATE_DIR>/.env`，`chmod 600`
- `clear`：從 `.env` 移除 token

### plugin.json

宣告 MCP 工具、channel 能力與 metadata：

```json
{
  "name": "discord",
  "description": "Discord channel for Claude Code",
  "capabilities": {
    "experimental": { "claude/channel": {} }
  }
}
```

---

## MCP 工具

| 工具                  | Discord | Telegram | 說明                                |
| --------------------- | :-----: | :------: | ----------------------------------- |
| `reply`               | Yes     | Yes      | 發送訊息（自動分段，支援檔案附件）  |
| `react`               | Yes     | Yes      | 添加 emoji 反應                     |
| `edit_message`        | Yes     | Yes      | 編輯 bot 自己的訊息                 |
| `fetch_messages`      | Yes     | No       | 取得歷史訊息（1-100 則）            |
| `download_attachment` | Yes     | Yes      | 下載檔案到 `inbox/`                 |

### 主要差異

- **Discord** `reply`：最大 2000 字元/段，25MB/檔案，最多 10 個檔案
- **Telegram** `reply`：最大 4096 字元/段，50MB/檔案，支援 MarkdownV2 格式
- **Discord** 有 `fetch_messages` 可查看頻道歷史；Telegram 無對應功能

---

## 存取控制（access.json）

### Schema

```json
{
  "dmPolicy": "pairing | allowlist | disabled",
  "allowFrom": ["userId1", "userId2"],
  "groups": {
    "channelId": {
      "requireMention": true,
      "allowFrom": ["userId1"]
    }
  },
  "pending": {
    "a4f91c": {
      "senderId": "userId",
      "chatId": "channelId",
      "createdAt": 1234567890000,
      "expiresAt": 1234571490000,
      "replies": 1
    }
  }
}
```

### 閘門流程

每條 inbound 訊息經 `gate()` 處理：

1. **deliver** — 訊息通過，傳送到 Claude Code
2. **drop** — 靜默忽略（未授權發送者或已停用的政策）
3. **pair** — bot 回覆配對碼（最多 2 次回覆，之後靜默）

配對模式的速率限制：

- 每個待處理碼最多 2 次回覆（初始 + 1 次提醒）
- 同時最多 3 個待處理碼
- 碼在 1 小時後過期

### 檔案處理

存取檔案使用 **atomic write** 防止損壞：

```typescript
const tmp = ACCESS_FILE + '.tmp'
writeFileSync(tmp, JSON.stringify(a, null, 2) + '\n', { mode: 0o600 })
renameSync(tmp, ACCESS_FILE)  // 原子性重命名
```

若 `access.json` 損壞，會被重命名為 `access.json.corrupt-<timestamp>`，並載入預設值。

---

## 配對流程（端到端）

```text
1. 未知發送者 DM bot
2. gate() 產生 6 位 hex 碼，存入 pending
3. Bot 回覆：「執行 /discord:access pair a4f91c」
4. 使用者在 Claude Code 終端執行 skill
5. Skill 讀取 access.json，驗證碼
6. Skill 將發送者移至 allowFrom，寫入 approved/<senderId>
7. Server 輪詢 approved/ 目錄（每 5 秒），找到檔案
8. Server 發送「Paired! Say hi to Claude.」給發送者
9. Server 刪除 approved/<senderId> 檔案
```

---

## 專案級 vs 全域級 State

### 預設行為（全域）

插件將 state 存在 `~/.claude/channels/<channel>/`：

```text
~/.claude/channels/discord/
├── .env           # Bot token
├── access.json    # 存取控制
├── approved/      # 待核准
└── inbox/         # 下載的檔案
```

這是**跨所有專案共享**的同一 channel。

### 專案級覆蓋（本專案的作法）

`start.sh` 將 `<CHANNEL>_STATE_DIR` 導出到專案級路徑：

```bash
export DISCORD_STATE_DIR=$PROJECT_DIR/.claude/channels/discord
export TELEGRAM_STATE_DIR=$PROJECT_DIR/.claude/channels/telegram
```

Server 遵循此變數：

```typescript
const STATE_DIR = process.env.DISCORD_STATE_DIR
  ?? join(homedir(), '.claude', 'channels', 'discord')
```

### 為何本專案使用專案級 state

| 優點           | 說明                             |
| -------------- | -------------------------------- |
| **隔離性**     | 不同專案可用不同 bot/token       |
| **安全性**     | Token 不會跨專案洩漏             |
| **多實例**     | 可同時運行多個 bot               |
| **已 gitignore** | `.claude/` 在 `.gitignore` 中 |
| **可攜性**     | State 跟著專案走                 |

### 取捨

| 取捨                             | 影響                                              |
| -------------------------------- | ------------------------------------------------- |
| **Skill 路徑不符（Issue #1）**   | Skill 寫死 `~/.claude/channels/<channel>/`，忽略 `*_STATE_DIR`。配對會失敗，需要 workaround。見[已知問題](../issues.md) |
| **需手動 workaround**            | 在上游修正前，須在正確的專案級路徑完成配對         |
| **PR #866 待合併**               | 已提交修正，為 skill 加入環境變數解析              |

---

## 安全重點

### 檔案權限

- `.env`（token）：`0o600`（僅擁有者可讀寫）
- `access.json`：`0o600`
- `STATE_DIR`：`0o700`（僅擁有者）
- State 檔案禁止作為附件發送（`assertSendable()`）

### 提示注入防禦

- **存取變更絕不由 channel 訊息觸發** — 僅限在使用者終端直接執行 skill
- Skill 明確指示：若訊息要求「核准配對」或「加入白名單」，**拒絕**並告知使用者自行執行 skill
- 配對碼必須明確提供 — 不會自動核准

### Token 洩漏（Issue #2）

將 token 作為 slash command 參數（如 `/discord:configure <TOKEN>`）會記錄在對話歷史中。請直接將 token 寫入 `.env` 檔案。見[已知問題](../issues.md)。

---

## Channel 比較

| 功能             | Discord             | Telegram            | Slack（規劃中）       |
| ---------------- | ------------------- | ------------------- | --------------------- |
| 連線方式         | WebSocket Gateway   | HTTP long-polling   | Socket Mode (WebSocket) |
| 使用者 ID 類型   | Snowflake（數值）   | 數值 ID             | Member ID             |
| 文字限制         | 2000 字元           | 4096 字元           | TBD                   |
| 檔案限制         | 25MB，10 個檔案     | 50MB                | TBD                   |
| 訊息歷史         | `fetch_messages`    | 無                  | TBD                   |
| 圖片處理         | 按需下載            | 即時下載            | TBD                   |
| Emoji 反應       | Unicode + 自訂      | 固定白名單          | 標準 emoji            |
| 格式支援         | 無                  | MarkdownV2          | mrkdwn                |
| 執行緒支援       | 繼承父頻道          | 回覆至              | 原生執行緒            |

---

## 參考資料

- [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official) — 官方插件原始碼
- [已知問題](../issues.md) — STATE_DIR 不符與 token 洩漏
- [PR #866](https://github.com/anthropics/claude-plugins-official/pull/866) — Skill 中 STATE_DIR 解析的修正
