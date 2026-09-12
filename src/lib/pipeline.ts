import { chunkContent } from './chunker.ts'
import { computeMetrics } from './metrics.ts'
import { attachScores, scoreFromEmbeddings, scoreLexical } from './scorer.ts'
import { embedTexts } from './api.ts'
import type { AnalysisResult, AnalysisSeries, Chunk, SemanticContext, VectorAlgorithm } from './types.ts'

export type ProgressStep = 'fetch' | 'chunk' | 'score' | 'map'

export interface PipelineInput {
  query: string
  algorithm: VectorAlgorithm
  context: SemanticContext
  apiKey?: string
  /** one entry for a single run, two for compare mode */
  contents: { label: 'A' | 'B'; name: string; text: string }[]
}

export interface PipelineOptions {
  onStep?: (step: ProgressStep) => void
}

async function scoreAll(
  query: string,
  groups: Chunk[][],
  algorithm: VectorAlgorithm,
  apiKey?: string,
): Promise<{ scores: number[][]; effective: VectorAlgorithm; notice?: string }> {
  if (algorithm === 'embedding') {
    const flat = groups.flat()
    try {
      const { vectors } = await embedTexts([query, ...flat.map((chunk) => chunk.text)], apiKey)
      if (!Array.isArray(vectors) || vectors.length !== flat.length + 1) {
        throw new Error('The embedding service returned an unexpected number of vectors.')
      }
      const [queryVector, ...chunkVectors] = vectors
      const allScores = scoreFromEmbeddings(queryVector, chunkVectors)
      let cursor = 0
      const scores = groups.map((group) => {
        const slice = allScores.slice(cursor, cursor + group.length)
        cursor += group.length
        return slice
      })
      return { scores, effective: 'embedding' }
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Embeddings are unavailable.'
      return {
        scores: groups.map((group) => scoreLexical(query, group)),
        effective: 'lexical',
        notice: `${reason} Fell back to Fast Mapping (lexical).`,
      }
    }
  }
  return { scores: groups.map((group) => scoreLexical(query, group)), effective: 'lexical' }
}

export async function runAnalysis(input: PipelineInput, options: PipelineOptions = {}): Promise<AnalysisResult> {
  const { onStep } = options

  onStep?.('chunk')
  const groups = input.contents.map((content) => chunkContent(content.text))
  if (groups.every((group) => group.length === 0)) {
    throw new Error('No readable passages were found in the content.')
  }

  onStep?.('score')
  const { scores, effective, notice } = await scoreAll(input.query, groups, input.algorithm, input.apiKey)

  onStep?.('map')
  const series: AnalysisSeries[] = input.contents.map((content, index) => {
    const scored = attachScores(groups[index], scores[index])
    return { label: content.label, name: content.name, chunks: scored, metrics: computeMetrics(scored) }
  })

  return {
    query: input.query.trim(),
    algorithm: input.algorithm,
    effectiveAlgorithm: effective,
    fallbackNotice: notice,
    context: input.context,
    series,
    compare: input.contents.length > 1,
    createdAt: Date.now(),
  }
}

/** "Content A wins retrieval: avg 61% vs 48%" */
export function compareVerdict(result: AnalysisResult): string | null {
  if (!result.compare || result.series.length < 2) return null
  const [a, b] = result.series
  const delta = a.metrics.avgRelevance - b.metrics.avgRelevance
  const format = (value: number) => `${Math.round(value)}%`
  if (Math.abs(delta) < 1.5) {
    return `Too close to call: both sets average ${format(a.metrics.avgRelevance)} against this query.`
  }
  const winner = delta > 0 ? a : b
  const loser = delta > 0 ? b : a
  return `Content ${winner.label} wins retrieval: avg ${format(winner.metrics.avgRelevance)} vs ${format(
    loser.metrics.avgRelevance,
  )}`
}
