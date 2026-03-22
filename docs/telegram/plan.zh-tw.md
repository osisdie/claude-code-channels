# Claude Code Channels × Telegram 串接計畫

## Context

使用 Anthropic 官方的 **Claude Code Channels**（2026/3/20 研究預覽版）將 Claude Code session 與 Telegram Bot 串接，實現雙向溝通：從 Telegram 發送指令給 Claude Code，Claude Code 回覆結果到 Telegram。

**架構概覽：**

```text
Telegram App (手機/桌面)
    ↕ (Bot API, 由 plugin 主動 polling)
Telegram Plugin (Bun subprocess, MCP Server)
    ↕ (stdio transport)
Claude Code Session (本地，有完整檔案系統存取)
```

不需要開 port、不需要 webhook、不需要外部伺服器。Plugin 主動向 Telegram API polling，所以 WSL2 環境下也不用設定防火牆。

---

## 前置條件

- [x] Telegram Bot Token（已有）
- [x] 安裝 Bun runtime
- [x] Claude Code v2.1.80+（目前 v2.1.81，已符合）
- [x] claude.ai 登入認證（非 API key，Channels 需要）

---

## 實作步驟

### Phase 1: 安裝 Bun

```bash
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc
bun --version
```

### Phase 2: 安裝 Telegram Plugin

啟動 Claude Code session：

```bash
cd /mnt/c/writable/git/nwpie/ClawProjects/claude-claw/
claude
```

在 session 內執行：

```text
/plugin marketplace add anthropics/claude-plugins-official
/plugin install telegram@claude-plugins-official
```

### Phase 3: 設定 Bot Token

在 Claude Code session 內：

```text
/telegram:configure <YOUR_BOT_TOKEN>
```

這會將 token 寫入 `~/.claude/channels/telegram/.env`。

或者在 shell 設定環境變數（優先於 .env）：

```bash
export TELEGRAM_BOT_TOKEN="你的token"
```

### Phase 4: 啟動 Channels

使用啟動腳本：

```bash
./start.sh telegram
```

或手動啟動：

```bash
claude --channels plugin:telegram@claude-plugins-official
```

### Phase 5: 配對 Telegram 帳號

1. 在 Telegram 發任意訊息給你的 Bot
2. Bot 回覆 **6 位配對碼**
3. 在 Claude Code terminal 輸入：

   ```text
   /telegram:access pair <CODE>
   ```

4. 鎖定存取（僅允許已配對帳號）：

   ```text
   /telegram:access policy allowlist
   ```

### Phase 6: 驗證測試

1. **基本測試**：在 Telegram 發 `What files are in my working directory?`，確認 Claude Code 收到並回覆
2. **檔案測試**：發送圖片給 Bot（下載到 `~/.claude/channels/telegram/inbox/`）
3. **工具確認**：Plugin 提供三個 MCP 工具：
   - `reply` — 回覆訊息（自動分段長文，支援最大 50MB 附件）
   - `react` — 添加 emoji 回應
   - `edit_message` — 編輯 Bot 先前的訊息

---

## 可選：專案設定

### 常駐運行

用 `tmux` 或 `screen` 保持 session 存活：

```bash
tmux new -s claude-tg
./start.sh telegram
# Ctrl+B D 離開 tmux
```

### 權限設定

在 `.claude/settings.local.json` 中為常用操作添加 `allow` 規則，避免無人值守時卡在權限確認。

---

## 重要注意事項

1. **離線訊息遺失**：Bot 只接收 session 運行期間的新訊息，離線期間的訊息會遺失
2. **權限阻塞**：如果 Claude 遇到權限確認而你不在 terminal 前，session 會暫停
3. **多 Bot 實例**：不同專案可用不同 Bot，設定 `TELEGRAM_STATE_DIR` 指向不同路徑
4. **WSL2 相容**：Plugin 用 outbound polling，不需要開 inbound port

---

## 關鍵檔案

| 檔案                                    | 用途                              |
| --------------------------------------- | --------------------------------- |
| `.claude/channels/telegram/.env`        | 儲存 `TELEGRAM_BOT_TOKEN`（gitignored） |
| `.claude/channels/telegram/access.json` | 存取控制策略和白名單（gitignored）    |
| `.claude/channels/telegram/inbox/`      | 接收的圖片/檔案（gitignored）         |
| `.claude/settings.local.json`           | Claude Code 權限設定（gitignored）    |
| `start.sh`                              | 多 channel 啟動腳本                   |
