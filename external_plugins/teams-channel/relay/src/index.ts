/**
 * Microsoft Teams Relay — Cloudflare Worker
 *
 * Receives Teams bot activities via Azure Bot Service, queues them in KV,
 * and serves them to a local bridge that runs Claude. Replies via Bot
 * Connector REST API.
 *
 * Endpoints:
 *   POST /api/messages  — Azure Bot Service sends activities here
 *   GET  /messages      — Local bridge polls queued activities
 *   DELETE /messages    — Ack consumed activities
 *   POST /reply         — Local bridge sends Claude's response
 *   GET  /health        — Health check
 */

interface Env {
  TEAMS_QUEUE: KVNamespace
  MICROSOFT_APP_ID: string
  MICROSOFT_APP_PASSWORD: string
  RELAY_SECRET: string
}

interface QueuedActivity {
  id: string
  activityId: string
  conversationId: string
  serviceUrl: string
  userId: string
  userName?: string
  text?: string
  type: string              // message, messageReaction, etc.
  isGroup: boolean
  tenantId?: string
  attachments?: Array<{
    contentType: string
    contentUrl?: string
    name?: string
  }>
  timestamp: number
  enqueuedAt: number
}

// Cached bot framework auth token
let cachedToken: { token: string; expiresAt: number } | null = null

// Cached JWKS keys for JWT validation
let cachedJwks: { keys: any[]; fetchedAt: number } | null = null
const JWKS_CACHE_TTL = 3600 * 1000 // 1 hour

// ── Helpers ────────────────────────────────────────────────

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

// ── JWT Validation ─────────────────────────────────────────

async function fetchJwks(): Promise<any[]> {
  if (cachedJwks && Date.now() - cachedJwks.fetchedAt < JWKS_CACHE_TTL) {
    return cachedJwks.keys
  }

  // Fetch OpenID config to get JWKS URI
  const openIdRes = await fetch('https://login.botframework.com/v1/.well-known/openidconfiguration')
  const openIdConfig: any = await openIdRes.json()
  const jwksUri = openIdConfig.jwks_uri

  const jwksRes = await fetch(jwksUri)
  const jwks: any = await jwksRes.json()

  cachedJwks = { keys: jwks.keys ?? [], fetchedAt: Date.now() }
  return cachedJwks.keys
}

function base64UrlDecode(str: string): Uint8Array {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - base64.length % 4) % 4)
  const binary = atob(padded)
  return new Uint8Array([...binary].map(c => c.charCodeAt(0)))
}

async function validateJwt(token: string, appId: string): Promise<boolean> {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return false

    const headerJson = new TextDecoder().decode(base64UrlDecode(parts[0]))
    const payloadJson = new TextDecoder().decode(base64UrlDecode(parts[1]))

    const header: any = JSON.parse(headerJson)
    const payload: any = JSON.parse(payloadJson)

    // Check expiry
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      console.log('[jwt] token expired')
      return false
    }

    // Check audience matches our app ID
    if (payload.aud !== appId) {
      console.log(`[jwt] audience mismatch: ${payload.aud} !== ${appId}`)
      return false
    }

    // Check issuer
    const validIssuers = [
      'https://api.botframework.com',
      'https://sts.windows.net/d6d49420-f39b-4df7-a1dc-d59a935871db/',
      'https://login.microsoftonline.com/d6d49420-f39b-4df7-a1dc-d59a935871db/v2.0',
    ]
    if (!validIssuers.some(iss => payload.iss?.startsWith(iss.split('/')[0] + '//' + iss.split('/')[2]))) {
      // Be lenient: accept any Microsoft-issued token for now
      if (!payload.iss?.includes('microsoft') && !payload.iss?.includes('botframework') && !payload.iss?.includes('windows.net')) {
        console.log(`[jwt] unknown issuer: ${payload.iss}`)
        return false
      }
    }

    // Verify signature with JWKS
    const jwks = await fetchJwks()
    const kid = header.kid
    const jwk = jwks.find((k: any) => k.kid === kid)
    if (!jwk) {
      console.log(`[jwt] key ${kid} not found in JWKS`)
      return false
    }

    const cryptoKey = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    )

    const signatureBytes = base64UrlDecode(parts[2])
    const dataBytes = new TextEncoder().encode(`${parts[0]}.${parts[1]}`)

    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      cryptoKey,
      signatureBytes,
      dataBytes,
    )

    return valid
  } catch (e) {
    console.log(`[jwt] validation error: ${e}`)
    return false
  }
}

// ── Bot Framework Auth Token ───────────────────────────────

async function getBotToken(env: Env): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60000) {
    return cachedToken.token
  }

  const res = await fetch('https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env.MICROSOFT_APP_ID,
      client_secret: env.MICROSOFT_APP_PASSWORD,
      scope: 'https://api.botframework.com/.default',
    }),
  })

  if (!res.ok) {
    throw new Error(`token request failed: ${res.status}`)
  }

  const data: any = await res.json()
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  }
  return cachedToken.token
}

// ── Strip @mention tags ────────────────────────────────────

function stripMentions(text: string): string {
  return text.replace(/<at>[^<]*<\/at>\s*/g, '').trim()
}

// ── Handle Bot Activity (POST /api/messages) ───────────────

async function handleActivity(request: Request, env: Env): Promise<Response> {
  // Validate JWT from Azure Bot Service
  const authHeader = request.headers.get('Authorization') ?? ''
  const jwtToken = authHeader.replace('Bearer ', '')

  if (!jwtToken || !await validateJwt(jwtToken, env.MICROSOFT_APP_ID)) {
    console.log('[activity] JWT validation failed')
    return new Response('unauthorized', { status: 401 })
  }

  let activity: any
  try {
    activity = await request.json()
  } catch {
    return new Response('invalid json', { status: 400 })
  }

  // Only process message activities
  if (activity.type !== 'message') {
    console.log(`[activity] skipping type: ${activity.type}`)
    return new Response('ok')
  }

  const now = Date.now()
  const text = stripMentions(activity.text ?? '')
  const isGroup = activity.conversation?.conversationType === 'groupChat'
    || activity.conversation?.conversationType === 'channel'

  const msg: QueuedActivity = {
    id: `msg:${String(now).padStart(15, '0')}:${crypto.randomUUID().slice(0, 8)}`,
    activityId: activity.id ?? '',
    conversationId: activity.conversation?.id ?? '',
    serviceUrl: activity.serviceUrl ?? '',
    userId: activity.from?.aadObjectId ?? activity.from?.id ?? '',
    userName: activity.from?.name,
    text: text || undefined,
    type: activity.type,
    isGroup,
    tenantId: activity.conversation?.tenantId ?? activity.channelData?.tenant?.id,
    attachments: (activity.attachments ?? []).map((a: any) => ({
      contentType: a.contentType,
      contentUrl: a.contentUrl,
      name: a.name,
    })),
    timestamp: activity.timestamp ? new Date(activity.timestamp).getTime() : now,
    enqueuedAt: now,
  }

  await env.TEAMS_QUEUE.put(msg.id, JSON.stringify(msg), { expirationTtl: 3600 })
  console.log(`[activity] queued ${msg.id}: from ${msg.userName ?? msg.userId}${isGroup ? ' (group)' : ''}`)

  return new Response('ok')
}

// ── Poll Messages (GET /messages) ─────────────────────────

async function handleGetMessages(request: Request, env: Env): Promise<Response> {
  const authErr = checkAuth(request, env)
  if (authErr) return authErr

  const keys = await env.TEAMS_QUEUE.list({ prefix: 'msg:' })
  const messages: QueuedActivity[] = []

  for (const key of keys.keys) {
    const val = await env.TEAMS_QUEUE.get(key.name)
    if (val) {
      try { messages.push(JSON.parse(val)) } catch {}
    }
  }

  if (messages.length > 0) {
    console.log(`[messages] returning ${messages.length} queued activity/ies`)
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
    await env.TEAMS_QUEUE.delete(key)
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

  const { serviceUrl, conversationId, text } = body
  if (!serviceUrl || !conversationId || !text) {
    return json({ ok: false, error: 'serviceUrl, conversationId, and text required' }, 400)
  }

  const token = await getBotToken(env)

  // Teams supports markdown, but chunk long responses
  const chunks: string[] = []
  let rest = text as string
  while (rest.length > 10000) {
    const cut = rest.lastIndexOf('\n', 10000)
    const pos = cut > 2000 ? cut : 10000
    chunks.push(rest.slice(0, pos))
    rest = rest.slice(pos).replace(/^\n+/, '')
  }
  if (rest) chunks.push(rest)

  // Normalize serviceUrl (remove trailing slash)
  const svcUrl = serviceUrl.replace(/\/$/, '')

  for (const chunk of chunks) {
    const res = await fetch(
      `${svcUrl}/v3/conversations/${encodeURIComponent(conversationId)}/activities`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          type: 'message',
          text: chunk,
          textFormat: 'markdown',
        }),
      },
    )

    if (!res.ok) {
      const err = await res.text()
      return json({ ok: false, error: err }, 502)
    }
  }

  return json({ ok: true, chunks: chunks.length })
}

// ── Router ─────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    if (path === '/health' || path === '/') {
      return new Response('ok')
    }

    if (path === '/api/messages' && request.method === 'POST') {
      return handleActivity(request, env)
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

    return new Response('not found', { status: 404 })
  },
}
