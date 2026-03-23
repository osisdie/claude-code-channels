# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

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

[0.3.0]: https://github.com/osisdie/claude-code-channels/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/osisdie/claude-code-channels/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/osisdie/claude-code-channels/releases/tag/v0.1.0
