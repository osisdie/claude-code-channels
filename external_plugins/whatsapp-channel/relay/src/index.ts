/**
 * WhatsApp Relay — Cloudflare Worker
 *
 * Receives WhatsApp webhook events (Meta Cloud API), queues them in KV,
 * and serves them to a local bridge that runs Claude. Replies via Graph API.
 *
 * Endpoints:
 *   GET  /webhook       — Meta verification challenge
 *   POST /webhook       — Receive message events, verify HMAC, queue in KV
 *   GET  /messages      — Local bridge polls queued messages
 *   DELETE /messages    — Ack consumed messages
 *   POST /reply         — Local bridge sends Claude's response
 *   GET  /media/:id     — Proxy media download from Graph API
 *   GET  /health        — Health check
 */

interface Env {
  WA_QUEUE: KVNamespace
  WA_VERIFY_TOKEN: string
  WA_APP_SECRET: string
  WA_ACCESS_TOKEN: string
  WA_PHONE_NUMBER_ID: string
  RELAY_SECRET: string
}

interface QueuedMessage {
  id: string
  from: string            // sender phone number
  waMessageId: string     // WhatsApp message ID (for read receipts)
  type: string            // text, image, document, audio, video, sticker, location
  text?: string
  mediaId?: string
  mimeType?: string
  fileName?: string
  caption?: string
  latitude?: number
  longitude?: number
  isGroup: boolean
  groupId?: string        // group JID if from a group
  timestamp: number
  enqueuedAt: number
}

// ── Helpers ────────────────────────────────────────────────

async function verifyHmac(body: string, secret: string, signature: string): Promise<boolean> {
  // Meta sends: sha256=<hex>
  const expected = signature.replace('sha256=', '')
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  const computed = Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
  return timingSafeEqual(computed, expected)
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

// ── Webhook Verification (GET) ────────────────────────────

function handleVerify(request: Request, env: Env): Response {
  const url = new URL(request.url)
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token === env.WA_VERIFY_TOKEN) {
    console.log('[verify] webhook verified')
    return new Response(challenge ?? '', { status: 200 })
  }

  console.log('[verify] failed — token mismatch')
  return new Response('forbidden', { status: 403 })
}

// ── Webhook Events (POST) ─────────────────────────────────

async function handleWebhook(request: Request, env: Env): Promise<Response> {
  const body = await request.text()
  const signature = request.headers.get('x-hub-signature-256') ?? ''

  if (!await verifyHmac(body, env.WA_APP_SECRET, signature)) {
    console.log('[webhook] invalid signature — rejected')
    return new Response('invalid signature', { status: 403 })
  }

  let data: any
  try {
    data = JSON.parse(body)
  } catch {
    return new Response('invalid json', { status: 400 })
  }

  // Meta webhook structure: object → entry[] → changes[] → value
  const entries = data.entry ?? []
  const now = Date.now()
  let queued = 0

  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages') continue
      const value = change.value ?? {}
      const messages = value.messages ?? []

      for (const waMsg of messages) {
        const msg: QueuedMessage = {
          id: `msg:${String(now).padStart(15, '0')}:${crypto.randomUUID().slice(0, 8)}`,
          from: waMsg.from ?? '',
          waMessageId: waMsg.id ?? '',
          type: waMsg.type ?? 'text',
          text: waMsg.text?.body,
          mediaId: waMsg.image?.id ?? waMsg.document?.id ?? waMsg.audio?.id ?? waMsg.video?.id ?? waMsg.sticker?.id,
          mimeType: waMsg.image?.mime_type ?? waMsg.document?.mime_type ?? waMsg.audio?.mime_type ?? waMsg.video?.mime_type,
          fileName: waMsg.document?.filename,
          caption: waMsg.image?.caption ?? waMsg.document?.caption ?? waMsg.video?.caption,
          latitude: waMsg.location?.latitude,
          longitude: waMsg.location?.longitude,
          isGroup: !!waMsg.context?.group_id,
          groupId: waMsg.context?.group_id,
          timestamp: parseInt(waMsg.timestamp ?? '0', 10) * 1000,
          enqueuedAt: now,
        }

        await env.WA_QUEUE.put(msg.id, JSON.stringify(msg), { expirationTtl: 3600 })
        queued++
        console.log(`[webhook] queued ${msg.id}: ${msg.type} from ${msg.from}`)
      }
    }
  }

  if (queued > 0) console.log(`[webhook] queued ${queued} message(s)`)
  return new Response('ok')
}

// ── Poll Messages (GET /messages) ─────────────────────────

async function handleGetMessages(request: Request, env: Env): Promise<Response> {
  const authErr = checkAuth(request, env)
  if (authErr) return authErr

  const keys = await env.WA_QUEUE.list({ prefix: 'msg:' })
  const messages: QueuedMessage[] = []

  for (const key of keys.keys) {
    const val = await env.WA_QUEUE.get(key.name)
    if (val) {
      try { messages.push(JSON.parse(val)) } catch {}
    }
  }

  if (messages.length > 0) {
    console.log(`[messages] returning ${messages.length} queued message(s)`)
  }
  return json({ messages })
}

// ── Ack Messages (DELETE /messages) ───────────────────────

async function handleDeleteMessages(request: Request, env: Env): Promise<Response> {
  const authErr = checkAuth(request, env)
  if (authErr) return authErr

  let body: any
  try { body = await request.json() } catch {
    return new Response('invalid json', { status: 400 })
  }

  const keys = body.keys ?? []
  for (const key of keys) {
    await env.WA_QUEUE.delete(key)
  }
  return json({ deleted: keys.length })
}

// ── Reply (POST /reply) ──────────────────────────────────

async function handleReply(request: Request, env: Env): Promise<Response> {
  const authErr = checkAuth(request, env)
  if (authErr) return authErr

  let body: any
  try { body = await request.json() } catch {
    return new Response('invalid json', { status: 400 })
  }

  const { to, text, waMessageId } = body
  if (!to || !text) {
    return json({ ok: false, error: 'to and text required' }, 400)
  }

  // Chunk text (WhatsApp max 4096 chars)
  const chunks: string[] = []
  let rest = text as string
  while (rest.length > 4000) {
    const cut = rest.lastIndexOf('\n', 4000)
    const pos = cut > 1000 ? cut : 4000
    chunks.push(rest.slice(0, pos))
    rest = rest.slice(pos).replace(/^\n+/, '')
  }
  if (rest) chunks.push(rest)

  const graphUrl = `https://graph.facebook.com/v21.0/${env.WA_PHONE_NUMBER_ID}/messages`

  // Mark as read first
  if (waMessageId) {
    await fetch(graphUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.WA_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: waMessageId,
      }),
    }).catch(() => {})
  }

  // Send reply chunks
  for (const chunk of chunks) {
    const res = await fetch(graphUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.WA_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: chunk },
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      return json({ ok: false, error: err }, 502)
    }
  }

  return json({ ok: true, chunks: chunks.length })
}

// ── Media Proxy (GET /media/:id) ──────────────────────────

async function handleMedia(request: Request, env: Env, mediaId: string): Promise<Response> {
  const authErr = checkAuth(request, env)
  if (authErr) return authErr

  // Step 1: Get media URL from Graph API
  const metaRes = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, {
    headers: { 'Authorization': `Bearer ${env.WA_ACCESS_TOKEN}` },
  })

  if (!metaRes.ok) {
    return new Response(`Graph API error: ${metaRes.status}`, { status: 502 })
  }

  const meta: any = await metaRes.json()
  const mediaUrl = meta.url
  if (!mediaUrl) {
    return new Response('no media URL in response', { status: 502 })
  }

  // Step 2: Download the actual media
  const mediaRes = await fetch(mediaUrl, {
    headers: { 'Authorization': `Bearer ${env.WA_ACCESS_TOKEN}` },
  })

  if (!mediaRes.ok) {
    return new Response(`media download error: ${mediaRes.status}`, { status: 502 })
  }

  return new Response(mediaRes.body, {
    headers: {
      'Content-Type': mediaRes.headers.get('Content-Type') ?? 'application/octet-stream',
      'Content-Length': mediaRes.headers.get('Content-Length') ?? '',
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

    if (path === '/webhook' && request.method === 'GET') {
      return handleVerify(request, env)
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

    const mediaMatch = path.match(/^\/media\/(.+)$/)
    if (mediaMatch && request.method === 'GET') {
      return handleMedia(request, env, mediaMatch[1])
    }

    return new Response('not found', { status: 404 })
  },
}
