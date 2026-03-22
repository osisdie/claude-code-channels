# Channel Prerequisites

Shared prerequisites for all channel plugins (Telegram, Discord, etc.).

---

## 1. Install Bun

Channel plugins run as Bun subprocesses. Install [Bun](https://bun.sh/):

```bash
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc
bun --version
```

---

## 2. Claude Code

Install [Claude Code](https://docs.anthropic.com/en/docs/claude-code) v2.1.80 or later:

```bash
npm install -g @anthropic-ai/claude-code
claude --version
```

Requires a **claude.ai login** (not API key) — this is required by the Channels feature.

---

## 3. Install Official Plugin Repository

Inside a Claude Code session:

```text
/plugin marketplace add anthropics/claude-plugins-official
```

This makes all channel plugins (`telegram`, `discord`, etc.) available for installation.

---

## 4. Project Setup

```bash
git clone https://github.com/osisdie/claude-code-channels.git
cd claude-code-channels
cp .env.example .env
```

---

## Environment

Verified on:

- OS: WSL2 (Linux 6.6.87.2-microsoft-standard-WSL2)
- Claude Code: v2.1.81
- Bun: v1.2.x
- Platforms: Telegram, Discord

---

## Next Steps

Choose a channel to set up:

- [Telegram -- Plan](telegram/plan.md) | [Install Notes](telegram/install.md)
- [Discord -- Plan](discord/plan.md) | [Install Notes](discord/install.md)
- [Slack -- Plan](slack/plan.md) (MCP only, not a channel plugin)
