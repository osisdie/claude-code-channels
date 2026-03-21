# claude-code-channels

[繁體中文](README_zh-tw.md)

Connect Claude Code to messaging platforms for bidirectional, remote interaction with your local AI agent.

## What This Is

A project-level setup for running [Claude Code](https://docs.anthropic.com/en/docs/claude-code) with the official Channels plugin system. Send tasks from your phone, approve risky operations remotely, and share files -- all through your preferred messaging app.

## Supported Channels

| Channel  | Status  | Docs                             |
| -------- | ------- | -------------------------------- |
| Telegram | Ready   | [docs/telegram/](docs/telegram/) |
| Discord  | Ready   | [docs/discord/](docs/discord/)   |
| Slack    | Planned | -                                |
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

## Project Structure

```text
.
├── start.sh                  # Multi-channel launcher
├── .env.example              # Environment variable template
├── .gitignore                # Excludes secrets & channel state
├── CHANGELOG.md
├── LICENSE
├── docs/
│   ├── telegram/
│   │   ├── plan.md           # Integration planning doc
│   │   ├── plan_zh-tw.md     # Planning doc (Traditional Chinese)
│   │   ├── install.md        # Installation & integration notes
│   │   └── security.png
│   └── discord/
│       ├── plan.md           # Integration planning doc
│       ├── plan_zh-tw.md     # Planning doc (Traditional Chinese)
│       ├── install.md        # Installation & integration notes
│       └── issue.md          # Known issues
└── .claude/                  # (gitignored)
    ├── settings.local.json   # Permission whitelist
    └── channels/<channel>/   # Per-channel state (tokens, access)
```

## Usage Patterns

### Remote Messaging

Send a message to the bot on any connected platform. Claude Code receives it and can reply, run commands, edit files, etc.

### Approval Workflows

Claude Code sends approval requests to the messaging channel and waits for `approve`/`reject` before proceeding. Useful for:

- Deployment confirmations
- Destructive operations review
- CI/CD gates

### Permission Management

Configure `.claude/settings.local.json` to whitelist safe tools so the bot can respond without blocking on terminal prompts.

## Docs

Per-channel documentation lives under `docs/<channel>/`:

- [Telegram — Installation & Integration Notes](docs/telegram/install.md)
- [Telegram — Planning Document](docs/telegram/plan.md)
- [Discord — Installation & Integration Notes](docs/discord/install.md)
- [Discord — Planning Document](docs/discord/plan.md)
- [Discord — Known Issues](docs/discord/issue.md)

## License

[MIT](LICENSE)
