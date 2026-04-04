/**
 * Session bot commands — parsed and executed at the broker layer.
 *
 * Commands are prefixed with `/memory` (legacy `/session` also accepted) and handled without LLM invocation.
 */

import { existsSync } from 'fs'
import type { StorageReport } from './types'
import { getMessageCount, clearUser, listUsers } from './stm'
import {
  getUserProfile, deleteUserProfile, deleteTopic,
  listEntries, rebuildIndex,
} from './ltm'
import { getStorageReport, deleteUserData, exportUserData } from './cleanup'
import { sessionPaths } from './utils'

export interface SessionCommand {
  action: string
  args: string[]
}

/** Parse a /memory (or legacy /session) command from message text. Returns null if not a match. */
export function parseSessionCommand(text: string): SessionCommand | null {
  const trimmed = text.trim()
  let prefix: string
  if (trimmed.startsWith('/memory')) prefix = '/memory'
  else if (trimmed.startsWith('/session')) prefix = '/session'
  else return null

  const parts = trimmed.slice(prefix.length).trim().split(/\s+/)
  const action = parts[0] ?? 'help'
  const args = parts.slice(1)

  return { action, args }
}

/** Execute a session command. Returns the response text. */
export function executeSessionCommand(
  stateDir: string,
  userId: string,
  cmd: SessionCommand,
): string {
  switch (cmd.action) {
    case 'status':
      return handleStatus(stateDir, userId)
    case 'clear':
      return handleClear(stateDir, userId, cmd.args)
    case 'profile':
      return handleProfile(stateDir, userId)
    case 'forget':
      return handleForget(stateDir, cmd.args)
    case 'export':
      return handleExport(stateDir, userId)
    case 'help':
    default:
      return handleHelp()
  }
}

function handleStatus(stateDir: string, userId: string): string {
  const count = getMessageCount(stateDir, userId)
  const allUsers = listUsers(stateDir)
  const entries = listEntries(stateDir)

  let report: StorageReport | null = null
  try {
    report = getStorageReport(stateDir)
  } catch {}

  const lines = [
    `Session Status`,
    `─────────────`,
    `Your STM: ${count} messages`,
    `Active users: ${allUsers.length}`,
    `LTM entries: ${entries.length}`,
  ]

  if (report) {
    const totalKB = Math.round(report.totalSizeBytes / 1024)
    lines.push(`Storage: ${totalKB} KB`)
  }

  return lines.join('\n')
}

function handleClear(stateDir: string, userId: string, args: string[]): string {
  if (args[0] === 'all') {
    deleteUserData(stateDir, userId)
    return 'All your session data has been cleared (STM + LTM + summaries).'
  }
  clearUser(stateDir, userId)
  return 'Your short-term memory has been cleared. Long-term memory is preserved.'
}

function handleProfile(stateDir: string, userId: string): string {
  const profile = getUserProfile(stateDir, userId)
  if (!profile) return 'No profile found. A profile will be created as we chat.'
  return profile
}

function handleForget(stateDir: string, args: string[]): string {
  const slug = args[0]
  if (!slug) return 'Usage: /memory forget <topic-slug>'
  deleteTopic(stateDir, slug)
  return `Topic "${slug}" has been deleted.`
}

function handleExport(stateDir: string, userId: string): string {
  const outPath = `${sessionPaths(stateDir).root}/export-${userId}-${Date.now()}.tar.gz`
  try {
    exportUserData(stateDir, userId, outPath)
    return `Data exported to: ${outPath}`
  } catch (e) {
    return `Export failed: ${e instanceof Error ? e.message : String(e)}`
  }
}

function handleHelp(): string {
  return [
    'Session Commands',
    '────────────────',
    '/memory status  — Show session stats',
    '/memory clear   — Clear your short-term memory',
    '/memory clear all — Clear all your data (STM + LTM)',
    '/memory profile — Show your stored profile',
    '/memory forget <topic> — Delete a topic note',
    '/memory export  — Export your data',
    '/memory help    — Show this help',
  ].join('\n')
}
