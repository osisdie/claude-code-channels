# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| latest  | Yes       |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do NOT open a public issue.**
2. Email the maintainer or use [GitHub's private vulnerability reporting](https://github.com/osisdie/claude-code-channels/security/advisories/new).
3. Include steps to reproduce, impact assessment, and any suggested fix.

We will acknowledge receipt within 48 hours and aim to provide a fix or mitigation within 7 days.

## Security Considerations

- **Tokens**: Bot tokens are stored in `.env` (gitignored) and per-channel state directories. Never commit tokens.
- **Access control**: Use `allowlist` mode in `access.json` to restrict who can interact with your bot. The default `pairing` mode should only be used during initial setup.
- **Local-only**: Claude Code runs locally with no inbound ports. All communication is outbound polling.
- **Skill arguments**: Avoid passing secrets as slash command arguments — they persist in conversation history. Use `.env` files or interactive prompts instead.
