import type { DeepAnalysis, ScoredChunk, SemanticContext } from './types.ts'

export class ApiError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new ApiError('Could not reach the analysis server. Check your connection and try again.', 0)
  }

  const raw = await response.text()
  let payload: unknown
  try {
    payload = raw ? (JSON.parse(raw) as unknown) : {}
  } catch {
    throw new ApiError(
      response.ok ? 'The server returned an unreadable response.' : `Request failed (${response.status}).`,
      response.status,
    )
  }

  if (!response.ok) {
    const message =
      typeof payload === 'object' && payload !== null && typeof (payload as { error?: unknown }).error === 'string'
        ? (payload as { error: string }).error
        : `Request failed (${response.status}).`
    throw new ApiError(message, response.status)
  }
  return payload as T
}

export interface FetchedPage {
  title: string
  text: string
  chars: number
  url: string
}

export function fetchPage(url: string): Promise<FetchedPage> {
  return postJson<FetchedPage>('/api/fetch-url', { url })
}

export interface EmbedResponse {
  vectors: number[][]
  model: string
}

export function embedTexts(texts: string[], apiKey?: string): Promise<EmbedResponse> {
  return postJson<EmbedResponse>('/api/embed', { texts, apiKey: apiKey || undefined })
}

export interface AnalyzeRequest {
  query: string
  context: SemanticContext
  apiKey?: string
  series: { label: string; chunks: Pick<ScoredChunk, 'title' | 'type' | 'score' | 'text'>[] }[]
}

export function analyzeContent(request: AnalyzeRequest): Promise<DeepAnalysis> {
  return postJson<DeepAnalysis>('/api/analyze', request)
}

export function autofillContext(query: string, apiKey?: string): Promise<SemanticContext> {
  return postJson<SemanticContext>('/api/autofill', { query, apiKey: apiKey || undefined })
}
