import Anthropic from '@anthropic-ai/sdk'
import type { VercelRequest, VercelResponse } from '@vercel/node'

/**
 * The reference tool names claude-sonnet-4-6; ANTHROPIC_MODEL overrides it without a redeploy.
 */
const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6'
const MAX_CHUNKS = 40
const CHUNK_CHARS = 1200

interface IncomingChunk {
  title?: unknown
  type?: unknown
  score?: unknown
  text?: unknown
}

interface IncomingSeries {
  label?: unknown
  chunks?: unknown
}

interface Suggestion {
  type: 'Addition' | 'Structure' | 'Revision'
  text: string
}

interface DeepAnalysis {
  executive_summary: string
  tone_readability: string
  missing_entities: string[]
  suggestions: Suggestion[]
}

const SUGGESTION_TYPES = new Set(['Addition', 'Structure', 'Revision'])

/**
 * Key values that exercise the live path without calling Claude. The request is
 * validated, a Claude-shaped JSON string is produced and then parsed and normalised
 * by exactly the same code the real response goes through - so this covers the
 * plumbing (shape, parsing, rejection of malformed fields, the loading state) while
 * costing nothing. The response is flagged so the UI can label it as not-real.
 */
const MOCK_KEYS = new Set(['test', 'demo', 'mock', 'sk-ant-test'])

const MOCK_STOPWORDS = new Set(
  'a an the and or of in on at to for from by with how what why when where is are do does can i you it'.split(' '),
)

/**
 * Query terms the page barely uses, as "term - n/m passages".
 *
 * The mock fills the entities column with this rather than with placeholder strings:
 * six chips reading "mock entity A..F" told the reader nothing and looked like a bug.
 * This is a real measurement of the submitted passages - it just is not the thing the
 * live column shows, which is entities the page omits entirely and only a model can name.
 */
function underCoveredTerms(query: string, chunks: IncomingChunk[]): string[] {
  const words = (query.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []).filter((word) => !MOCK_STOPWORDS.has(word))
  const unique = [...new Set(words)]
  if (unique.length === 0 || chunks.length === 0) return []

  const bodies = chunks.map((chunk) => asText(chunk.text).toLowerCase())
  return unique
    .map((word) => ({ word, hits: bodies.filter((body) => body.includes(word)).length }))
    .sort((a, b) => a.hits - b.hits)
    .filter((entry) => entry.hits <= Math.max(1, Math.floor(chunks.length * 0.5)))
    .slice(0, 6)
    .map((entry) => `"${entry.word}" — ${entry.hits}/${chunks.length} passages`)
}

function buildMockResponse(query: string, series: IncomingSeries[]): string {
  const chunks = (Array.isArray(series[0]?.chunks) ? (series[0].chunks as IncomingChunk[]) : []).filter(
    (chunk) => typeof chunk.score === 'number',
  )
  const ranked = [...chunks].sort((a, b) => (b.score as number) - (a.score as number))
  const best = asText(ranked[0]?.title, 'the opening passage')
  const worst = asText(ranked[ranked.length - 1]?.title, 'the closing passage')
  const weak = chunks.filter((chunk) => (chunk.score as number) < 65).length
  const thin = underCoveredTerms(query, chunks)

  // deliberately returned as a raw string so the real parser does the work
  return JSON.stringify({
    executive_summary: `Mock analysis for "${query}". The page leans on "${best}", while "${worst}" contributes least to this query. ${weak} of ${chunks.length} passages fall below the retrieval threshold. No model was called to produce this text.`,
    tone_readability:
      'Mock tone assessment. This field exists to prove the three-column layout renders a real Claude response; the live call fills it with an actual reading of your register and sentence length.',
    missing_entities: thin.length > 0 ? thin : ['a real key lists the entities this page omits'],
    suggestions: [
      { type: 'Addition', text: `Mock suggestion: add a passage that answers "${query}" directly, above the fold.` },
      { type: 'Structure', text: `Mock suggestion: move "${best}" nearer the top of the page.` },
      { type: 'Revision', text: `Mock suggestion: rewrite or cut "${worst}", the weakest passage for this query.` },
      { type: 'Addition', text: 'Mock suggestion: cover the adjacent questions a reader asks next.' },
      // an unknown type, to prove normalise() coerces rather than crashes
      { type: 'Nonsense', text: 'Mock suggestion with an invalid type, coerced to Revision by the normaliser.' },
    ],
  })
}

const SYSTEM_PROMPT = `You are a semantic SEO analyst. You are given a target search query and the passages of a web page, each already scored for vector proximity to that query (0-100).

Your job is to explain what the vector map cannot: which entities, facts and sub-topics a retrieval system would expect on a page answering this query but does not find, and what concrete edits would raise the page's retrieval performance.

Rules:
- Be specific to the supplied content. Never give generic SEO advice that would fit any page.
- Refer to passages by their titles when useful.
- Reply with a single JSON object and nothing else - no prose, no markdown fence.

JSON shape:
{
  "executive_summary": "2-4 sentences on how well this page answers the query and where its retrieval weight sits",
  "tone_readability": "2-3 sentences on tone, register and readability for the intended audience",
  "missing_entities": ["6-10 concrete named entities, concepts or facts that are absent"],
  "suggestions": [
    { "type": "Addition" | "Structure" | "Revision", "text": "one specific, actionable instruction" }
  ]
}
Return 4-6 suggestions.`

function asText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function buildPrompt(query: string, context: Record<string, string>, series: IncomingSeries[]): string {
  const lines: string[] = [`TARGET QUERY: ${query}`]
  const contextLines = Object.entries(context)
    .filter(([, value]) => value.trim().length > 0)
    .map(([key, value]) => `- ${key}: ${value}`)
  if (contextLines.length > 0) lines.push('', 'SEMANTIC CONTEXT:', ...contextLines)

  for (const entry of series) {
    const chunks = Array.isArray(entry.chunks) ? (entry.chunks as IncomingChunk[]) : []
    const label = asText(entry.label, 'A')
    lines.push('', series.length > 1 ? `CONTENT ${label} PASSAGES:` : 'PASSAGES:')
    chunks.slice(0, MAX_CHUNKS).forEach((chunk, index) => {
      const score = typeof chunk.score === 'number' ? Math.round(chunk.score) : 0
      lines.push(
        '',
        `[${index + 1}] ${asText(chunk.title, 'Untitled')} (${asText(chunk.type, 'Paragraph')}) - relevance ${score}%`,
        asText(chunk.text).slice(0, CHUNK_CHARS),
      )
    })
  }
  lines.push('', 'Return the JSON object now.')
  return lines.join('\n')
}

/** Models sometimes wrap JSON in prose or a fence; take the outermost object. */
function parseJsonObject(raw: string): unknown {
  const trimmed = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start === -1 || end <= start) return null
    try {
      return JSON.parse(trimmed.slice(start, end + 1)) as unknown
    } catch {
      return null
    }
  }
}

function normalise(payload: unknown): DeepAnalysis | null {
  if (typeof payload !== 'object' || payload === null) return null
  const source = payload as Record<string, unknown>

  const summary = asText(source.executive_summary).trim()
  if (!summary) return null

  const entities = Array.isArray(source.missing_entities)
    ? source.missing_entities.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []

  const suggestions = Array.isArray(source.suggestions)
    ? source.suggestions.flatMap((item): Suggestion[] => {
        if (typeof item !== 'object' || item === null) return []
        const record = item as Record<string, unknown>
        const text = asText(record.text).trim()
        if (!text) return []
        const type = asText(record.type)
        return [{ type: (SUGGESTION_TYPES.has(type) ? type : 'Revision') as Suggestion['type'], text }]
      })
    : []

  return {
    executive_summary: summary,
    tone_readability: asText(source.tone_readability).trim(),
    missing_entities: entities.slice(0, 12),
    suggestions: suggestions.slice(0, 8),
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed.' })
    return
  }

  const body = (req.body ?? {}) as {
    query?: unknown
    context?: unknown
    apiKey?: unknown
    series?: unknown
  }

  const query = asText(body.query).trim()
  if (!query) {
    res.status(400).json({ error: 'Missing the target query.' })
    return
  }
  const series = Array.isArray(body.series) ? (body.series as IncomingSeries[]) : []
  if (series.length === 0) {
    res.status(400).json({ error: 'No scored passages were supplied.' })
    return
  }

  const rawContext = (typeof body.context === 'object' && body.context !== null ? body.context : {}) as Record<
    string,
    unknown
  >
  const context = {
    'Target audience': asText(rawContext.audience),
    'Content purpose': asText(rawContext.purpose),
    'Website niche': asText(rawContext.niche),
  }

  const suppliedKey = asText(body.apiKey).trim()
  if (MOCK_KEYS.has(suppliedKey.toLowerCase())) {
    const analysis = normalise(parseJsonObject(buildMockResponse(query, series)))
    if (!analysis) {
      res.status(500).json({ error: 'The mock response failed its own normalisation.' })
      return
    }
    // a real call is never instant; keep the loading state observable
    await new Promise((resolve) => setTimeout(resolve, 900))
    res.status(200).json({ ...analysis, mock: true })
    return
  }

  const apiKey = suppliedKey || process.env.ANTHROPIC_API_KEY || ''
  if (!apiKey) {
    // the client renders its demo analysis on this exact status
    res.status(501).json({ error: 'No Anthropic API key available for live analysis.' })
    return
  }

  const client = new Anthropic({ apiKey })
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildPrompt(query, context, series) }],
    })

    if (response.stop_reason === 'refusal') {
      res.status(422).json({ error: 'The model declined to analyse this content.' })
      return
    }

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n')

    const analysis = normalise(parseJsonObject(text))
    if (!analysis) {
      res.status(502).json({ error: 'The model replied in an unexpected format. Try running the analysis again.' })
      return
    }

    res.status(200).json(analysis)
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      res.status(401).json({ error: 'That API key was rejected by Anthropic. Check the key and try again.' })
      return
    }
    if (error instanceof Anthropic.RateLimitError) {
      res.status(429).json({ error: 'Anthropic is rate limiting this key. Wait a moment and try again.' })
      return
    }
    if (error instanceof Anthropic.BadRequestError) {
      res.status(400).json({ error: `Anthropic rejected the request: ${error.message}` })
      return
    }
    if (error instanceof Anthropic.APIError) {
      res.status(502).json({ error: `Anthropic API error (${error.status ?? 'unknown'}). Try again shortly.` })
      return
    }
    res.status(500).json({ error: 'The analysis could not be completed. Try again.' })
  }
}
