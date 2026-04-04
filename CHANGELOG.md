# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.1.0] - 2026-04-04

### Added

- `/yt2pdf` command: YouTube URL → transcript → bilingual PDF summary → B2 download link
  - Supports `--lang en` or `--lang zh-tw` for single-language output (default: both)
  - Pipeline: `get_transcript.py` → Claude summarizes → `build_html.py` → `build_pdf.py` → `upload_b2.py`
  - Orchestrator script (`yt2pdf.py`) chains HTML→PDF→B2 with JSON stdout
  - Thumbnail embedded as base64 in PDF for self-contained output
  - Metadata in PDF and reply: title, publisher, published date, tags
  - Output stored in `output/youtube/{date}/{video_id}/` (gitignored)
- Content filter and audit logging for Telegram and Discord channel plugins
  - Blocks credential leaks (API keys, tokens, private keys) and jailbreak patterns
  - Warn-level logging for system prompt probing and dangerous commands
  - Audit trail in `STATE_DIR/audit/YYYY-MM-DD.jsonl`
- Task planner agent (`.claude/agents/task-planner.md`) for persistent task management
- Python dependencies (`scripts/yt/requirements.txt`)

### Changed

- `.env.example`: add B2 and HuggingFace credential placeholders
- `.gitignore`: add `__pycache__/`, `*.pyc`, reorganize output section

## [1.0.0] - 2026-03-24

### Highlights

- First stable release
- 6 messaging channels: Telegram, Discord, Slack, LINE, WhatsApp, Teams (planned)
- Session memory (STM + LTM) with auto-compacting
- Safety & abuse prevention (content filter, quota, audit)
- Docker support for broker channels
- SNS official logos and enhanced badges in README
- Full documentation in English and Traditional Chinese

## [0.5.0] - 2026-03-24

### Added

- WhatsApp channel integration via relay broker (Cloudflare Worker + local bridge)
  - Meta Cloud API with HMAC-SHA256 webhook verification
  - Two-step media download proxy (Graph API)
  - 4096-char message chunking
  - Group chat support with trigger prefix
  - Read receipts on reply
- Session memory and safety layers integrated into WhatsApp broker
- `start.sh` help command (`--help`, `-h`, `help`)
- Explicit relay env vars: `WA_RELAY_URL`, `TEAMS_RELAY_URL`, `LINE_RELAY_URL` (no more shared `RELAY_URL`)
- Documentation for WhatsApp (plan, install) in EN and zh-TW
- Microsoft Teams broker (planned, not yet deployed)
  - Azure Bot Framework with JWT validation (JWKS rotation)
  - Bot Connector REST API, Teams app manifest
- GitHub topic: `whatsapp-bot`

## [0.4.0] - 2026-03-23

### Added

- LINE Relay: cloud webhook (Cloudflare Worker) + local bridge
  - Stable webhook URL (no more ngrok restarts)
  - KV queue with 1h TTL for message buffering
  - Content proxy for image downloads
  - Push API replies via cloud relay
- Session memory system (`lib/sessions/`)
  - Short-term memory (STM): per-user JSONL conversation log
  - Long-term memory (LTM): user profiles and topic notes
  - Auto-compacting via LLM summarization
  - `/session` commands: status, clear, profile, forget, export
  - Background scheduler for cleanup and summaries
- Safety & abuse prevention (`lib/safety/`)
  - Content filter: block credentials, jailbreak patterns, oversized input
  - Daily per-user usage quota (default: 100/day)
  - Audit logging: append-only JSONL (separate from STM)
  - System prompt safety rules in all brokers
- Group chat improvements
  - Trigger prefix: `/ask`, `/ai`, `/bot`, `/claude` (groups only)
  - Per-user image buffer with 5-min TTL for image + follow-up flow
  - Skip AI tags: `[skip ai]`, `[no ai]`, `[ai skip]`

## [0.3.0] - 2026-03-23

### Added

- LINE channel integration via message broker (webhook + `claude -p`)
  - Webhook server with signature verification
  - Image download and analysis support
  - Group chat support with access control
  - Reply API (free) with Push API fallback
  - Rate limiting and busy guard
- LINE documentation (plan, install) in EN and zh-TW
- Log file persistence for both Slack and LINE brokers
- Tool access (`--allowedTools`) and system prompt for broker channels
- GitHub topic: `line-bot`

## [0.2.0] - 2026-03-22

### Added

- Slack channel integration via message broker (polling + `claude -p`)
  - Polls Slack DMs, pipes to Claude CLI, replies in thread
  - Image attachment download and analysis
  - Access control via `access.json` allowlist
  - Cursor tracking for message deduplication
- Slack token verification script (`scripts/verify_slack.sh`)
- Plugin architecture documentation (EN + zh-TW)
- Pre-push reviewer agent (`.claude/agents/pre-push-reviewer.md`)
- GitHub community files (CONTRIBUTING, SECURITY, issue/PR templates)
- README badges (CI, license, issues, stars)
- Usage examples and screenshots sections
- Prerequisites doc (shared Bun/Claude Code setup)
- All `install.zh-tw.md` translations

### Changed

- Rename `*_zh-tw.md` to `*.zh-tw.md` (BCP 47 convention)
- Move `docs/discord/issue.md` to `docs/issues.md` (cross-channel)
- Slack status: Planned → Broker (not a channel plugin)
- `.env.example`: separate channel plugins vs broker channels
- `start.sh`: support broker channels (Slack, LINE)

### Fixed

- CI markdownlint config (`.markdownlint-cli2.jsonc`)
- shellcheck SC1090 warning in `verify_slack.sh`

### Documented

- Issue #1: STATE_DIR path mismatch (PR #866 submitted)
- Issue #2: Token leakage via command arguments
- Issue #3: Slack plugin is MCP-only, not a channel plugin
- Issue #4: Claude Code `--channels server:` dev mode never approved

## [0.1.0] - 2026-03-21

### Added

- Telegram channel integration via Claude Code Channels plugin
- Discord channel integration via Claude Code Channels plugin
- Bidirectional messaging (Telegram/Discord <-> Claude Code session)
- Approval workflow pattern (approve/reject via messaging)
- Multi-channel launcher script (`start.sh`)
- Per-channel documentation structure (`docs/<channel>/`)
- MIT license

[1.1.0]: https://github.com/osisdie/claude-code-channels/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/osisdie/claude-code-channels/compare/v0.5.0...v1.0.0
[0.5.0]: https://github.com/osisdie/claude-code-channels/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/osisdie/claude-code-channels/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/osisdie/claude-code-channels/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/osisdie/claude-code-channels/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/osisdie/claude-code-channels/releases/tag/v0.1.0
