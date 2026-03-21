# claude-code-channels

將 Claude Code 連接到通訊平台，實現與本地 AI agent 的雙向遠端互動。

## 這是什麼

一個專案級的設定，用於搭配官方 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) Channels 插件系統。從手機發送任務、遠端審批危險操作、分享檔案——全部透過你偏好的通訊軟體完成。

## 支援的 Channel

| Channel  | 狀態   | 文件                             |
| -------- | ------ | -------------------------------- |
| Telegram | 可用   | [docs/telegram/](docs/telegram/) |
| Discord  | 規劃中 | [docs/discord/](docs/discord/)   |
| Slack    | 規劃中 | -                                |
| LINE     | 規劃中 | -                                |

## 快速開始

### 前置條件

- [Bun](https://bun.sh/) runtime
- Claude Code v2.1.80+
- 目標 channel 的 bot token（例如 Telegram 的 [@BotFather](https://t.me/BotFather)）

### 設定步驟

1. **Clone 並設定：**

   ```bash
   git clone https://github.com/osisdie/claude-code-channels.git
   cd claude-code-channels
   cp .env.example .env
   # 編輯 .env，加入你的 bot token
   ```

2. **安裝 channel 插件**（在 Claude Code session 內）：

   ```text
   /plugin marketplace add anthropics/claude-plugins-official
   /plugin install telegram@claude-plugins-official
   /telegram:configure <YOUR_BOT_TOKEN>
   ```

3. **配對你的帳號**（依 channel 不同，請參考各 channel 文件）。

4. **啟動：**

   ```bash
   ./start.sh telegram
   ```

## 架構

```text
通訊 App（手機/桌面）
    | (平台 API, plugin 主動 outbound polling)
Channel Plugin (Bun subprocess, MCP Server)
    | (stdio transport)
Claude Code Session (本地，有完整檔案系統存取)
```

不需要開 inbound port、不需要 webhook、不需要外部伺服器。WSL2 相容。

## 專案結構

```text
.
├── start.sh                  # 多 channel 啟動腳本
├── .env.example              # 環境變數範本
├── .gitignore                # 排除機密與 channel 狀態
├── CHANGELOG.md
├── LICENSE
├── docs/
│   ├── telegram/
│   │   ├── plan.md           # 整合規劃文件
│   │   ├── plan_zh-tw.md     # 整合規劃文件（繁體中文）
│   │   ├── install.md        # 安裝與整合筆記
│   │   └── security.png
│   └── discord/
│       ├── plan.md           # 整合規劃文件
│       └── plan_zh-tw.md     # 整合規劃文件（繁體中文）
└── .claude/                  # (gitignored)
    ├── settings.local.json   # 權限白名單
    └── channels/<channel>/   # 各 channel 狀態（token、存取控制）
```

## 使用模式

### 遠端訊息

在任何已連接的平台上向 bot 發送訊息。Claude Code 會接收並回覆、執行指令、編輯檔案等。

### 審批流程

Claude Code 向通訊 channel 發送審批請求，等待 `approve`/`reject` 後再繼續操作。適用於：

- 部署確認
- 危險操作審查
- CI/CD 關卡

### 權限管理

設定 `.claude/settings.local.json` 將安全的工具加入白名單，讓 bot 可以直接回應而不會卡在 terminal 的權限提示。

## 文件

各 channel 的文件位於 `docs/<channel>/`：

- [Telegram — 安裝與整合筆記](docs/telegram/install.md)
- [Telegram — 規劃文件](docs/telegram/plan_zh-tw.md)
- [Discord — 規劃文件](docs/discord/plan_zh-tw.md)

## 授權

[MIT](LICENSE)
