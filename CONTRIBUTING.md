# Contributing

Thanks for your interest in contributing to claude-code-channels!

## Getting Started

1. Fork the repo and clone locally.
2. Install prerequisites: [Bun](https://bun.sh/), Claude Code v2.1.80+.
3. Copy `.env.example` to `.env` and configure your bot tokens.

## Development Workflow

1. Create a feature branch from `main`.
2. Make your changes.
3. Ensure CI passes: `npx markdownlint-cli2 "**/*.md"`.
4. Submit a PR using the provided template.

## Adding a New Channel

1. Create `docs/<channel>/install.md` with setup instructions.
2. Add channel configuration to `start.sh`.
3. Update the Supported Channels table in `README.md`.

## Guidelines

- Keep PRs focused — one feature or fix per PR.
- Never commit secrets, tokens, or state files.
- Follow existing code style and markdown conventions.
- Update documentation alongside code changes.

## Reporting Issues

Use the [issue templates](https://github.com/osisdie/claude-code-channels/issues/new/choose) for bug reports and feature requests.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
