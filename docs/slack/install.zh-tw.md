# Claude Code x Slack — 安裝與整合筆記

## 概觀

Slack 整合使用 **message broker**，輪詢 Slack DM、轉發給 `claude` CLI、然後回覆結果。這與 Telegram/Discord 使用 Claude Code 內建的 `--channels` 插件系統不同。

**為何使用 broker？** 官方 `slack@claude-plugins-official` 僅為 MCP 工具整合（僅 outbound），且 Claude Code 的 `--channels server:` 模式有 bug，dev channels 永遠不會被核准（見 [Issue #4](../issues.md)）。Broker 繞過了這兩個限制。

**架構：**

```text
Slack App（桌面/手機/網頁）
    | (Slack Web API，broker 輪詢)
Slack Broker (Bun 行程)
    | (子行程：claude -p)
Claude CLI（無狀態，每訊息獨立）
```

---

## 安裝步驟

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

### 2. 啟用與 Bot 的 DM

1. 在 Slack App 設定中，前往 **App Home**
2. 在 **Show Tabs** 下，啟用 **Messages Tab**
3. 勾選：**「Allow users to send Slash commands and messages from the messages tab」**
4. 若提示則**重新安裝** app

### 3. 儲存 Token

將 Bot Token 寫入專案級 `.env`（gitignored）：

```bash
echo "SLACK_BOT_TOKEN=xoxb-..." >> .env
chmod 600 .env
```

> **警告：** 不要將 token 作為指令參數傳遞。見 [Issue #2](../issues.md)。

### 4. 驗證 Token

```bash
./scripts/verify_slack.sh
```

### 5. 設定存取控制

建立 `access.json` 控制誰可以 DM bot：

```bash
mkdir -p .claude/channels/slack

# 找到你的 Slack user ID：
# 到你的 Slack 個人檔案 > ... > Copy member ID
# 或執行 ./scripts/verify_slack.sh（會顯示 DM 列表中的 user ID）

cat > .claude/channels/slack/access.json << 'EOF'
{
  "dmPolicy": "allowlist",
  "allowFrom": ["YOUR_SLACK_USER_ID"],
  "groups": {},
  "pending": {}
}
EOF
```

若 `allowFrom` 為空（`[]`），**所有使用者** DM bot 都會得到回應。

### 6. 啟動

```bash
./start.sh slack
```

Broker 會：

1. 使用 Bot Token 連接 Slack
2. 每 5 秒輪詢 DM 頻道
3. 對每個允許使用者的新訊息：
   - 以 👀 反應（處理中）
   - 下載附件（圖片等）
   - 執行 `claude -p --output-format text "<訊息>"`
   - 以執行緒回覆
   - 以 ✅（完成）或 ❌（錯誤）反應

---

## 設定

| 變數 | 預設值 | 說明 |
| ---- | ------ | ---- |
| `SLACK_BOT_TOKEN` | （必要）| Bot User OAuth Token（`xoxb-*`）|
| `SLACK_STATE_DIR` | `.claude/channels/slack` | 狀態目錄 |
| `POLL_INTERVAL` | `5` | 輪詢間隔（秒）|
| `CLAUDE_BIN` | `claude` | claude CLI 路徑 |

---

## 與 Telegram/Discord 的差異

| 面向 | Telegram / Discord | Slack |
| ---- | ------------------ | ----- |
| 整合方式 | Claude Code `--channels` 插件 | 獨立 broker |
| Claude 呼叫 | 在 session 內（有狀態）| `claude -p` 每訊息（無狀態）|
| 連線 | 插件的 MCP server | Slack Web API 輪詢 |
| 延遲 | 即時 | ~5 秒輪詢間隔 |
| Launch | `./start.sh telegram` | `./start.sh slack` |

---

## 注意事項

1. **每訊息無狀態** — 每個 DM 產生獨立的 `claude -p` 呼叫，訊息間無對話上下文
2. **必須啟用 Messages Tab** — 否則使用者 DM bot 時會看到錯誤訊息
3. **Claude Code `--channels server:` 有 bug** — Dev channels 永遠不會被核准。Broker 完全繞過此問題。見 [Issue #4](../issues.md)
4. **輪詢間隔** — 預設 5 秒。設定 `POLL_INTERVAL=2` 可加快回應，但注意 Slack 速率限制
