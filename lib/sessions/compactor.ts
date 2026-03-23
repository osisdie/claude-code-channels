/**
 * Auto-compacting — LLM-based summarization of older messages.
 *
 * When STM exceeds threshold, older messages are summarized via `claude -p`
 * and the raw JSONL is trimmed to keep only the most recent messages.
 */

import { existsSync, readFileSync, readdirSync, mkdirSync } from 'fs'
import { join } from 'path'
import { spawn } from 'child_process'
import type { StmMessage, SessionConfig } from './types'
import {
  userMessagesPath, userSummaryPath, sessionPaths,
  countJsonlLines, readJsonl, atomicWrite, ensureDir,
  parseFrontmatter, serializeFrontmatter,
} from './utils'

const CLAUDE_BIN = process.env.CLAUDE_BIN ?? 'claude'
const PROJECT_DIR = process.env.PROJECT_DIR
  ?? join(import.meta.dir ?? '.', '..', '..')

/** Run claude -p to generate a summary. */
function runClaudeSummarize(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = [
      '-p',
      '--output-format', 'text',
      '--system-prompt', 'You are a concise summarizer. Summarize the conversation below, preserving key facts, user preferences, and important context. Output only the summary, no preamble.',
      '--',
      prompt,
    ]

    const child = spawn(CLAUDE_BIN, args, {
      cwd: PROJECT_DIR,
      env: { ...process.env, PATH: process.env.PATH },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`claude summarize exited with code ${code}`))
      else resolve(stdout.trim())
    })
    child.on('error', reject)

    setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error('claude summarize timed out after 2 minutes'))
    }, 2 * 60 * 1000)
  })
}

/**
 * Check if compaction is needed and perform it if so.
 * Returns true if compaction was performed.
 */
export async function maybeCompact(
  stateDir: string,
  userId: string,
  config: SessionConfig,
): Promise<boolean> {
  if (!config.compacting.enabled) return false

  const msgPath = userMessagesPath(stateDir, userId)
  const count = countJsonlLines(msgPath)
  if (count <= config.compacting.threshold) return false

  const messages = readJsonl<StmMessage>(msgPath)
  const keepCount = config.stm.contextWindow
  const toCompact = messages.slice(0, -keepCount)
  const toKeep = messages.slice(-keepCount)

  if (toCompact.length === 0) return false

  // Format messages for LLM summarization
  const formatted = toCompact.map(m => {
    const time = m.ts.slice(0, 16).replace('T', ' ')
    const role = m.role === 'user' ? 'User' : 'Assistant'
    return `[${time}] ${role}: ${m.text}`
  }).join('\n')

  try {
    // Get existing summary to provide continuity
    const summaryPath = userSummaryPath(stateDir, userId)
    let existingSummary = ''
    if (existsSync(summaryPath)) {
      const { body } = parseFrontmatter(readFileSync(summaryPath, 'utf8'))
      existingSummary = body.trim()
    }

    const prompt = existingSummary
      ? `Previous summary:\n${existingSummary}\n\nNew messages to incorporate:\n${formatted}`
      : `Conversation messages:\n${formatted}`

    const summary = await runClaudeSummarize(prompt)

    // Write updated summary
    const meta = {
      user_id: userId,
      last_compacted: new Date().toISOString(),
      messages_compacted: toCompact.length,
    }
    atomicWrite(summaryPath, serializeFrontmatter(meta, '\n' + summary + '\n'))

    // Rewrite messages.jsonl with only kept messages
    const kept = toKeep.map(m => JSON.stringify(m)).join('\n') + '\n'
    atomicWrite(msgPath, kept)

    return true
  } catch {
    // Compaction failure is non-fatal — messages remain intact
    return false
  }
}

/** Generate a daily summary for a specific user and date. */
export async function generateDailySummary(
  stateDir: string,
  userId: string,
  date: string, // YYYY-MM-DD
): Promise<void> {
  const messages = readJsonl<StmMessage>(userMessagesPath(stateDir, userId))
  const dayMessages = messages.filter(m => m.ts.startsWith(date))
  if (dayMessages.length === 0) return

  const formatted = dayMessages.map(m => {
    const time = m.ts.slice(11, 16)
    const role = m.role === 'user' ? 'User' : 'Assistant'
    return `[${time}] ${role}: ${m.text}`
  }).join('\n')

  const summary = await runClaudeSummarize(
    `Summarize this day's conversation (${date}):\n${formatted}`
  )

  const outDir = join(sessionPaths(stateDir).summaries, userId, 'daily')
  ensureDir(outDir)

  const meta = {
    user_id: userId,
    date,
    message_count: dayMessages.length,
    first_message: dayMessages[0].ts,
    last_message: dayMessages[dayMessages.length - 1].ts,
  }
  atomicWrite(
    join(outDir, `${date}.md`),
    serializeFrontmatter(meta, '\n' + summary + '\n'),
  )
}

/** Generate a weekly summary by combining daily summaries. */
export async function generateWeeklySummary(
  stateDir: string,
  userId: string,
  isoWeek: string, // YYYY-Www format
): Promise<void> {
  const dailyDir = join(sessionPaths(stateDir).summaries, userId, 'daily')
  if (!existsSync(dailyDir)) return

  // Parse week to get date range
  const [year, weekNum] = isoWeek.split('-W').map(Number)
  const dailyFiles = readdirSync(dailyDir)
    .filter(f => f.endsWith('.md'))
    .sort()

  // Filter to files within the week (approximate — check first few chars of date)
  const weekStart = getWeekStart(year, weekNum)
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekEnd.getDate() + 7)

  const relevantFiles = dailyFiles.filter(f => {
    const fileDate = f.replace('.md', '')
    return fileDate >= weekStart.toISOString().slice(0, 10)
      && fileDate < weekEnd.toISOString().slice(0, 10)
  })

  if (relevantFiles.length === 0) return

  const dailySummaries = relevantFiles.map(f => {
    const content = readFileSync(join(dailyDir, f), 'utf8')
    const { body } = parseFrontmatter(content)
    return `### ${f.replace('.md', '')}\n${body.trim()}`
  }).join('\n\n')

  const summary = await runClaudeSummarize(
    `Combine these daily summaries into a weekly overview for week ${isoWeek}:\n\n${dailySummaries}`
  )

  const outDir = join(sessionPaths(stateDir).summaries, userId, 'weekly')
  ensureDir(outDir)

  const meta = {
    user_id: userId,
    week: isoWeek,
    daily_summaries: relevantFiles.length,
  }
  atomicWrite(
    join(outDir, `${isoWeek}.md`),
    serializeFrontmatter(meta, '\n' + summary + '\n'),
  )
}

function getWeekStart(year: number, week: number): Date {
  const jan4 = new Date(year, 0, 4)
  const dayOfWeek = jan4.getDay() || 7
  const start = new Date(jan4)
  start.setDate(jan4.getDate() - dayOfWeek + 1 + (week - 1) * 7)
  return start
}
