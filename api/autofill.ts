import Anthropic from '@anthropic-ai/sdk'
import type { VercelRequest, VercelResponse } from '@vercel/node'

const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6'

interface SemanticContext {
  audience: string
  purpose: string
  niche: string
}

const SYSTEM_PROMPT = `You infer the semantic context of a search query for an SEO tool.
Given a target keyword or prompt, reply with a single JSON object and nothing else:
{"audience": "...", "purpose": "...", "niche": "..."}
- audience: who is searching this, in 3-8 words
- purpose: what the content should do for them, in 3-8 words
- niche: the site vertical this belongs to, in 2-5 words
No markdown, no prose.`

const HOW_TO = /^(how|what|why|when|where|can|should|is|are|does|do)\b/i
const COMMERCIAL = /\b(best|top|cheap|price|pricing|buy|vs|versus|review|reviews|compare|deal|deals)\b/i
const LOCAL = /\b(uk|usa|us|london|near me|nyc|canada|australia|europe|india)\b/i

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (character) => character.toUpperCase())
}

/** Template fallback used whenever no Anthropic key is available. */
export function heuristicContext(query: string): SemanticContext {
  const clean = query.trim().replace(/\s+/g, ' ')
  const words = clean.split(' ').filter(Boolean)
  const stopwords = new Set(['how', 'to', 'become', 'a', 'an', 'the', 'in', 'of', 'for', 'best', 'top', 'what', 'is'])
  const region = LOCAL.exec(clean)?.[0] ?? ''
  const core = words.filter(
    (word) => !stopwords.has(word.toLowerCase()) && word.toLowerCase() !== region.toLowerCase(),
  )
  const subject = titleCase((core.slice(-3).join(' ') || clean).toLowerCase())

  const informational = HOW_TO.test(clean)
  const commercial = COMMERCIAL.test(clean)

  const audience = informational
    ? `Readers searching "${clean}", new to the topic`
    : commercial
      ? `Readers searching "${clean}", comparing options before choosing`
      : `Readers searching "${clean}", looking for an authoritative answer`

  const purpose = informational
    ? 'Answer the question end to end and cover the follow-up questions'
    : commercial
      ? 'Help the reader choose, with concrete comparison criteria'
      : 'Explain the topic clearly and establish topical authority'

  const niche = `${subject}${region ? ` (${region.toUpperCase()})` : ''}`

  return { audience, purpose, niche }
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function parseContext(raw: string): SemanticContext | null {
  const trimmed = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>
    const context = {
      audience: asText(parsed.audience).trim(),
      purpose: asText(parsed.purpose).trim(),
      niche: asText(parsed.niche).trim(),
    }
    return context.audience || context.purpose || context.niche ? context : null
  } catch {
    return null
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed.' })
    return
  }

  const body = (req.body ?? {}) as { query?: unknown; apiKey?: unknown }
  const query = asText(body.query).trim()
  if (!query) {
    res.status(400).json({ error: 'Enter a target keyword first.' })
    return
  }

  const apiKey = asText(body.apiKey).trim() || process.env.ANTHROPIC_API_KEY || ''
  if (!apiKey) {
    res.status(200).json(heuristicContext(query))
    return
  }

  try {
    const client = new Anthropic({ apiKey })
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: query }],
    })
    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
    res.status(200).json(parseContext(text) ?? heuristicContext(query))
  } catch {
    // the heuristics are a perfectly good answer - never fail the form over this
    res.status(200).json(heuristicContext(query))
  }
}
