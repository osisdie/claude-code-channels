#!/usr/bin/env bun
/**
 * LINE message broker for Claude Code.
 *
 * HTTP server receives LINE webhook events → pipes to `claude` CLI → replies.
 * Uses Reply API (free) first, falls back to Push API if replyToken expired.
 *
 * Usage:
 *   bun run broker.ts
 *   PORT=3000 bun run broker.ts
 */

import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'fs'
import { join, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { spawn } from 'child_process'
import { createHmac } from 'crypto'

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

const STATE_DIR = process.env.LINE_STATE_DIR
  ?? resolve(PROJECT_DIR, '.claude/channels/line')
loadEnvFile(join(STATE_DIR, '.env'))
loadEnvFile(join(PROJECT_DIR, '.env'))

const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET

if (!CHANNEL_ACCESS_TOKEN) {
  console.error('LINE_CHANNEL_ACCESS_TOKEN not found in .env')
  process.exit(1)
}
if (!CHANNEL_SECRET) {
  console.error('LINE_CHANNEL_SECRET not found in .env')
  process.exit(1)
}

const PORT = parseInt(process.env.PORT ?? '3000', 10)
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

// ── Webhook signature verification ─────────────────────────
function verifySignature(body: string, signature: string): boolean {
  const hash = createHmac('SHA256', CHANNEL_SECRET!)
    .update(body)
    .digest('base64')
  return hash === signature
}

// ── LINE API helpers ───────────────────────────────────────
async function lineReply(replyToken: string, messages: Array<{ type: string; text: string }>): Promise<boolean> {
  try {
    const res = await fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CHANNEL_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({ replyToken, messages }),
    })
    return res.ok
  } catch {
    return false
  }
}

async function linePush(userId: string, messages: Array<{ type: string; text: string }>): Promise<boolean> {
  try {
    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CHANNEL_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({ to: userId, messages }),
    })
    if (!res.ok) {
      const err = await res.text()
      logError(` push failed: ${err}`)
    }
    return res.ok
  } catch (e) {
    logError(` push error: ${e}`)
    return false
  }
}

async function downloadContent(messageId: string, fileName: string): Promise<string> {
  const res = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
    headers: { 'Authorization': `Bearer ${CHANNEL_ACCESS_TOKEN}` },
  })
  if (!res.ok) throw new Error(`download failed: ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const path = join(INBOX_DIR, `${Date.now()}-${fileName}`)
  writeFileSync(path, buf)
  return path
}

// ── Access control ─────────────────────────────────────────
type AccessConfig = {
  allowFrom: string[]
  groups: Record<string, { allowFrom?: string[] }>
}

function loadAccess(): AccessConfig {
  try {
    const data = JSON.parse(readFileSync(join(STATE_DIR, 'access.json'), 'utf8'))
    return {
      allowFrom: data.allowFrom ?? [],
      groups: data.groups ?? {},
    }
  } catch {
    return { allowFrom: [], groups: {} }
  }
}

// ── Run claude CLI ─────────────────────────────────────────
function runClaude(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const allowedTools = (process.env.BROKER_ALLOWED_TOOLS
      ?? 'WebSearch,WebFetch,Bash(curl:*),Bash(python3:*),Read')
      .split(',')
    const systemPrompt = process.env.BROKER_SYSTEM_PROMPT
      ?? 'You are a helpful assistant responding to messages from LINE chat. You have access to tools including WebSearch, Bash, and Read. Use them proactively when the user asks about real-time information (weather, news, prices, etc.) or needs computation. IMPORTANT formatting rules for LINE chat: 1) NEVER use markdown tables (| col | col |) — they are unreadable on mobile. Use bullet points or numbered lists instead. 2) Keep responses concise — prefer short paragraphs. 3) Use plain text formatting, no markdown headers (#). 4) Use emoji sparingly for visual structure.'
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

// ── Chunk text for LINE ─────────────────────────────────────
// Smaller chunks (2000 chars) for better readability on mobile.
// Prefer splitting on paragraph boundaries (double newline).
const CHUNK_LIMIT = parseInt(process.env.CHUNK_LIMIT ?? '2000', 10)

function chunk(text: string, limit = CHUNK_LIMIT): string[] {
  if (text.length <= limit) return [text]
  const out: string[] = []
  let rest = text
  while (rest.length > limit) {
    // Prefer paragraph break, then line break, then space
    const para = rest.lastIndexOf('\n\n', limit)
    const line = rest.lastIndexOf('\n', limit)
    const space = rest.lastIndexOf(' ', limit)
    const cut = para > limit / 3 ? para
      : line > limit / 3 ? line
      : space > 0 ? space
      : limit
    out.push(rest.slice(0, cut).trimEnd())
    rest = rest.slice(cut).replace(/^\n+/, '')
  }
  if (rest.trim()) out.push(rest.trim())
  return out
}

// ── Rate limiting & busy guard ─────────────────────────────
let processing = false
const BUSY_MSG = '⏳ Processing previous request, please wait...'
const RATE_LIMIT_MS = parseInt(process.env.RATE_LIMIT_MS ?? '5000', 10)
const lastMessageTime: Record<string, number> = {} // per-user cooldown

async function processMessageEvent(event: any): Promise<void> {
  const sourceType = event.source?.type // 'user' (DM), 'group', 'room'
  const userId = event.source?.userId
  const groupId = event.source?.groupId ?? event.source?.roomId
  const replyToken = event.replyToken
  const messageType = event.message?.type
  const messageId = event.message?.id
  const text = event.message?.text ?? ''

  if (!userId) return

  // Access control — check user allowlist and group allowlist
  const access = loadAccess()
  const allowList = access.allowFrom ?? []
  const groups = access.groups ?? {}

  if (sourceType === 'group' || sourceType === 'room') {
    // Group message — check if group is opted-in
    if (groupId && !groups[groupId]) {
      return // group not opted-in, silently ignore
    }
    // If group has per-user restriction, check it
    const groupPolicy = groups[groupId]
    if (groupPolicy?.allowFrom?.length > 0 && !groupPolicy.allowFrom.includes(userId)) {
      return
    }
    log(`group:${groupId} ${userId}: [${messageType}] ${text.slice(0, 80)}${text.length > 80 ? '...' : ''}`)
  } else {
    // DM — check user allowlist
    if (allowList.length > 0 && !allowList.includes(userId)) {
      log(`blocked: ${userId} not in allowlist`)
      return
    }
    log(`${userId}: [${messageType}] ${text.slice(0, 80)}${text.length > 80 ? '...' : ''}`)
  }

  // Busy guard — reject if already processing another message
  if (processing) {
    log(`busy — rejecting message from ${userId}`)
    await lineReply(replyToken, [{ type: 'text', text: BUSY_MSG }])
    return
  }

  // Rate limit — per-user cooldown
  const now = Date.now()
  const lastTime = lastMessageTime[userId] ?? 0
  if (now - lastTime < RATE_LIMIT_MS) {
    const waitSec = Math.ceil((RATE_LIMIT_MS - (now - lastTime)) / 1000)
    log(`rate limited: ${userId} (wait ${waitSec}s)`)
    await lineReply(replyToken, [{ type: 'text', text: `⏳ Please wait ${waitSec}s before sending another message.` }])
    return
  }
  lastMessageTime[userId] = now

  // Download images/files
  const imageFiles: string[] = []
  if (messageType === 'image' && messageId) {
    try {
      const path = await downloadContent(messageId, `${messageId}.jpg`)
      imageFiles.push(path)
      log(` downloaded: ${path}`)
    } catch (e) {
      logError(` download failed: ${e}`)
    }
  } else if (messageType === 'file' && messageId) {
    const fileName = event.message?.fileName ?? `${messageId}.bin`
    try {
      const path = await downloadContent(messageId, fileName)
      imageFiles.push(path)
      log(` downloaded: ${path}`)
    } catch (e) {
      logError(` download failed: ${e}`)
    }
  } else if (messageType === 'sticker') {
    log(` sticker: pkg=${event.message?.packageId} stk=${event.message?.stickerId}`)
    // Skip stickers — no meaningful content to process
    return
  } else if (messageType !== 'text') {
    log(` skipping unsupported type: ${messageType}`)
    return
  }

  // Build prompt
  let prompt = text || ''
  if (imageFiles.length > 0) {
    const fileList = imageFiles.map(f => `  - ${f}`).join('\n')
    prompt = prompt
      ? `${prompt}\n\nAttached files (use Read tool to view):\n${fileList}`
      : `Describe the attached file(s):\n${fileList}`
  }

  if (!prompt) return

  try {
    processing = true
    const response = await runClaude(prompt)

    // Send response — try Reply API first (free), fall back to Push API
    const chunks = chunk(response)

    // LINE Reply API allows up to 5 messages per reply
    const replyMessages = chunks.slice(0, 5).map(c => ({ type: 'text' as const, text: c }))
    const replied = await lineReply(replyToken, replyMessages)

    if (!replied) {
      // replyToken expired or failed — use Push API
      log(` reply failed, falling back to push`)
      for (const c of chunks) {
        await linePush(userId, [{ type: 'text', text: c }])
      }
    } else if (chunks.length > 5) {
      // Reply sent first 5, push the rest
      for (const c of chunks.slice(5)) {
        await linePush(userId, [{ type: 'text', text: c }])
      }
    }

    log(` responded (${chunks.length} chunk(s))`)
  } catch (e) {
    logError(` claude error: ${e}`)
    const errMsg = `Error: ${e instanceof Error ? e.message : String(e)}`
    const pushed = await lineReply(replyToken, [{ type: 'text', text: errMsg }])
    if (!pushed) {
      await linePush(userId, [{ type: 'text', text: errMsg }])
    }
  } finally {
    processing = false
  }
}

// ── HTTP server (webhook receiver) ─────────────────────────
const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)

    // Health check
    if (url.pathname === '/health' || url.pathname === '/') {
      return new Response('ok')
    }

    // Webhook endpoint
    if (url.pathname === '/webhook' && req.method === 'POST') {
      const body = await req.text()
      const signature = req.headers.get('x-line-signature') ?? ''

      // Verify signature
      if (!verifySignature(body, signature)) {
        logError(' invalid signature — rejecting webhook')
        return new Response('invalid signature', { status: 403 })
      }

      // Parse events
      let data: any
      try {
        data = JSON.parse(body)
      } catch {
        return new Response('invalid json', { status: 400 })
      }

      // Respond 200 immediately (LINE requires quick ack)
      // Process events asynchronously
      const events = data.events ?? []
      for (const event of events) {
        if (event.type === 'message') {
          // Process async — don't block the webhook response
          processMessageEvent(event).catch(e => {
            logError(` event processing error: ${e}`)
          })
        } else if (event.type === 'follow') {
          log(`new follower: ${event.source?.userId}`)
        } else if (event.type === 'unfollow') {
          log(`unfollowed: ${event.source?.userId}`)
        } else if (event.type === 'join') {
          log(`joined group: ${event.source?.groupId ?? event.source?.roomId} (type: ${event.source?.type})`)
        } else if (event.type === 'leave') {
          log(`left group: ${event.source?.groupId ?? event.source?.roomId}`)
        } else if (event.type === 'memberJoined') {
          const members = event.joined?.members?.map((m: any) => m.userId).join(', ') ?? '?'
          log(`member joined group ${event.source?.groupId}: ${members}`)
        }
      }

      return new Response('ok')
    }

    return new Response('not found', { status: 404 })
  },
})

log(` LINE webhook server running on port ${PORT}`)
log(` webhook URL: http://localhost:${PORT}/webhook`)
log(` project: ${PROJECT_DIR}`)
log(` state: ${STATE_DIR}`)
log(` Set your LINE webhook to: https://<your-tunnel>/webhook`)
