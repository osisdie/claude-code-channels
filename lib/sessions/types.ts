/**
 * Session management type definitions.
 */

export interface SessionConfig {
  stm: {
    /** Max messages to keep in raw JSONL before triggering compact (default: 50) */
    maxMessages: number
    /** Max age in minutes for STM entries before expiry (default: 120) */
    maxAgeMinutes: number
    /** Number of recent messages to inject into claude -p context (default: 10) */
    contextWindow: number
  }
  compacting: {
    /** Enable auto-compacting (default: true) */
    enabled: boolean
    /** Compact when message count exceeds this (default: 50) */
    threshold: number
    /** Hour of day (0-23) to generate daily summaries (default: 3) */
    dailySummaryHour: number
    /** Day of week (0=Sun) for weekly summaries (default: 0) */
    weeklySummaryDay: number
  }
  scheduler: {
    /** Days to keep broker logs before rotation (default: 7) */
    logRotateDays: number
    /** Days to keep STM entries before expiry (default: 3) */
    stmExpireDays: number
    /** Compress archived files with gzip (default: true) */
    archiveCompression: boolean
    /** Interval in minutes for cleanup tasks (default: 60) */
    cleanupIntervalMinutes: number
  }
}

export interface StmMessage {
  ts: string
  role: 'user' | 'assistant' | 'system'
  text: string
  msgId?: string
  channel?: string
  attachments?: Array<{ type: string; path: string; name?: string }>
  threadId?: string
  groupId?: string
}

export interface LtmEntry {
  type: 'user' | 'topic'
  id: string
  path: string
  tags: string[]
  updated: string
}

export interface LtmIndex {
  version: number
  entries: LtmEntry[]
}

export interface StorageReport {
  channel: string
  stmFiles: number
  stmSizeBytes: number
  ltmFiles: number
  ltmSizeBytes: number
  summaryFiles: number
  summarySizeBytes: number
  archiveFiles: number
  archiveSizeBytes: number
  totalSizeBytes: number
}

export interface MaintenanceReport {
  logsRotated: number
  stmExpired: number
  messagesArchived: number
  summariesGenerated: number
  errors: string[]
}

export const DEFAULT_CONFIG: SessionConfig = {
  stm: {
    maxMessages: 50,
    maxAgeMinutes: 120,
    contextWindow: 10,
  },
  compacting: {
    enabled: true,
    threshold: 50,
    dailySummaryHour: 3,
    weeklySummaryDay: 0,
  },
  scheduler: {
    logRotateDays: 7,
    stmExpireDays: 3,
    archiveCompression: true,
    cleanupIntervalMinutes: 60,
  },
}
