# claude-code-channels

[![CI](https://github.com/osisdie/claude-code-channels/actions/workflows/ci.yml/badge.svg)](https://github.com/osisdie/claude-code-channels/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/osisdie/claude-code-channels)](LICENSE)
[![GitHub issues](https://img.shields.io/github/issues/osisdie/claude-code-channels)](https://github.com/osisdie/claude-code-channels/issues)
[![GitHub stars](https://img.shields.io/github/stars/osisdie/claude-code-channels)](https://github.com/osisdie/claude-code-channels/stargazers)

English | [繁體中文](README.zh-TW.md)

Connect Claude Code to messaging platforms for bidirectional, remote interaction with your local AI agent.

## What This Is

A project-level setup for running [Claude Code](https://docs.anthropic.com/en/docs/claude-code) with the official Channels plugin system. Send tasks from your phone, approve risky operations remotely, and share files -- all through your preferred messaging app.

## Supported Channels

| Channel  | Status  | Docs                             |
| -------- | ------- | -------------------------------- |
| Telegram | Ready   | [docs/telegram/](docs/telegram/) |
| Discord  | Ready   | [docs/discord/](docs/discord/)   |
| Slack    | MCP Only | [docs/slack/](docs/slack/)      |
| LINE     | Planned | -                                |

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) runtime
- Claude Code v2.1.80+
- A bot token for your target channel (e.g., Telegram's [@BotFather](https://t.me/BotFather))

### Setup

1. **Clone and configure:**

   ```bash
   git clone https://github.com/osisdie/claude-code-channels.git
   cd claude-code-channels
   cp .env.example .env
   # Edit .env — add your bot token(s)
   ```

2. **Install a channel plugin** (inside a Claude Code session):

   ```text
   /plugin marketplace add anthropics/claude-plugins-official
   /plugin install telegram@claude-plugins-official
   /telegram:configure <YOUR_BOT_TOKEN>
   ```

3. **Pair your account** (varies per channel — see channel docs).

4. **Launch:**

   ```bash
   ./start.sh telegram
   ```

## Architecture

```text
Messaging App (Mobile/Desktop)
    | (Platform API, outbound polling by plugin)
Channel Plugin (Bun subprocess, MCP Server)
    | (stdio transport)
Claude Code Session (local, full filesystem access)
```

No inbound ports, webhooks, or external servers needed. WSL2 compatible.

For a deep dive into the official plugin internals, see [Plugin Architecture](docs/plugins/architecture.md).

## Usage Examples

### Remote Task Execution

```text
# From Telegram/Discord, send:
What files changed in the last commit?

# Claude Code executes `git diff HEAD~1` and replies with the diff summary
```

### Approval Workflow

```text
# Claude Code encounters a destructive operation:
Bot: "About to run `rm -rf dist/` — approve or reject?"
You: approve
# Claude Code proceeds
```

### Multi-Channel Launch

```bash
# Start with multiple channels simultaneously
./start.sh telegram discord
```

## Project Structure

```text
.
├── start.sh                  # Multi-channel launcher
├── .env.example              # Environment variable template
├── .gitignore                # Excludes secrets & channel state
├── CHANGELOG.md
├── CONTRIBUTING.md
├── SECURITY.md
├── LICENSE
├── README.md
├── README.zh-TW.md
├── docs/
│   ├── prerequisites.md      # Shared setup (Bun, Claude Code)
│   ├── prerequisites.zh-tw.md # Shared setup (zh-TW)
│   ├── issues.md             # Known issues (cross-channel)
│   ├── plugins/
│   │   ├── architecture.md       # Official plugin architecture (EN)
│   │   └── architecture.zh-tw.md # Official plugin architecture (zh-TW)
│   ├── telegram/
│   │   ├── plan.md           # Integration planning doc
│   │   ├── plan.zh-tw.md     # Planning doc (zh-TW)
│   │   ├── install.md        # Installation & integration notes
│   │   ├── install.zh-tw.md  # Installation notes (zh-TW)
│   │   └── security.png
│   ├── discord/
│   │   ├── plan.md           # Integration planning doc
│   │   ├── plan.zh-tw.md     # Planning doc (zh-TW)
│   │   ├── install.md        # Installation & integration notes
│   │   └── install.zh-tw.md  # Installation notes (zh-TW)
│   └── slack/
│       ├── plan.md           # Integration plan (MCP only, not channel)
│       ├── install.md        # Installation & integration notes
│       └── install.zh-tw.md  # Installation notes (zh-TW)
├── scripts/
│   └── verify_slack.sh       # Slack token verification & smoke test
├── .github/
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.md
│   │   └── feature_request.md
│   ├── PULL_REQUEST_TEMPLATE.md
│   └── workflows/ci.yml
└── .claude/                  # (gitignored)
    ├── agents/
    │   └── pre-push-reviewer.md
    ├── settings.local.json   # Permission whitelist
    └── channels/<channel>/   # Per-channel state (tokens, access)
```

## Screenshots

### Telegram

| Ask | Reply |
|-----|-------|
| ![Telegram Ask](docs/screenshots/telegram/ask.png) | ![Telegram Reply](docs/screenshots/telegram/reply.png) |

### Discord

| Ask | Reply |
|-----|-------|
| ![Discord Ask](docs/screenshots/discord/ask.png) | ![Discord Reply](docs/screenshots/discord/reply.png) |

### Slack

| Ask | Reply |
|-----|-------|
| ![Slack Ask](docs/screenshots/slack/ask.png) | ![Slack Reply](docs/screenshots/slack/reply.png) |

### Claude Code Terminal

![Claude Code Channel Messages](docs/screenshots/claude_code/channel_messages.png)

## Docs

### Per-Channel

- [Telegram -- Installation & Integration Notes](docs/telegram/install.md)
- [Telegram -- Planning Document](docs/telegram/plan.md)
- [Discord -- Installation & Integration Notes](docs/discord/install.md)
- [Discord -- Planning Document](docs/discord/plan.md)
- [Slack -- Installation & Integration Notes](docs/slack/install.md)
- [Slack -- Planning Document](docs/slack/plan.md)

### General

- [Prerequisites (Bun, Claude Code)](docs/prerequisites.md)
- [Plugin Architecture](docs/plugins/architecture.md) ([繁體中文](docs/plugins/architecture.zh-tw.md))
- [Known Issues (Cross-Channel)](docs/issues.md)
- [Contributing](CONTRIBUTING.md)
- [Security Policy](SECURITY.md)
- [Changelog](CHANGELOG.md)

## License

[MIT](LICENSE)
