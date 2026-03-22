# Channel 前置條件

所有 channel 插件（Telegram、Discord 等）的共用前置條件。

---

## 1. 安裝 Bun

Channel 插件以 Bun 子行程運行。安裝 [Bun](https://bun.sh/)：

```bash
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc
bun --version
```

---

## 2. Claude Code

安裝 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) v2.1.80 或更新版本：

```bash
npm install -g @anthropic-ai/claude-code
claude --version
```

需要 **claude.ai 登入**（非 API key）— 這是 Channels 功能的必要條件。

---

## 3. 安裝官方插件倉庫

在 Claude Code session 內：

```text
/plugin marketplace add anthropics/claude-plugins-official
```

這會讓所有 channel 插件（`telegram`、`discord` 等）可供安裝。

---

## 4. 專案設定

```bash
git clone https://github.com/osisdie/claude-code-channels.git
cd claude-code-channels
cp .env.example .env
```

---

## 環境

已驗證：

- OS: WSL2 (Linux 6.6.87.2-microsoft-standard-WSL2)
- Claude Code: v2.1.81
- Bun: v1.2.x
- 平台：Telegram、Discord

---

## 下一步

選擇要設定的 channel：

- [Telegram — 規劃](telegram/plan.zh-tw.md) | [安裝筆記](telegram/install.zh-tw.md)
- [Discord — 規劃](discord/plan.zh-tw.md) | [安裝筆記](discord/install.zh-tw.md)
- [Slack — 規劃](slack/plan.md)（僅 MCP，非 channel 插件）| [安裝筆記](slack/install.zh-tw.md)
