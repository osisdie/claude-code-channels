/**
 * LINE Relay — Cloudflare Worker
 *
 * Receives LINE webhook events, queues them in KV, and serves them
 * to a local bridge that runs Claude. Replies via LINE Push API.
 *
 * Endpoints:
 *   POST /webhook       — LINE Platform calls this
 *   GET  /messages      — Local bridge polls queued messages
 *   POST /reply         — Local bridge sends Claude's response
 *   GET  /content/:id   — Proxy LINE Content API (images/files)
 *   DELETE /messages    — Ack consumed messages
 *   GET  /health        — Health check
 */

interface Env {
  LINE_QUEUE: KVNamespace
  LINE_CHANNEL_SECRET: string
  LINE_CHANNEL_ACCESS_TOKEN: string
  RELAY_SECRET: string
}

interface QueuedMessage {
  id: string
  userId: string
  groupId?: string
  sourceType: 'user' | 'group' | 'room'
  messageType: string
  messageId: string
  text?: string
  fileName?: string
  mention?: { mentionees: Array<{ index: number; length: number; userId?: string; isSelf?: boolean }> }
  timestamp: number
  enqueuedAt: number
}

// ── Helpers ────────────────────────────────────────────────

async function verifySignature(body: string, secret: string, signature: string): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)))
  return expected === signature
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return result === 0
}

function checkAuth(request: Request, env: Env): Response | null {
  const auth = request.headers.get('Authorization') ?? ''
  const token = auth.replace('Bearer ', '')
  if (!token || !timingSafeEqual(token, env.RELAY_SECRET)) {
    return new Response('unauthorized', { status: 401 })
  }
  return null
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// ── Handlers ───────────────────────────────────────────────

async function handleWebhook(request: Request, env: Env): Promise<Response> {
  const body = await request.text()
  const signature = request.headers.get('x-line-signature') ?? ''

  if (!await verifySignature(body, env.LINE_CHANNEL_SECRET, signature)) {
    console.log('[webhook] invalid signature — rejected')
    return new Response('invalid signature', { status: 403 })
  }

  let data: any
  try {
    data = JSON.parse(body)
  } catch {
    return new Response('invalid json', { status: 400 })
  }

  const events = data.events ?? []
  const now = Date.now()

  console.log(`[webhook] received ${events.length} event(s)`)

  for (const event of events) {
    if (event.type === 'unsend') {
      const unsendMsg = {
        id: `unsend:${String(now).padStart(15, '0')}:${crypto.randomUUID().slice(0, 8)}`,
        type: 'unsend',
        userId: event.source?.userId ?? '',
        groupId: event.source?.groupId ?? event.source?.roomId,
        messageId: event.unsend?.messageId ?? '',
        timestamp: event.timestamp ?? now,
        enqueuedAt: now,
      }
      await env.LINE_QUEUE.put(unsendMsg.id, JSON.stringify(unsendMsg), { expirationTtl: 3600 })
      console.log(`[webhook] queued unsend: ${unsendMsg.messageId} from ${unsendMsg.userId}`)
      continue
    }

    if (event.type !== 'message') {
      console.log(`[webhook] skipping event type: ${event.type}`)
      continue
    }

    const msg: QueuedMessage = {
      id: `msg:${String(now).padStart(15, '0')}:${crypto.randomUUID().slice(0, 8)}`,
      userId: event.source?.userId ?? '',
      groupId: event.source?.groupId ?? event.source?.roomId,
      sourceType: event.source?.type ?? 'user',
      messageType: event.message?.type ?? 'text',
      messageId: event.message?.id ?? '',
      text: event.message?.text,
      fileName: event.message?.fileName,
      mention: event.message?.mention,
      timestamp: event.timestamp ?? now,
      enqueuedAt: now,
    }

    // Store with 1-hour TTL
    await env.LINE_QUEUE.put(msg.id, JSON.stringify(msg), { expirationTtl: 3600 })
    console.log(`[webhook] queued ${msg.id}: ${msg.messageType} from ${msg.userId}${msg.groupId ? ` in group ${msg.groupId}` : ''}`)
  }

  return new Response('ok')
}

async function handleGetMessages(request: Request, env: Env): Promise<Response> {
  const authErr = checkAuth(request, env)
  if (authErr) return authErr

  try {
    // Single list() call — keys are prefixed with msg: or unsend:, both sort lexically
    const allKeys = await env.LINE_QUEUE.list()
    const messages: QueuedMessage[] = []

    for (const key of allKeys.keys) {
      const val = await env.LINE_QUEUE.get(key.name)
      if (val) {
        try {
          messages.push(JSON.parse(val))
        } catch {}
      }
    }

    if (messages.length > 0) {
      console.log(`[messages] returning ${messages.length} queued message(s)`)
    }
    return json({ messages })
  } catch (e: any) {
    console.error(`[messages] error: ${e?.message ?? e}`)
    return json({ error: e?.message ?? 'internal error', messages: [] }, 500)
  }
}

async function handleDeleteMessages(request: Request, env: Env): Promise<Response> {
  const authErr = checkAuth(request, env)
  if (authErr) return authErr

  let body: any
  try {
    body = await request.json()
  } catch {
    return new Response('invalid json', { status: 400 })
  }

  const keys = body.keys ?? []
  for (const key of keys) {
    await env.LINE_QUEUE.delete(key)
  }

  return json({ deleted: keys.length })
}

async function handleReply(request: Request, env: Env): Promise<Response> {
  const authErr = checkAuth(request, env)
  if (authErr) return authErr

  let body: any
  try {
    body = await request.json()
  } catch {
    return new Response('invalid json', { status: 400 })
  }

  const { userId, text, groupId } = body
  if (!userId || !text) {
    return json({ ok: false, error: 'userId and text required' }, 400)
  }

  // Chunk text for LINE (5000 char limit)
  const chunks: string[] = []
  let rest = text as string
  while (rest.length > 4900) {
    const cut = rest.lastIndexOf('\n', 4900)
    const pos = cut > 1000 ? cut : 4900
    chunks.push(rest.slice(0, pos))
    rest = rest.slice(pos).replace(/^\n+/, '')
  }
  if (rest) chunks.push(rest)

  // Send via Push API (reply to user or group)
  const target = groupId ?? userId
  for (const chunk of chunks) {
    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        to: target,
        messages: [{ type: 'text', text: chunk }],
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      return json({ ok: false, error: err }, 502)
    }
  }

  return json({ ok: true, chunks: chunks.length })
}

async function handleContent(request: Request, env: Env, messageId: string): Promise<Response> {
  const authErr = checkAuth(request, env)
  if (authErr) return authErr

  const res = await fetch(
    `https://api-data.line.me/v2/bot/message/${messageId}/content`,
    { headers: { 'Authorization': `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` } },
  )

  if (!res.ok) {
    return new Response(`LINE Content API error: ${res.status}`, { status: 502 })
  }

  return new Response(res.body, {
    headers: {
      'Content-Type': res.headers.get('Content-Type') ?? 'application/octet-stream',
      'Content-Length': res.headers.get('Content-Length') ?? '',
    },
  })
}

// ── Router ─────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    if (path === '/health' || path === '/') {
      return new Response('ok')
    }

    if (path === '/webhook' && request.method === 'POST') {
      return handleWebhook(request, env)
    }

    if (path === '/messages' && request.method === 'GET') {
      return handleGetMessages(request, env)
    }

    if (path === '/messages' && request.method === 'DELETE') {
      return handleDeleteMessages(request, env)
    }

    if (path === '/reply' && request.method === 'POST') {
      return handleReply(request, env)
    }

    const contentMatch = path.match(/^\/content\/(.+)$/)
    if (contentMatch && request.method === 'GET') {
      return handleContent(request, env, contentMatch[1])
    }

    return new Response('not found', { status: 404 })
  },
}
