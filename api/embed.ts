import type { VercelRequest, VercelResponse } from '@vercel/node'

const MAX_TEXTS = 120
const MAX_CHARS = 8000
const TIMEOUT_MS = 45_000

interface EmbeddingResponse {
  data?: { embedding?: number[]; index?: number }[]
  error?: { message?: string }
}

/**
 * Real embeddings, OpenAI-compatible (`POST {base}/embeddings`). Works with OpenAI,
 * Voyage, Mistral, Together, a local text-embeddings-inference server - anything that
 * speaks the same shape. Configured server-side with EMBEDDINGS_API_URL / _KEY / _MODEL,
 * or per-request with a key the user pastes into the form.
 *
 * Anthropic does not serve an embeddings endpoint, so an `sk-ant-` key cannot drive this
 * mode; the client falls back to lexical scoring and says so in the UI.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed.' })
    return
  }

  const body = (req.body ?? {}) as { texts?: unknown; apiKey?: unknown }
  const texts = Array.isArray(body.texts) ? body.texts.filter((item): item is string => typeof item === 'string') : []
  if (texts.length === 0) {
    res.status(400).json({ error: 'No texts to embed.' })
    return
  }
  if (texts.length > MAX_TEXTS) {
    res.status(413).json({ error: `Too many passages for one embedding call (${texts.length} > ${MAX_TEXTS}).` })
    return
  }

  const userKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''
  if (userKey.startsWith('sk-ant-')) {
    res.status(501).json({
      error: 'Anthropic keys do not cover embeddings. Set EMBEDDINGS_API_URL and EMBEDDINGS_API_KEY to enable this mode.',
    })
    return
  }

  const envKey = process.env.EMBEDDINGS_API_KEY ?? ''
  const key = userKey || envKey
  const base = (process.env.EMBEDDINGS_API_URL ?? 'https://api.openai.com/v1').replace(/\/+$/, '')
  const model = process.env.EMBEDDINGS_MODEL ?? 'text-embedding-3-small'

  if (!key) {
    res.status(501).json({
      error:
        'Embedding mode is not configured. Set EMBEDDINGS_API_KEY (and optionally EMBEDDINGS_API_URL / EMBEDDINGS_MODEL), or paste an OpenAI-compatible key into the form.',
    })
    return
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(`${base}/embeddings`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, input: texts.map((text) => text.slice(0, MAX_CHARS)) }),
    })

    const payload = (await response.json().catch(() => ({}))) as EmbeddingResponse
    if (!response.ok) {
      const detail = payload.error?.message ?? `${response.status} ${response.statusText}`
      res.status(502).json({ error: `The embedding service rejected the request: ${detail}` })
      return
    }

    const rows = payload.data ?? []
    const vectors = rows
      .slice()
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map((row) => row.embedding ?? [])
    if (vectors.length !== texts.length || vectors.some((vector) => vector.length === 0)) {
      res.status(502).json({ error: 'The embedding service returned an incomplete response.' })
      return
    }

    res.status(200).json({ vectors, model })
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError'
    res.status(504).json({
      error: aborted ? 'The embedding service timed out.' : 'Could not reach the embedding service.',
    })
  } finally {
    clearTimeout(timer)
  }
}
