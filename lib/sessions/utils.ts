/**
 * Session utility functions: atomic writes, JSONL, frontmatter, path helpers.
 */

import {
  readFileSync, writeFileSync, appendFileSync,
  mkdirSync, existsSync, renameSync, statSync,
} from 'fs'
import { join, dirname } from 'path'
import type { SessionConfig } from './types'
import { DEFAULT_CONFIG } from './types'

// ── Path helpers ─────────────────────────────────────────────

export interface SessionPaths {
  root: string
  config: string
  stm: string
  ltm: string
  ltmUsers: string
  ltmTopics: string
  ltmIndex: string
  summaries: string
  archive: string
}

export function sessionPaths(stateDir: string): SessionPaths {
  const root = join(stateDir, 'sessions')
  return {
    root,
    config: join(root, 'config.json'),
    stm: join(root, 'stm'),
    ltm: join(root, 'ltm'),
    ltmUsers: join(root, 'ltm', 'users'),
    ltmTopics: join(root, 'ltm', 'topics'),
    ltmIndex: join(root, 'ltm', 'index.json'),
    summaries: join(root, 'summaries'),
    archive: join(root, 'archive'),
  }
}

export function userStmDir(stateDir: string, userId: string): string {
  return join(sessionPaths(stateDir).stm, userId)
}

export function userMessagesPath(stateDir: string, userId: string): string {
  return join(userStmDir(stateDir, userId), 'messages.jsonl')
}

export function userSummaryPath(stateDir: string, userId: string): string {
  return join(userStmDir(stateDir, userId), 'summary.md')
}

// ── Directory helpers ────────────────────────────────────────

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true })
}

export function ensureParentDir(filePath: string): void {
  ensureDir(dirname(filePath))
}

// ── Atomic file writes ──────────────────────────────────────

export function atomicWrite(filePath: string, content: string): void {
  ensureParentDir(filePath)
  const tmp = filePath + '.tmp'
  writeFileSync(tmp, content)
  renameSync(tmp, filePath)
}

// ── JSONL operations ────────────────────────────────────────

export function appendJsonl(filePath: string, obj: Record<string, unknown>): void {
  ensureParentDir(filePath)
  appendFileSync(filePath, JSON.stringify(obj) + '\n')
}

export function readJsonl<T = Record<string, unknown>>(filePath: string): T[] {
  if (!existsSync(filePath)) return []
  const content = readFileSync(filePath, 'utf8').trim()
  if (!content) return []
  return content.split('\n').map(line => JSON.parse(line) as T)
}

export function tailJsonl<T = Record<string, unknown>>(filePath: string, n: number): T[] {
  if (!existsSync(filePath)) return []
  const content = readFileSync(filePath, 'utf8').trim()
  if (!content) return []
  const lines = content.split('\n')
  return lines.slice(-n).map(line => JSON.parse(line) as T)
}

export function countJsonlLines(filePath: string): number {
  if (!existsSync(filePath)) return 0
  const content = readFileSync(filePath, 'utf8').trim()
  if (!content) return 0
  return content.split('\n').length
}

// ── YAML frontmatter ────────────────────────────────────────

export function parseFrontmatter(content: string): { meta: Record<string, unknown>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!match) return { meta: {}, body: content }

  const meta: Record<string, unknown> = {}
  for (const line of match[1].split('\n')) {
    const m = line.match(/^(\w[\w_]*)\s*:\s*(.*)$/)
    if (!m) continue
    const [, key, rawVal] = m
    let val: unknown = rawVal
    // Parse arrays like [a, b, c]
    if (rawVal.startsWith('[') && rawVal.endsWith(']')) {
      val = rawVal.slice(1, -1).split(',').map(s => s.trim())
    } else if (rawVal === 'true') {
      val = true
    } else if (rawVal === 'false') {
      val = false
    } else if (/^\d+$/.test(rawVal)) {
      val = parseInt(rawVal, 10)
    }
    meta[key] = val
  }

  return { meta, body: match[2] }
}

export function serializeFrontmatter(meta: Record<string, unknown>, body: string): string {
  const lines: string[] = []
  for (const [key, val] of Object.entries(meta)) {
    if (Array.isArray(val)) {
      lines.push(`${key}: [${val.join(', ')}]`)
    } else {
      lines.push(`${key}: ${val}`)
    }
  }
  return `---\n${lines.join('\n')}\n---\n${body}`
}

// ── Config ──────────────────────────────────────────────────

export function loadConfig(stateDir: string): SessionConfig {
  const paths = sessionPaths(stateDir)
  try {
    const raw = JSON.parse(readFileSync(paths.config, 'utf8'))
    return {
      stm: { ...DEFAULT_CONFIG.stm, ...raw.stm },
      compacting: { ...DEFAULT_CONFIG.compacting, ...raw.compacting },
      scheduler: { ...DEFAULT_CONFIG.scheduler, ...raw.scheduler },
    }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export function saveConfig(stateDir: string, config: SessionConfig): void {
  const paths = sessionPaths(stateDir)
  atomicWrite(paths.config, JSON.stringify(config, null, 2) + '\n')
}

// ── File size helpers ───────────────────────────────────────

export function fileSize(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

export function fileModifiedTime(path: string): Date | null {
  try {
    return statSync(path).mtime
  } catch {
    return null
  }
}
