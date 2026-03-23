/**
 * Scheduler — automated maintenance tasks running inside broker processes.
 *
 * Manages log rotation, STM expiry, daily/weekly summaries, and pruning.
 * Runs as setInterval callbacks within the broker's event loop.
 */

import { existsSync, readdirSync, renameSync, statSync } from 'fs'
import { join } from 'path'
import type { SessionConfig, MaintenanceReport } from './types'
import { sessionPaths, fileModifiedTime } from './utils'
import { listUsers, clearUser } from './stm'
import { maybeCompact, generateDailySummary, generateWeeklySummary } from './compactor'
import { prune } from './cleanup'

/** Run all maintenance tasks once. */
export async function runMaintenance(
  stateDir: string,
  config: SessionConfig,
): Promise<MaintenanceReport> {
  const report: MaintenanceReport = {
    logsRotated: 0,
    stmExpired: 0,
    messagesArchived: 0,
    summariesGenerated: 0,
    errors: [],
  }

  // 1. Expire old STM entries
  try {
    const users = listUsers(stateDir)
    const now = Date.now()
    const expireMs = config.scheduler.stmExpireDays * 24 * 60 * 60 * 1000

    for (const userId of users) {
      const msgPath = join(sessionPaths(stateDir).stm, userId, 'messages.jsonl')
      const mtime = fileModifiedTime(msgPath)
      if (mtime && now - mtime.getTime() > expireMs) {
        clearUser(stateDir, userId)
        report.stmExpired++
      }
    }
  } catch (e) {
    report.errors.push(`STM expiry: ${e}`)
  }

  // 2. Rotate old logs
  try {
    const logDir = join(stateDir, 'logs')
    if (existsSync(logDir)) {
      const archiveDir = join(sessionPaths(stateDir).archive, 'logs')
      const now = Date.now()
      const rotateMs = config.scheduler.logRotateDays * 24 * 60 * 60 * 1000

      for (const file of readdirSync(logDir)) {
        if (!file.startsWith('broker-') || !file.endsWith('.log')) continue
        const filePath = join(logDir, file)
        const mtime = statSync(filePath).mtime
        if (now - mtime.getTime() > rotateMs) {
          const { mkdirSync } = await import('fs')
          mkdirSync(archiveDir, { recursive: true })
          renameSync(filePath, join(archiveDir, file))
          report.logsRotated++
        }
      }
    }
  } catch (e) {
    report.errors.push(`Log rotation: ${e}`)
  }

  // 3. Auto-compact users exceeding threshold
  try {
    const users = listUsers(stateDir)
    for (const userId of users) {
      const compacted = await maybeCompact(stateDir, userId, config)
      if (compacted) report.messagesArchived++
    }
  } catch (e) {
    report.errors.push(`Compaction: ${e}`)
  }

  // 4. Generate daily summaries for yesterday
  try {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const dateStr = yesterday.toISOString().slice(0, 10)

    const users = listUsers(stateDir)
    for (const userId of users) {
      try {
        await generateDailySummary(stateDir, userId, dateStr)
        report.summariesGenerated++
      } catch {}
    }
  } catch (e) {
    report.errors.push(`Daily summaries: ${e}`)
  }

  // 5. Generate weekly summaries (on configured day)
  try {
    const today = new Date()
    if (today.getDay() === config.compacting.weeklySummaryDay) {
      const isoWeek = getISOWeek(today)
      const users = listUsers(stateDir)
      for (const userId of users) {
        try {
          await generateWeeklySummary(stateDir, userId, isoWeek)
          report.summariesGenerated++
        } catch {}
      }
    }
  } catch (e) {
    report.errors.push(`Weekly summaries: ${e}`)
  }

  // 6. Prune empty directories
  try {
    prune(stateDir)
  } catch (e) {
    report.errors.push(`Prune: ${e}`)
  }

  return report
}

/**
 * Start the scheduler with periodic intervals.
 * Returns a cleanup function to stop all intervals.
 */
export function startScheduler(stateDir: string, config: SessionConfig): () => void {
  const intervals: ReturnType<typeof setInterval>[] = []

  // Cleanup task — runs every cleanupIntervalMinutes
  const cleanupMs = config.scheduler.cleanupIntervalMinutes * 60 * 1000
  intervals.push(setInterval(async () => {
    try {
      const report = await runMaintenance(stateDir, config)
      if (report.errors.length > 0) {
        console.error(`[scheduler] maintenance errors:`, report.errors)
      }
      const actions = [
        report.logsRotated && `${report.logsRotated} logs rotated`,
        report.stmExpired && `${report.stmExpired} STM expired`,
        report.messagesArchived && `${report.messagesArchived} compacted`,
        report.summariesGenerated && `${report.summariesGenerated} summaries`,
      ].filter(Boolean)
      if (actions.length > 0) {
        console.log(`[scheduler] maintenance: ${actions.join(', ')}`)
      }
    } catch (e) {
      console.error(`[scheduler] maintenance failed:`, e)
    }
  }, cleanupMs))

  return () => {
    for (const id of intervals) clearInterval(id)
  }
}

function getISOWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`
}
