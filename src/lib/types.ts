export type ChunkType = 'Paragraph' | 'H2' | 'H3'

export interface Chunk {
  id: string
  index: number
  title: string
  type: ChunkType
  text: string
  wordCount: number
}

export interface ScoredChunk extends Chunk {
  /** 0..100 */
  score: number
  category: Category
}

export type Category = 'highly-relevant' | 'broad-match' | 'semantic-noise'

export type VectorAlgorithm = 'lexical' | 'embedding'

export interface Metrics {
  avgRelevance: number
  cohesion: number
  optimizationNeeded: number
  chunkCount: number
}

export interface SemanticContext {
  audience: string
  purpose: string
  niche: string
}

export interface AnalysisSeries {
  /** 'A' for single-content runs, 'A' | 'B' in compare mode */
  label: 'A' | 'B'
  name: string
  chunks: ScoredChunk[]
  metrics: Metrics
}

export interface AnalysisResult {
  query: string
  algorithm: VectorAlgorithm
  /** algorithm actually used — may fall back to lexical if embeddings are unavailable */
  effectiveAlgorithm: VectorAlgorithm
  fallbackNotice?: string
  context: SemanticContext
  series: AnalysisSeries[]
  compare: boolean
  createdAt: number
}

export interface Suggestion {
  type: 'Addition' | 'Structure' | 'Revision'
  text: string
}

export interface DeepAnalysis {
  /** set by /api/analyze when a test key produced the result instead of Claude */
  mock?: boolean
  executive_summary: string
  tone_readability: string
  missing_entities: string[]
  suggestions: Suggestion[]
}

export const CATEGORY_META: Record<Category, { label: string; color: string; text: string; bg: string; ring: string }> = {
  'highly-relevant': {
    label: 'Highly Relevant',
    color: '#22c55e',
    text: 'text-emerald-300',
    bg: 'bg-emerald-500/10',
    ring: 'ring-emerald-500/30',
  },
  'broad-match': {
    label: 'Broad Match',
    color: '#eab308',
    text: 'text-amber-300',
    bg: 'bg-amber-500/10',
    ring: 'ring-amber-500/30',
  },
  'semantic-noise': {
    label: 'Semantic Noise',
    color: '#ef4444',
    text: 'text-rose-300',
    bg: 'bg-rose-500/10',
    ring: 'ring-rose-500/30',
  },
}

export const THRESHOLDS = { highlyRelevant: 65, broadMatch: 43 } as const

export function categorize(score: number): Category {
  if (score >= THRESHOLDS.highlyRelevant) return 'highly-relevant'
  if (score >= THRESHOLDS.broadMatch) return 'broad-match'
  return 'semantic-noise'
}
