/**
 * Per-user daily usage quota — persisted to disk.
 *
 * Tracks message count per user per day. Resets daily.
 * File: STATE_DIR/usage/YYYY-MM-DD.json
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

const DEFAULT_DAILY_QUOTA = parseInt(process.env.DAILY_QUOTA ?? '100', 10)

type UsageData = Record<string, number> // userId -> message count

function usageDir(stateDir: string): string {
  return join(stateDir, 'usage')
}

function todayFile(stateDir: string): string {
  const date = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
  return join(usageDir(stateDir), `${date}.json`)
}

function loadUsage(stateDir: string): UsageData {
  try {
    return JSON.parse(readFileSync(todayFile(stateDir), 'utf8'))
  } catch {
    return {}
  }
}

function saveUsage(stateDir: string, data: UsageData): void {
  const dir = usageDir(stateDir)
  mkdirSync(dir, { recursive: true })
  writeFileSync(todayFile(stateDir), JSON.stringify(data, null, 2) + '\n')
}

export interface QuotaResult {
  allowed: boolean
  used: number
  remaining: number
  limit: number
}

/** Check if user is within daily quota. */
export function checkQuota(stateDir: string, userId: string): QuotaResult {
  const limit = DEFAULT_DAILY_QUOTA
  const data = loadUsage(stateDir)
  const used = data[userId] ?? 0
  return {
    allowed: used < limit,
    used,
    remaining: Math.max(0, limit - used),
    limit,
  }
}

/** Record one usage for a user. Call after successful Claude invocation. */
export function recordUsage(stateDir: string, userId: string): void {
  const data = loadUsage(stateDir)
  data[userId] = (data[userId] ?? 0) + 1
  saveUsage(stateDir, data)
}

/** Quota exceeded response message. */
export function quotaExceededMessage(result: QuotaResult): string {
  return `Daily limit reached (${result.used}/${result.limit}). Try again tomorrow.`
}
