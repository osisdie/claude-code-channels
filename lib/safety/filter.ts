/**
 * Content filter — pre-screens user input before sending to Claude.
 *
 * Three outcomes:
 *   block — reject silently with generic message (don't reveal reason)
 *   warn  — log and allow through (for monitoring)
 *   allow — pass through
 */

export interface FilterResult {
  action: 'allow' | 'warn' | 'block'
  reason?: string
}

// ── Block patterns (reject before reaching Claude) ─────────

const BLOCK_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  // Credential leakage — user pasting secrets into chat
  { pattern: /\bsk-[a-zA-Z0-9]{20,}/, reason: 'credential: OpenAI key' },
  { pattern: /\bxoxb-[0-9]+-[a-zA-Z0-9]+/, reason: 'credential: Slack token' },
  { pattern: /\bxoxp-[0-9]+-[a-zA-Z0-9]+/, reason: 'credential: Slack user token' },
  { pattern: /\bghp_[a-zA-Z0-9]{36,}/, reason: 'credential: GitHub PAT' },
  { pattern: /\bglpat-[a-zA-Z0-9-]{20,}/, reason: 'credential: GitLab PAT' },
  { pattern: /\bAIza[a-zA-Z0-9_-]{35,}/, reason: 'credential: Google API key' },
  { pattern: /-----BEGIN (RSA |EC )?PRIVATE KEY-----/, reason: 'credential: private key' },

  // Known jailbreak patterns
  { pattern: /\bignore (all )?(previous|prior|above) (instructions|prompts|rules)\b/i, reason: 'jailbreak: ignore instructions' },
  { pattern: /\byou are (now )?DAN\b/i, reason: 'jailbreak: DAN' },
  { pattern: /\bact as (?:an? )?(?:evil|malicious|unfiltered|uncensored)\b/i, reason: 'jailbreak: persona override' },
  { pattern: /\bdeveloper mode\b.*\benabled\b/i, reason: 'jailbreak: developer mode' },
]

// ── Warn patterns (log but allow) ──────────────────────────

const WARN_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bsystem prompt\b/i, reason: 'probe: system prompt reference' },
  { pattern: /\byour instructions\b/i, reason: 'probe: instruction reference' },
  { pattern: /\brepeat .*\b(instructions|prompt|rules)\b/i, reason: 'probe: repeat instructions' },
  { pattern: /\brm -rf\b/, reason: 'dangerous: rm -rf' },
  { pattern: /\bformat c:\b/i, reason: 'dangerous: format disk' },
  { pattern: /\b(sudo|chmod 777)\b/, reason: 'dangerous: elevated permissions' },
]

// ── Max message length ─────────────────────────────────────

const MAX_MESSAGE_LENGTH = parseInt(process.env.MAX_MESSAGE_LENGTH ?? '10000', 10)

// ── Filter function ────────────────────────────────────────

export function contentFilter(text: string): FilterResult {
  // Length check — extremely long messages are likely injection payloads
  if (text.length > MAX_MESSAGE_LENGTH) {
    return { action: 'block', reason: `message too long: ${text.length} chars (max ${MAX_MESSAGE_LENGTH})` }
  }

  // Block patterns
  for (const { pattern, reason } of BLOCK_PATTERNS) {
    if (pattern.test(text)) {
      return { action: 'block', reason }
    }
  }

  // Warn patterns
  for (const { pattern, reason } of WARN_PATTERNS) {
    if (pattern.test(text)) {
      return { action: 'warn', reason }
    }
  }

  return { action: 'allow' }
}

/** Generic block response — intentionally vague to not leak filter details. */
export const BLOCK_RESPONSE = "I can't process this message. Please rephrase your request."
