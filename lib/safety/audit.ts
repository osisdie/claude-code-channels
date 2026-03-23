/**
 * Audit logging — append-only compliance log.
 *
 * Separate from STM. Cannot be cleared by /session commands.
 * File: STATE_DIR/audit/YYYY-MM-DD.jsonl
 */

import { appendFileSync, mkdirSync } from 'fs'
import { join } from 'path'

export interface AuditEntry {
  ts: string
  userId: string
  groupId?: string
  channel: string        // 'slack' | 'line' | 'line-relay'
  prompt: string
  response?: string
  filtered?: string      // 'block:reason' | 'warn:reason' | undefined
  error?: string
  durationMs?: number
}

function auditDir(stateDir: string): string {
  return join(stateDir, 'audit')
}

function todayFile(stateDir: string): string {
  const date = new Date().toISOString().slice(0, 10)
  return join(auditDir(stateDir), `${date}.jsonl`)
}

/** Append an audit entry. Always succeeds (best-effort). */
export function auditLog(stateDir: string, entry: AuditEntry): void {
  try {
    const dir = auditDir(stateDir)
    mkdirSync(dir, { recursive: true })
    appendFileSync(todayFile(stateDir), JSON.stringify(entry) + '\n')
  } catch {
    // Best-effort — don't crash the broker if audit fails
  }
}
