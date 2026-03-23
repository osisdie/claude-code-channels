#!/usr/bin/env bun
/**
 * Slack message broker for Claude Code.
 *
 * Simple loop: poll Slack DMs → pipe to `claude` CLI → reply on Slack.
 * No MCP, no channel plugin, no Socket Mode — just Slack Web API + subprocess.
 *
 * Usage:
 *   bun run broker.ts
 *   POLL_INTERVAL=3 bun run broker.ts   # poll every 3s (default: 5)
 */

import { readFileSync, writeFileSync, mkdirSync, chmodSync, appendFileSync } from 'fs'
import { join, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { spawn } from 'child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_DIR = resolve(__dirname, '..', '..')

// ── Load .env ──────────────────────────────────────────────
function loadEnvFile(path: string): void {
  try {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const m = line.match(/^(\w+)=["']?([^"'\n]*)["']?$/)
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
    }
  } catch {}
}

const STATE_DIR = process.env.SLACK_STATE_DIR
  ?? resolve(PROJECT_DIR, '.claude/channels/slack')
loadEnvFile(join(STATE_DIR, '.env'))
loadEnvFile(join(PROJECT_DIR, '.env'))

const BOT_TOKEN = process.env.SLACK_BOT_TOKEN
if (!BOT_TOKEN) {
  console.error('SLACK_BOT_TOKEN not found in .env')
  process.exit(1)
}

const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL ?? '5', 10) * 1000
const CLAUDE_BIN = process.env.CLAUDE_BIN ?? 'claude'
const INBOX_DIR = join(STATE_DIR, 'inbox')
const LOG_DIR = join(STATE_DIR, 'logs')
mkdirSync(INBOX_DIR, { recursive: true })
mkdirSync(LOG_DIR, { recursive: true })

// ── Logging to file + console ──────────────────────────────
const logFile = join(LOG_DIR, `broker-${new Date().toISOString().slice(0, 10)}.log`)

function log(msg: string): void {
  const ts = new Date().toISOString()
  const line = `${ts} ${msg}\n`
  process.stdout.write(`[broker] ${msg}\n`)
  appendFileSync(logFile, line)
}

function logError(msg: string): void {
  const ts = new Date().toISOString()
  const line = `${ts} ERROR ${msg}\n`
  process.stderr.write(`[broker] ${msg}\n`)
  appendFileSync(logFile, line)
}

// ── Slack API helpers ──────────────────────────────────────
// POST with JSON body (chat.postMessage, reactions.add, etc.)
async function slack(method: string, body?: Record<string, unknown>): Promise<any> {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${BOT_TOKEN}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json()
  if (!data.ok) throw new Error(`Slack ${method}: ${data.error}`)
  return data
}

// GET with query params (conversations.list, conversations.history, etc.)
async function slackGet(method: string, params?: Record<string, string>): Promise<any> {
  const qs = params ? '?' + new URLSearchParams(params).toString() : ''
  const res = await fetch(`https://slack.com/api/${method}${qs}`, {
    headers: { 'Authorization': `Bearer ${BOT_TOKEN}` },
  })
  const data = await res.json()
  if (!data.ok) throw new Error(`Slack ${method}: ${data.error}`)
  return data
}

async function slackUpload(channelId: string, filePath: string, threadTs?: string): Promise<void> {
  const fileData = readFileSync(filePath)
  const fileName = filePath.split('/').pop() ?? 'file'

  // files.getUploadURLExternal → upload → files.completeUploadExternal
  const urlRes = await slack('files.getUploadURLExternal', {
    filename: fileName,
    length: fileData.length,
  })

  await fetch(urlRes.upload_url, {
    method: 'POST',
    body: fileData,
  })

  await slack('files.completeUploadExternal', {
    files: [{ id: urlRes.file_id, title: fileName }],
    channel_id: channelId,
    ...(threadTs ? { thread_ts: threadTs } : {}),
  })
}

// ── Bot identity ───────────────────────────────────────────
const auth = await slack('auth.test')
const BOT_USER_ID = auth.user_id
log(` connected as ${auth.user} (${BOT_USER_ID}) on ${auth.team}`)

// ── State: track last seen timestamp per channel ───────────
const CURSOR_FILE = join(STATE_DIR, 'broker_cursors.json')

function loadCursors(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(CURSOR_FILE, 'utf8'))
  } catch {
    return {}
  }
}

function saveCursors(c: Record<string, string>): void {
  writeFileSync(CURSOR_FILE, JSON.stringify(c, null, 2) + '\n')
}

// ── Access control ─────────────────────────────────────────
function loadAllowList(): string[] {
  try {
    const access = JSON.parse(readFileSync(join(STATE_DIR, 'access.json'), 'utf8'))
    return access.allowFrom ?? []
  } catch {
    return []
  }
}

// ── Download Slack file ────────────────────────────────────
async function downloadFile(url: string, name: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${BOT_TOKEN}` },
  })
  const buf = Buffer.from(await res.arrayBuffer())
  const path = join(INBOX_DIR, `${Date.now()}-${name}`)
  writeFileSync(path, buf)
  return path
}

// ── Run claude CLI ─────────────────────────────────────────
function runClaude(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const allowedTools = (process.env.BROKER_ALLOWED_TOOLS
      ?? 'WebSearch,WebFetch,Bash(curl:*),Bash(python3:*),Read')
      .split(',')
    const systemPrompt = process.env.BROKER_SYSTEM_PROMPT
      ?? 'You are a helpful assistant responding to messages from Slack chat. You have access to tools including WebSearch, Bash, and Read. Use them proactively when the user asks about real-time information (weather, news, prices, etc.) or needs computation. Respond concisely and directly. Use Slack mrkdwn formatting (*bold*, _italic_, bullet lists). Avoid markdown tables — use bullet points instead.'
    const args = [
      '-p',
      '--output-format', 'text',
      '--system-prompt', systemPrompt,
      '--allowedTools', ...allowedTools,
      '--',
      prompt,
    ]

    const child = spawn(CLAUDE_BIN, args, {
      cwd: PROJECT_DIR,
      env: { ...process.env, PATH: process.env.PATH },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
    child.on('close', (code) => {
      if (code !== 0) {
        logError(` claude exit ${code}: ${stderr.slice(0, 200)}`)
        reject(new Error(`claude exited with code ${code}`))
      } else {
        resolve(stdout.trim())
      }
    })
    child.on('error', reject)

    // Timeout: 5 minutes
    setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error('claude timed out after 5 minutes'))
    }, 5 * 60 * 1000)
  })
}

// ── Chunk text for Slack (4000 char limit) ─────────────────
function chunk(text: string, limit = 3900): string[] {
  if (text.length <= limit) return [text]
  const out: string[] = []
  let rest = text
  while (rest.length > limit) {
    const cut = rest.lastIndexOf('\n', limit)
    const pos = cut > limit / 2 ? cut : limit
    out.push(rest.slice(0, pos))
    rest = rest.slice(pos).replace(/^\n+/, '')
  }
  if (rest) out.push(rest)
  return out
}

// ── Rate limiting & busy guard ─────────────────────────────
let processing = false
const RATE_LIMIT_MS = parseInt(process.env.RATE_LIMIT_MS ?? '5000', 10)
const lastMessageTime: Record<string, number> = {}

// ── Process a single message ───────────────────────────────
async function processMessage(channelId: string, msg: any): Promise<void> {
  const text = msg.text ?? ''
  const userId = msg.user
  const ts = msg.ts

  log(`${userId}: ${text.slice(0, 80)}${text.length > 80 ? '...' : ''}`)

  // Rate limit — per-user cooldown
  const now = Date.now()
  const lastTime = lastMessageTime[userId] ?? 0
  if (now - lastTime < RATE_LIMIT_MS) {
    const waitSec = Math.ceil((RATE_LIMIT_MS - (now - lastTime)) / 1000)
    log(`rate limited: ${userId} (wait ${waitSec}s)`)
    await slack('chat.postMessage', {
      channel: channelId,
      text: `⏳ Please wait ${waitSec}s before sending another message.`,
      thread_ts: ts,
    }).catch(() => {})
    return
  }
  lastMessageTime[userId] = now

  // React with eyes to ack
  await slack('reactions.add', {
    channel: channelId,
    timestamp: ts,
    name: 'eyes',
  }).catch(() => {})

  // Download attached files
  const imageFiles: string[] = []
  if (msg.files) {
    for (const f of msg.files) {
      if (f.url_private) {
        try {
          const localPath = await downloadFile(f.url_private, f.name ?? f.id)
          imageFiles.push(localPath)
          log(` downloaded: ${localPath}`)
        } catch (e) {
          logError(` download failed: ${e}`)
        }
      }
    }
  }

  // Build prompt — include file paths so Claude can Read them
  let prompt = text || ''
  if (imageFiles.length > 0) {
    const fileList = imageFiles.map(f => `  - ${f}`).join('\n')
    prompt = prompt
      ? `${prompt}\n\nAttached files (use Read tool to view):\n${fileList}`
      : `Describe the attached file(s):\n${fileList}`
  }

  try {
    const response = await runClaude(prompt)

    // Send response chunks
    const chunks = chunk(response)
    for (const c of chunks) {
      await slack('chat.postMessage', {
        channel: channelId,
        text: c,
        thread_ts: ts,
      })
    }

    // React with checkmark
    await slack('reactions.add', {
      channel: channelId,
      timestamp: ts,
      name: 'white_check_mark',
    }).catch(() => {})
  } catch (e) {
    logError(` claude error: ${e}`)
    await slack('chat.postMessage', {
      channel: channelId,
      text: `Error: ${e instanceof Error ? e.message : String(e)}`,
      thread_ts: ts,
    }).catch(() => {})

    // React with X
    await slack('reactions.add', {
      channel: channelId,
      timestamp: ts,
      name: 'x',
    }).catch(() => {})
  }
}

// ── Poll loop ──────────────────────────────────────────────
log(` polling every ${POLL_INTERVAL / 1000}s — DM the bot on Slack`)
log(` project: ${PROJECT_DIR}`)
log(` state: ${STATE_DIR}`)

const cursors = loadCursors()

async function poll(): Promise<void> {
  if (processing) return

  try {
    // List DM channels (must use GET, not POST JSON)
    const convs = await slackGet('conversations.list', { types: 'im', limit: '50' })
    const allowList = loadAllowList()
    const dmChannels = (convs.channels ?? []).filter((c: any) => c.user && c.user !== BOT_USER_ID)

    for (const ch of dmChannels) {
      const channelId = ch.id
      const userId = ch.user

      // Skip slackbot
      if (userId === 'USLACKBOT') continue

      // Access control: if allowFrom is set, only allow listed users
      if (allowList.length > 0 && !allowList.includes(userId)) continue

      // Fetch messages since last cursor
      const oldest = cursors[channelId] ?? '0' // get all messages on first run

      let history: any
      try {
        history = await slackGet('conversations.history', {
          channel: channelId,
          oldest,
          limit: '10',
        })
      } catch {
        continue // channel not accessible
      }

      const allMsgs = history.messages ?? []
      const messages = allMsgs
        .filter((m: any) => !m.bot_id && !m.subtype && m.user && m.user !== BOT_USER_ID)
        .reverse() // oldest first
      if (messages.length > 0) {
        log(` ${channelId}: ${messages.length} new message(s)`)
      }

      for (const msg of messages) {
        processing = true
        try {
          await processMessage(channelId, msg)
        } finally {
          processing = false
        }
        // Update cursor to this message
        cursors[channelId] = msg.ts
        saveCursors(cursors)
      }

      // Even if no new messages, update cursor to latest
      if (history.messages?.length > 0) {
        const latest = history.messages[0].ts // newest (API returns newest first)
        if (!cursors[channelId] || parseFloat(latest) > parseFloat(cursors[channelId])) {
          cursors[channelId] = latest
          saveCursors(cursors)
        }
      }
    }
  } catch (e) {
    logError(` poll error: ${e}`)
  }
}

// Initial poll
await poll()

// Loop
setInterval(poll, POLL_INTERVAL)
