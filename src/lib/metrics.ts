import type { Metrics, ScoredChunk } from './types.ts'
import { THRESHOLDS } from './types.ts'

function mean(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0
  const avg = mean(values)
  const variance = mean(values.map((value) => (value - avg) ** 2))
  return Math.sqrt(variance)
}

/**
 * Overall Cohesion, 0-100: how tightly the page as a whole sits around the query.
 * Average relevance, penalised for spread - a page that alternates between 90%
 * and 20% passages retrieves worse than an even page with the same average.
 */
export function cohesionScore(scores: number[]): number {
  if (scores.length === 0) return 0
  const penalty = 0.75 * stdDev(scores)
  return Math.round(Math.max(0, Math.min(100, mean(scores) - penalty)))
}

export function computeMetrics(chunks: ScoredChunk[]): Metrics {
  const scores = chunks.map((chunk) => chunk.score)
  return {
    avgRelevance: Math.round(mean(scores) * 10) / 10,
    cohesion: cohesionScore(scores),
    optimizationNeeded: chunks.filter((chunk) => chunk.score < THRESHOLDS.highlyRelevant).length,
    chunkCount: chunks.length,
  }
}
