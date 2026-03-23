# Broker Session Memory

File-based session persistence for Slack/LINE broker channels, giving stateless `claude -p` invocations conversational memory.

> **Scope:** Broker channels only (Slack/LINE). Channel plugins (Telegram/Discord) already have in-process context.

## Why

Brokers spawn a fresh `claude -p` subprocess per incoming message. Without session memory, every response is completely isolated — the bot has no idea what was said 30 seconds ago. This system logs messages to disk and injects recent context into each `claude -p` call via `--system-prompt`.

## Architecture

```
User message
    │
    ▼
┌─────────────────────────────┐
│  broker.ts (processMessage) │
│                             │
│  1. /session command?  ─────┼──▶ Direct response (no LLM)
│  2. appendMessage (JSONL)   │
│  3. buildContextPrompt      │──▶ summary.md + last N messages
│  4. runClaude(prompt, ctx)  │
│  5. appendMessage (response)│
│  6. maybeCompact            │──▶ LLM summarize if > threshold
└─────────────────────────────┘
         │
    Scheduler (background)
    ├── STM expiry
    ├── Log rotation
    ├── Daily/weekly LLM summaries
    └── Prune empty dirs
```

## Storage Layout

All session data lives under the channel's state directory:

```
.claude/channels/<channel>/sessions/
├── config.json                     # Tunable thresholds and intervals
│
├── stm/<user_id>/                  # Short-term memory (per user)
│   ├── messages.jsonl              # Append-only conversation log
│   └── summary.md                  # LLM-generated rolling summary
│
├── ltm/                            # Long-term memory (cross-session)
│   ├── users/<user_id>.md          # User profile (preferences, notes)
│   ├── topics/<slug>.md            # Persistent topic notes
│   └── index.json                  # Searchable tag/text index
│
├── summaries/<user_id>/            # Tiered summaries
│   ├── daily/YYYY-MM-DD.md
│   └── weekly/YYYY-Www.md
│
└── archive/<user_id>/              # Rotated old data
    └── messages-YYYY-MM-DD.jsonl.gz
```

## Configuration

Create `sessions/config.json` to override defaults (all fields optional):

```json
{
  "stm": {
    "maxMessages": 50,
    "maxAgeMinutes": 120,
    "contextWindow": 10
  },
  "compacting": {
    "enabled": true,
    "threshold": 50,
    "dailySummaryHour": 3,
    "weeklySummaryDay": 0
  },
  "scheduler": {
    "logRotateDays": 7,
    "stmExpireDays": 3,
    "cleanupIntervalMinutes": 60
  }
}
```

| Setting | Default | Description |
|---------|---------|-------------|
| `stm.contextWindow` | 10 | Recent messages injected into each `claude -p` call |
| `stm.maxMessages` | 50 | Max raw messages before auto-compact triggers |
| `compacting.threshold` | 50 | Same as maxMessages — compact when exceeded |
| `compacting.dailySummaryHour` | 3 | Hour (0-23) for daily summary generation |
| `scheduler.stmExpireDays` | 3 | Days before idle STM data is cleaned up |
| `scheduler.logRotateDays` | 7 | Days before broker logs are archived |

## User Commands

Users can send these commands directly in chat (handled at broker layer, no LLM cost):

| Command | Description |
|---------|-------------|
| `/session status` | Show message count, active users, storage usage |
| `/session clear` | Clear your short-term memory (keeps LTM) |
| `/session clear all` | Clear all your data (STM + LTM + summaries) |
| `/session profile` | Show your stored LTM profile |
| `/session forget <topic>` | Delete a specific topic note |
| `/session export` | Export all your data to a directory |
| `/session help` | Show available commands |

## How It Works

### Short-term Memory (STM)

Every message exchange is logged as JSONL (one JSON object per line):

```jsonl
{"ts":"2026-03-23T03:28:32Z","role":"user","text":"hi","msgId":"123","channel":"slack"}
{"ts":"2026-03-23T03:28:33Z","role":"assistant","text":"Hello!","msgId":"resp-1","channel":"slack"}
```

Before each `claude -p` call, the broker calls `buildContextPrompt()` which combines:
1. The rolling summary (if any compaction has happened)
2. The last N raw messages (configurable via `stm.contextWindow`)

This context is appended to `--system-prompt`, making the stateless subprocess aware of recent conversation.

### Auto-Compacting (LLM)

When messages exceed `compacting.threshold`:

1. Read all messages from JSONL
2. Keep last `contextWindow` messages as raw
3. Call `claude -p` to summarize older messages
4. Write summary to `summary.md` (with YAML frontmatter)
5. Rewrite `messages.jsonl` with only the kept messages (atomic write)

This keeps the raw message file small while preserving context in the summary.

### Long-term Memory (LTM)

Structured markdown files with YAML frontmatter:

```markdown
---
user_id: U12345
display_name: Kevin
channel: line
tags: [toeic, student, zh-tw]
---

## Preferences
- Language: Traditional Chinese
- Timezone: UTC+8

## Ongoing Topics
- TOEIC 860 preparation
```

LTM entries are indexed in `ltm/index.json` for tag and text search.

### Background Scheduler

The scheduler runs inside the broker process via `setInterval`:

| Task | Interval | Action |
|------|----------|--------|
| STM expiry | Every 60 min | Delete idle user STM older than `stmExpireDays` |
| Log rotation | Daily | Archive broker logs older than `logRotateDays` |
| Daily summary | Daily | LLM summary per active user |
| Weekly summary | Weekly | Combine daily summaries via LLM |
| Prune | Daily | Remove empty directories |

## Library API

The session library is at `lib/sessions/` with the following modules:

```
lib/sessions/
├── index.ts       # Public re-exports
├── types.ts       # SessionConfig, StmMessage, LtmEntry, etc.
├── stm.ts         # appendMessage, getRecentMessages, buildContextPrompt
├── ltm.ts         # getUserProfile, setUserProfile, searchByTags
├── compactor.ts   # maybeCompact, generateDailySummary, generateWeeklySummary
├── scheduler.ts   # startScheduler, runMaintenance
├── cleanup.ts     # getStorageReport, deleteUserData, exportUserData
├── commands.ts    # parseSessionCommand, executeSessionCommand
└── utils.ts       # atomicWrite, appendJsonl, parseFrontmatter
```

### Key Functions

```typescript
import {
  appendMessage,       // Log a message to STM
  buildContextPrompt,  // Build context string for --system-prompt
  loadConfig,          // Load config with defaults
} from '../../lib/sessions'

import { parseSessionCommand, executeSessionCommand } from '../../lib/sessions/commands'
import { startScheduler } from '../../lib/sessions/scheduler'
```

## Design Decisions

**JSONL over JSON arrays** — `appendFileSync` for a single line is atomic on Linux (under ~4KB pipe buffer). A JSON array would require read-modify-write, risking corruption on crash.

**LLM summarization over extractive** — `claude -p` produces much higher quality summaries. Cost is acceptable since compaction only triggers when messages exceed threshold (default 50).

**Broker-layer commands** — `/session` commands are parsed and executed directly in `broker.ts` without spawning `claude -p`, eliminating unnecessary API costs for simple operations.

**Atomic writes** — All file rewrites use the write-to-tmp-then-rename pattern (same as `access.json` in the official plugins), preventing corruption from crashes or concurrent access.

## Files Modified

- `external_plugins/slack-channel/broker.ts` — Session logging, context injection, commands, scheduler
- `external_plugins/line-channel/broker.ts` — Same integration
- `lib/sessions/*` — 9 new library modules
