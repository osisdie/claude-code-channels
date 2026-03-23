/**
 * Long-term Memory (LTM) — persistent user profiles and topic notes.
 *
 * Stores structured markdown files with YAML frontmatter for user profiles
 * and topic notes. Maintains a searchable JSON index.
 */

import { existsSync, readFileSync, readdirSync, rmSync } from 'fs'
import { join } from 'path'
import type { LtmEntry, LtmIndex } from './types'
import {
  sessionPaths, atomicWrite, ensureDir,
  parseFrontmatter, serializeFrontmatter,
} from './utils'

// ── Index management ────────────────────────────────────────

function loadIndex(stateDir: string): LtmIndex {
  const indexPath = sessionPaths(stateDir).ltmIndex
  try {
    return JSON.parse(readFileSync(indexPath, 'utf8'))
  } catch {
    return { version: 1, entries: [] }
  }
}

function saveIndex(stateDir: string, index: LtmIndex): void {
  const indexPath = sessionPaths(stateDir).ltmIndex
  atomicWrite(indexPath, JSON.stringify(index, null, 2) + '\n')
}

function upsertEntry(stateDir: string, entry: LtmEntry): void {
  const index = loadIndex(stateDir)
  const existing = index.entries.findIndex(e => e.type === entry.type && e.id === entry.id)
  if (existing >= 0) {
    index.entries[existing] = entry
  } else {
    index.entries.push(entry)
  }
  saveIndex(stateDir, index)
}

function removeEntry(stateDir: string, type: string, id: string): void {
  const index = loadIndex(stateDir)
  index.entries = index.entries.filter(e => !(e.type === type && e.id === id))
  saveIndex(stateDir, index)
}

// ── User profiles ───────────────────────────────────────────

/** Get a user profile. Returns null if not found. */
export function getUserProfile(stateDir: string, userId: string): string | null {
  const path = join(sessionPaths(stateDir).ltmUsers, `${userId}.md`)
  if (!existsSync(path)) return null
  return readFileSync(path, 'utf8')
}

/** Create or update a user profile. Content should include frontmatter. */
export function setUserProfile(stateDir: string, userId: string, content: string): void {
  const usersDir = sessionPaths(stateDir).ltmUsers
  ensureDir(usersDir)
  const path = join(usersDir, `${userId}.md`)
  atomicWrite(path, content)

  // Update index
  const { meta } = parseFrontmatter(content)
  const tags = Array.isArray(meta.tags) ? meta.tags as string[] : []
  upsertEntry(stateDir, {
    type: 'user',
    id: userId,
    path: `ltm/users/${userId}.md`,
    tags,
    updated: new Date().toISOString(),
  })
}

/** Create a new user profile with defaults. */
export function createUserProfile(
  stateDir: string,
  userId: string,
  displayName?: string,
  channel?: string,
): void {
  const now = new Date().toISOString()
  const meta = {
    user_id: userId,
    display_name: displayName ?? userId,
    channel: channel ?? 'unknown',
    created: now,
    updated: now,
    tags: [] as string[],
  }
  const body = `
## Preferences

## Ongoing Topics

## Notes
- First interaction: ${now.slice(0, 10)}
`
  setUserProfile(stateDir, userId, serializeFrontmatter(meta, body))
}

/** Delete a user's LTM profile. */
export function deleteUserProfile(stateDir: string, userId: string): void {
  const path = join(sessionPaths(stateDir).ltmUsers, `${userId}.md`)
  if (existsSync(path)) rmSync(path)
  removeEntry(stateDir, 'user', userId)
}

// ── Topic notes ─────────────────────────────────────────────

/** Get a topic note by slug. */
export function getTopic(stateDir: string, slug: string): string | null {
  const path = join(sessionPaths(stateDir).ltmTopics, `${slug}.md`)
  if (!existsSync(path)) return null
  return readFileSync(path, 'utf8')
}

/** Create or update a topic note. */
export function setTopic(stateDir: string, slug: string, content: string): void {
  const topicsDir = sessionPaths(stateDir).ltmTopics
  ensureDir(topicsDir)
  const path = join(topicsDir, `${slug}.md`)
  atomicWrite(path, content)

  const { meta } = parseFrontmatter(content)
  const tags = Array.isArray(meta.tags) ? meta.tags as string[] : []
  upsertEntry(stateDir, {
    type: 'topic',
    id: slug,
    path: `ltm/topics/${slug}.md`,
    tags,
    updated: new Date().toISOString(),
  })
}

/** Delete a topic. */
export function deleteTopic(stateDir: string, slug: string): void {
  const path = join(sessionPaths(stateDir).ltmTopics, `${slug}.md`)
  if (existsSync(path)) rmSync(path)
  removeEntry(stateDir, 'topic', slug)
}

// ── Search ──────────────────────────────────────────────────

/** Search LTM entries by tags. */
export function searchByTags(stateDir: string, tags: string[]): LtmEntry[] {
  const index = loadIndex(stateDir)
  return index.entries.filter(e =>
    tags.some(t => e.tags.includes(t))
  )
}

/** Search LTM entries by text (grep through markdown files). */
export function searchByText(stateDir: string, query: string): LtmEntry[] {
  const index = loadIndex(stateDir)
  const lowerQuery = query.toLowerCase()
  return index.entries.filter(e => {
    const fullPath = join(sessionPaths(stateDir).root, e.path)
    if (!existsSync(fullPath)) return false
    const content = readFileSync(fullPath, 'utf8').toLowerCase()
    return content.includes(lowerQuery)
  })
}

/** List all LTM entries. */
export function listEntries(stateDir: string): LtmEntry[] {
  return loadIndex(stateDir).entries
}

/** Rebuild the LTM index from filesystem. */
export function rebuildIndex(stateDir: string): void {
  const paths = sessionPaths(stateDir)
  const index: LtmIndex = { version: 1, entries: [] }

  // Scan user profiles
  if (existsSync(paths.ltmUsers)) {
    for (const file of readdirSync(paths.ltmUsers)) {
      if (!file.endsWith('.md')) continue
      const id = file.replace('.md', '')
      const content = readFileSync(join(paths.ltmUsers, file), 'utf8')
      const { meta } = parseFrontmatter(content)
      index.entries.push({
        type: 'user',
        id,
        path: `ltm/users/${file}`,
        tags: Array.isArray(meta.tags) ? meta.tags as string[] : [],
        updated: (meta.updated as string) ?? new Date().toISOString(),
      })
    }
  }

  // Scan topics
  if (existsSync(paths.ltmTopics)) {
    for (const file of readdirSync(paths.ltmTopics)) {
      if (!file.endsWith('.md')) continue
      const id = file.replace('.md', '')
      const content = readFileSync(join(paths.ltmTopics, file), 'utf8')
      const { meta } = parseFrontmatter(content)
      index.entries.push({
        type: 'topic',
        id,
        path: `ltm/topics/${file}`,
        tags: Array.isArray(meta.tags) ? meta.tags as string[] : [],
        updated: (meta.updated as string) ?? new Date().toISOString(),
      })
    }
  }

  saveIndex(stateDir, index)
}
