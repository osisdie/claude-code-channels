/**
 * Cleanup — manual and automated data management.
 *
 * Provides storage reporting, user data deletion (GDPR), and export.
 */

import {
  existsSync, readdirSync, statSync, rmSync,
  copyFileSync, readFileSync, writeFileSync,
} from 'fs'
import { join, basename } from 'path'
import type { StorageReport } from './types'
import { sessionPaths, ensureDir } from './utils'
import { clearUser } from './stm'
import { deleteUserProfile } from './ltm'

/** Calculate total size of a directory recursively. */
function dirSize(dirPath: string): { files: number; bytes: number } {
  if (!existsSync(dirPath)) return { files: 0, bytes: 0 }

  let files = 0
  let bytes = 0

  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else {
        files++
        bytes += statSync(full).size
      }
    }
  }

  walk(dirPath)
  return { files, bytes }
}

/** Get storage usage report. */
export function getStorageReport(stateDir: string): StorageReport {
  const paths = sessionPaths(stateDir)
  const stm = dirSize(paths.stm)
  const ltm = dirSize(join(paths.ltm))
  const summaries = dirSize(paths.summaries)
  const archive = dirSize(paths.archive)

  return {
    channel: stateDir.split('/').pop() ?? 'unknown',
    stmFiles: stm.files,
    stmSizeBytes: stm.bytes,
    ltmFiles: ltm.files,
    ltmSizeBytes: ltm.bytes,
    summaryFiles: summaries.files,
    summarySizeBytes: summaries.bytes,
    archiveFiles: archive.files,
    archiveSizeBytes: archive.bytes,
    totalSizeBytes: stm.bytes + ltm.bytes + summaries.bytes + archive.bytes,
  }
}

/** Delete ALL session data for a user (STM + LTM + summaries + archives). */
export function deleteUserData(stateDir: string, userId: string): void {
  // Clear STM
  clearUser(stateDir, userId)

  // Clear LTM profile
  deleteUserProfile(stateDir, userId)

  // Clear summaries
  const summaryDir = join(sessionPaths(stateDir).summaries, userId)
  if (existsSync(summaryDir)) {
    rmSync(summaryDir, { recursive: true, force: true })
  }

  // Clear archive
  const archiveDir = join(sessionPaths(stateDir).archive, userId)
  if (existsSync(archiveDir)) {
    rmSync(archiveDir, { recursive: true, force: true })
  }
}

/** Recursively copy a directory. */
function copyDirSync(src: string, dest: string): void {
  ensureDir(dest)
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const srcPath = join(src, entry.name)
    const destPath = join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath)
    } else {
      copyFileSync(srcPath, destPath)
    }
  }
}

/** Export all data for a user to a directory. */
export function exportUserData(stateDir: string, userId: string, outputPath: string): void {
  const paths = sessionPaths(stateDir)
  ensureDir(outputPath)

  // Copy STM
  const stmDir = join(paths.stm, userId)
  if (existsSync(stmDir)) {
    copyDirSync(stmDir, join(outputPath, 'stm'))
  }

  // Copy summaries
  const summaryDir = join(paths.summaries, userId)
  if (existsSync(summaryDir)) {
    copyDirSync(summaryDir, join(outputPath, 'summaries'))
  }

  // Copy archive
  const archiveDir = join(paths.archive, userId)
  if (existsSync(archiveDir)) {
    copyDirSync(archiveDir, join(outputPath, 'archive'))
  }

  // Copy LTM profile
  const ltmProfile = join(paths.ltmUsers, `${userId}.md`)
  if (existsSync(ltmProfile)) {
    copyFileSync(ltmProfile, join(outputPath, 'profile.md'))
  }
}

/** Prune empty directories in sessions/ tree. Returns count of directories removed. */
export function prune(stateDir: string): number {
  const root = sessionPaths(stateDir).root
  if (!existsSync(root)) return 0

  let removed = 0

  function pruneDir(dir: string): boolean {
    if (!existsSync(dir)) return true
    const entries = readdirSync(dir, { withFileTypes: true })

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const full = join(dir, entry.name)
        const isEmpty = pruneDir(full)
        if (isEmpty) {
          rmSync(full, { recursive: true })
          removed++
        }
      }
    }

    return readdirSync(dir).length === 0
  }

  pruneDir(root)
  return removed
}
