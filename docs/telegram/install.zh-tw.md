# Claude Code x Telegram Channel — 安裝與整合筆記

## 概觀

本文件記錄透過官方 Channels 插件（研究預覽版，2026/03）將 Claude Code 連接到 Telegram 的實際安裝與整合經驗。

**環境：**

- OS: WSL2 (Linux 6.6.87.2-microsoft-standard-WSL2)
- Claude Code: v2.1.81
- Model: Claude Opus 4.6 (1M context)
- Runtime: Bun

---

## 安裝步驟（已執行）

### 1. 安裝 Bun

```bash
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc
bun --version
```

### 2. 安裝 Telegram 插件

在 Claude Code session 內：

```text
/plugin marketplace add anthropics/claude-plugins-official
/plugin install telegram@claude-plugins-official
```

### 3. 設定 Bot Token

將 token 直接寫入 `.env` 檔案：

```bash
mkdir -p .claude/channels/telegram
echo "TELEGRAM_BOT_TOKEN=<YOUR_TOKEN>" > .claude/channels/telegram/.env
chmod 600 .claude/channels/telegram/.env
```

> **警告：** 不要將 token 作為指令參數傳遞（如 `/telegram:configure <token>`）。這會將 token 洩漏到對話歷史中。請直接寫入 `.env` 檔案。見 [docs/issues.md Issue #2](../issues.md)。

### 4. 啟動 Channel

```bash
claude --channels plugin:telegram@claude-plugins-official
```

或使用專案的 `start.sh`：

```bash
./start.sh
```

### 5. 配對 Telegram 帳號

1. 在 Telegram 上向 Bot 發送任何訊息
2. Bot 回覆一組 **6 位配對碼**
3. 在 Claude Code 終端：

   ```text
   /telegram:access pair <CODE>
   ```

4. 鎖定存取為白名單模式：

   ```text
   /telegram:access policy allowlist
   ```

---

## 已驗證功能

### 基本訊息（雙向）

| 方向                    | 方式                                                         | 狀態   |
| ----------------------- | ------------------------------------------------------------ | ------ |
| Telegram -> Claude Code | 使用者向 Bot 發送訊息，在 session 中顯示為 `<channel>`       | 已驗證 |
| Claude Code -> Telegram | 使用 `mcp__plugin_telegram_telegram__reply` 工具加 `chat_id` | 已驗證 |

### 可用 MCP 工具

| 工具                  | 說明                                                          | 已測試 |
| --------------------- | ------------------------------------------------------------- | ------ |
| `reply`               | 發送訊息到 Telegram（支援文字、MarkdownV2、最大 50MB 附件）   | 是     |
| `react`               | 對訊息添加 emoji 反應                                         | -      |
| `edit_message`        | 編輯先前發送的 Bot 訊息                                       | -      |
| `download_attachment` | 下載收到的附件                                                | -      |

### 回覆串接

使用 `reply_to` 參數搭配 `message_id` 來串接回覆到特定訊息：

```text
reply(chat_id="...", text="...", reply_to="13")
```

### 透過 Telegram 的審批流程

已測試的關鍵模式：使用 Telegram 作為人工審核 channel。

**流程：**

1. Claude Code 透過 `reply` 發送審批請求到 Telegram
2. Session 暫停，等待下一個對話輪次
3. 使用者在 Telegram 上回覆 `approve` 或 `reject`
4. 回覆作為 `<channel>` 訊息進入 session
5. Claude Code 根據回應繼續執行並回報結果

**範例審批請求：**

```text
Action: Execute command echo "Hello from approval test"
Environment: Local session
Risk: Low

Please reply:
approve - to proceed
reject - to cancel
```

**特性：**

- 「軟等待」— session 等待下一個對話輪次（Telegram 或本地終端輸入）
- 沒有內建逾時機制；session 持續閒置直到收到輸入
- 適合 CI/CD 審批關卡、部署確認等

---

## 權限設定

### 白名單工具（`.claude/settings.local.json`）

自動核准、無需使用者確認的指令：

```json
{
  "permissions": {
    "allow": [
      "Bash(npm list:*)",
      "Bash(pip list:*)",
      "Bash(bun --version)",
      "Bash(claude --version)",
      "Bash(npm config:*)",
      "WebSearch",
      "mcp__plugin_telegram_telegram__reply"
    ]
  }
}
```

關鍵：`mcp__plugin_telegram_telegram__reply` 已加入白名單，讓 Bot 可以隨時回應而不會卡在權限提示。

未加入白名單的指令會在終端觸發審批提示（或可透過上述 Telegram 審批流程處理）。

---

## 架構

```text
Telegram App（手機/桌面）
    | (Bot API, plugin 主動 outbound polling)
    v
Telegram Plugin (Bun subprocess, MCP Server)
    | (stdio transport)
    v
Claude Code Session（本地，有完整檔案系統存取）
```

- **不需要 inbound port** — 插件以 outbound 方式輪詢 Telegram API
- **WSL2 相容** — 不需要防火牆設定
- **不需要外部伺服器** — 一切在本地執行

---

## 關鍵檔案

| 檔案                                       | 用途                             |
| ------------------------------------------ | -------------------------------- |
| `start.sh`                                 | 啟動腳本（含 `--channels` 旗標）|
| `.env.example`                             | 環境變數範本                     |
| `.gitignore`                               | 排除機密、channel 狀態、本地設定 |
| `.claude/settings.local.json`              | 權限白名單（gitignored）         |
| `.claude/channels/telegram/.env`           | Bot token（gitignored）          |
| `.claude/channels/telegram/access.json`    | 存取控制與白名單（gitignored）   |
| `docs/telegram/plan.md`                   | 規劃文件                         |
| `docs/telegram/install.md`                | 本文件（英文版）                 |

---

## 注意事項與經驗教訓

1. **離線訊息會遺失** — Bot 僅在 session 運行時接收訊息
2. **權限阻塞** — 未加白名單的工具呼叫會阻塞 session 直到在終端核准；請將常用的安全工具加入白名單
3. **State 目錄** — 設定 `TELEGRAM_STATE_DIR` 為專案級路徑以實現各專案隔離
4. **Bot API 限制** — 沒有訊息歷史或搜尋功能；僅能看到即時訊息
5. **MarkdownV2 格式** — 需依 Telegram 規則跳脫特殊字元；使用 `format: "text"` 以純文字避免問題
