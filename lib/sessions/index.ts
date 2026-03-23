/**
 * Session management library — public API.
 *
 * Provides file-based session persistence for broker channels (Slack/LINE).
 * Brokers import from this module to log messages, build context, and manage sessions.
 */

// Types
export type {
  SessionConfig, StmMessage, LtmEntry, LtmIndex,
  StorageReport, MaintenanceReport,
} from './types'
export { DEFAULT_CONFIG } from './types'

// Utils
export { loadConfig, saveConfig, sessionPaths } from './utils'

// STM
export {
  appendMessage, getRecentMessages, getAllMessages,
  getMessageCount, getSummary, buildContextPrompt,
  deleteMessageById,
  clearUser as clearUserStm, clearAll as clearAllStm,
  listUsers,
} from './stm'

// LTM
export {
  getUserProfile, setUserProfile, createUserProfile,
  deleteUserProfile, getTopic, setTopic, deleteTopic,
  searchByTags, searchByText, listEntries, rebuildIndex,
} from './ltm'

// Compactor
export { maybeCompact, generateDailySummary, generateWeeklySummary } from './compactor'

// Scheduler
export { startScheduler, runMaintenance } from './scheduler'

// Cleanup
export {
  getStorageReport, deleteUserData, exportUserData, prune,
} from './cleanup'

// Commands
export { parseSessionCommand, executeSessionCommand } from './commands'
