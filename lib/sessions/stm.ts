/**
 * Short-term Memory (STM) — per-user conversation message logging and context building.
 *
 * Messages are stored as append-only JSONL files. Context is built by combining
 * a rolling summary (from compaction) with the most recent raw messages.
 */

import { existsSync, readFileSync, rmSync, readdirSync } from 'fs'
import type { StmMessage, SessionConfig } from './types'
import {
  userMessagesPath, userSummaryPath, userStmDir,
  sessionPaths, appendJsonl, tailJsonl, countJsonlLines,
  ensureDir,
} from './utils'

/** Append a message to the user's STM log. */
export function appendMessage(stateDir: string, userId: string, msg: StmMessage): void {
  const path = userMessagesPath(stateDir, userId)
  appendJsonl(path, msg as unknown as Record<string, unknown>)
}

/** Read the last N messages for a user. */
export function getRecentMessages(stateDir: string, userId: string, count: number): StmMessage[] {
  return tailJsonl<StmMessage>(userMessagesPath(stateDir, userId), count)
}

/** Get all messages for a user. */
export function getAllMessages(stateDir: string, userId: string): StmMessage[] {
  const path = userMessagesPath(stateDir, userId)
  if (!existsSync(path)) return []
  const content = readFileSync(path, 'utf8').trim()
  if (!content) return []
  return content.split('\n').map(line => JSON.parse(line) as StmMessage)
}

/** Get message count for a user's current STM. */
export function getMessageCount(stateDir: string, userId: string): number {
  return countJsonlLines(userMessagesPath(stateDir, userId))
}

/** Get the rolling summary for a user (compacted context). */
export function getSummary(stateDir: string, userId: string): string | null {
  const path = userSummaryPath(stateDir, userId)
  if (!existsSync(path)) return null
  const content = readFileSync(path, 'utf8')
  // Strip frontmatter, return just the body
  const match = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/)
  return match ? match[1].trim() : content.trim()
}

/**
 * Build a context string for injection into `claude -p --system-prompt`.
 * Combines rolling summary + last N raw messages.
 */
export function buildContextPrompt(stateDir: string, userId: string, config: SessionConfig): string {
  const parts: string[] = []

  // Include rolling summary if available
  const summary = getSummary(stateDir, userId)
  if (summary) {
    parts.push(`[Conversation summary]\n${summary}`)
  }

  // Include recent messages
  const recent = getRecentMessages(stateDir, userId, config.stm.contextWindow)
  if (recent.length > 0) {
    const formatted = recent.map(m => {
      const time = m.ts.slice(0, 16).replace('T', ' ')
      const role = m.role === 'user' ? 'User' : 'Assistant'
      return `[${time}] ${role}: ${m.text}`
    }).join('\n')
    parts.push(`[Recent messages]\n${formatted}`)
  }

  if (parts.length === 0) return ''
  return parts.join('\n\n')
}

/** Remove a specific message by msgId from a user's STM. */
export function deleteMessageById(stateDir: string, userId: string, msgId: string): boolean {
  const path = userMessagesPath(stateDir, userId)
  if (!existsSync(path)) return false
  const lines = readFileSync(path, 'utf8').trim().split('\n')
  const filtered = lines.filter(line => {
    try {
      const msg = JSON.parse(line) as StmMessage
      return msg.msgId !== msgId
    } catch {
      return true
    }
  })
  if (filtered.length === lines.length) return false // not found
  // Atomic rewrite
  const tmp = path + '.tmp'
  const { writeFileSync: ws, renameSync: rs } = require('fs')
  ws(tmp, filtered.join('\n') + '\n')
  rs(tmp, path)
  return true
}

/** Clear all STM for a specific user. */
export function clearUser(stateDir: string, userId: string): void {
  const dir = userStmDir(stateDir, userId)
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Clear all STM for the entire channel. */
export function clearAll(stateDir: string): void {
  const stmDir = sessionPaths(stateDir).stm
  if (existsSync(stmDir)) {
    rmSync(stmDir, { recursive: true, force: true })
  }
}

/** List all user IDs that have STM data. */
export function listUsers(stateDir: string): string[] {
  const stmDir = sessionPaths(stateDir).stm
  if (!existsSync(stmDir)) return []
  return readdirSync(stmDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
}
