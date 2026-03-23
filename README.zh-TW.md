# claude-code-channels

[English](README.md) | 繁體中文

將 Claude Code 連接到通訊平台，實現與本地 AI agent 的雙向遠端互動。

## 這是什麼

一個專案級的設定，用於搭配官方 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) Channels 插件系統。從手機發送任務、遠端審批危險操作、分享檔案——全部透過你偏好的通訊軟體完成。

## 支援的 Channel

| Channel  | 狀態   | 文件                             |
| -------- | ------ | -------------------------------- |
| Telegram | 可用   | [docs/telegram/](docs/telegram/) |
| Discord  | 可用   | [docs/discord/](docs/discord/)   |
| Slack    | Broker | [docs/slack/](docs/slack/)       |
| LINE     | Broker | [docs/line/](docs/line/)         |

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

深入了解官方插件內部架構，請見[插件架構](docs/plugins/architecture.zh-tw.md)。

## 使用範例

### 遠端任務執行

```text
# 從 Telegram/Discord 發送：
最近一次 commit 改了什麼檔案？

# Claude Code 執行 `git diff HEAD~1` 並回覆 diff 摘要
```

### 審批流程

```text
# Claude Code 遇到危險操作：
Bot: "即將執行 `rm -rf dist/` — approve 或 reject？"
你: approve
# Claude Code 繼續執行
```

### 多 Channel 啟動

```bash
# 同時啟動多個 channel
./start.sh telegram discord
```

## 專案結構

```text
.
├── start.sh                  # 多 channel 啟動腳本
├── .env.example              # 環境變數範本
├── .gitignore                # 排除機密與 channel 狀態
├── CHANGELOG.md
├── CONTRIBUTING.md
├── SECURITY.md
├── LICENSE
├── README.md
├── README.zh-TW.md
├── docs/
│   ├── prerequisites.md      # 共用前置條件（Bun、Claude Code）
│   ├── prerequisites.zh-tw.md # 共用前置條件（zh-TW）
│   ├── issues.md             # 已知問題（跨 channel）
│   ├── plugins/
│   │   ├── architecture.md       # 官方插件架構（EN）
│   │   └── architecture.zh-tw.md # 官方插件架構（zh-TW）
│   ├── telegram/
│   │   ├── plan.md           # 整合規劃文件
│   │   ├── plan.zh-tw.md     # 整合規劃文件（zh-TW）
│   │   ├── install.md        # 安裝與整合筆記
│   │   ├── install.zh-tw.md  # 安裝與整合筆記（zh-TW）
│   │   └── security.png
│   ├── discord/
│   │   ├── plan.md           # 整合規劃文件
│   │   ├── plan.zh-tw.md     # 整合規劃文件（zh-TW）
│   │   ├── install.md        # 安裝與整合筆記
│   │   └── install.zh-tw.md  # 安裝與整合筆記（zh-TW）
│   ├── slack/
│   │   ├── plan.md           # 整合規劃（僅 MCP，非 channel）
│   │   ├── install.md        # 安裝與整合筆記
│   │   └── install.zh-tw.md  # 安裝與整合筆記（zh-TW）
│   └── line/
│       ├── plan.md           # 整合規劃文件
│       ├── plan.zh-tw.md     # 整合規劃文件（zh-TW）
│       ├── install.md        # 安裝與整合筆記
│       └── install.zh-tw.md  # 安裝與整合筆記（zh-TW）
├── external_plugins/
│   ├── slack-channel/
│   │   └── broker.ts         # Slack 訊息 broker
│   └── line-channel/
│       └── broker.ts         # LINE webhook broker
├── scripts/
│   └── verify_slack.sh       # Slack token 驗證與煙霧測試
├── .github/
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.md
│   │   └── feature_request.md
│   ├── PULL_REQUEST_TEMPLATE.md
│   └── workflows/ci.yml
└── .claude/                  # (gitignored)
    ├── agents/
    │   └── pre-push-reviewer.md
    ├── settings.local.json   # 權限白名單
    └── channels/<channel>/   # 各 channel 狀態（token、存取控制）
```

## 截圖

> 即將新增 -- 請參閱各 channel 文件以了解設定指南與架構細節。

## 文件

### 各 Channel

- [Telegram — 安裝與整合筆記](docs/telegram/install.zh-tw.md)
- [Telegram — 規劃文件](docs/telegram/plan.zh-tw.md)
- [Discord — 安裝與整合筆記](docs/discord/install.zh-tw.md)
- [Discord — 規劃文件](docs/discord/plan.zh-tw.md)
- [Slack — 安裝與整合筆記](docs/slack/install.zh-tw.md)
- [Slack — 規劃文件](docs/slack/plan.md)
- [LINE — 安裝與整合筆記](docs/line/install.zh-tw.md)
- [LINE — 規劃文件](docs/line/plan.zh-tw.md)

### 一般

- [前置條件（Bun、Claude Code）](docs/prerequisites.zh-tw.md)
- [插件架構](docs/plugins/architecture.zh-tw.md)（[English](docs/plugins/architecture.md)）
- [已知問題（跨 channel）](docs/issues.md)
- [貢獻指南](CONTRIBUTING.md)
- [安全政策](SECURITY.md)
- [更新日誌](CHANGELOG.md)

## 授權

[MIT](LICENSE)
