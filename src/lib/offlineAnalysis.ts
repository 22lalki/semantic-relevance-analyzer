import { extractTerms, stem, tokenize } from './scorer.ts'
import type { AnalysisResult, AnalysisSeries, DeepAnalysis, ScoredChunk, Suggestion } from './types.ts'
import { THRESHOLDS } from './types.ts'

/**
 * The analysis shown when no Anthropic key is available.
 *
 * It is computed from this run's own passages and scores rather than being a
 * canned example, so it is always about the content actually on screen. It is
 * plainly weaker than the Claude analysis - it can measure coverage and shape,
 * but it cannot name an entity the page never mentions - and the UI says so.
 */

const MAX_CHIPS = 8
/** fetched pages often carry very long, shouty headings - keep them pill-sized */
const MAX_TITLE = 42

function shortTitle(title: string): string {
  const clean = title.replace(/\s+/g, ' ').trim()
  const cased = clean.length > 12 && clean === clean.toUpperCase() ? toSentenceCase(clean) : clean
  return cased.length > MAX_TITLE ? `${cased.slice(0, MAX_TITLE - 1).trimEnd()}…` : cased
}

/** ALL-CAPS headings are shouting in a UI that is not; normalise them for display only. */
function toSentenceCase(value: string): string {
  const lowered = value.toLocaleLowerCase()
  return lowered.charAt(0).toLocaleUpperCase() + lowered.slice(1)
}

function sentenceStats(chunks: ScoredChunk[]): { wordsPerSentence: number; longest: ScoredChunk | null } {
  let sentences = 0
  let words = 0
  let longest: ScoredChunk | null = null
  for (const chunk of chunks) {
    sentences += (chunk.text.match(/[.!?]+(?:\s|$)/g) ?? []).length || 1
    words += chunk.wordCount
    if (!longest || chunk.wordCount > longest.wordCount) longest = chunk
  }
  return { wordsPerSentence: sentences > 0 ? Math.round(words / sentences) : 0, longest }
}

/** How many passages each meaningful query word actually appears in. */
function queryCoverage(query: string, chunks: ScoredChunk[]): { word: string; hits: number }[] {
  const seen = new Set<string>()
  const queryWords: { word: string; stemmed: string }[] = []
  for (const token of tokenize(query)) {
    const stemmed = stem(token)
    if (!extractTerms(token).words.includes(stemmed) || seen.has(stemmed)) continue
    seen.add(stemmed)
    queryWords.push({ word: token, stemmed })
  }

  const chunkStems = chunks.map((chunk) => new Set(extractTerms(chunk.text).words))
  return queryWords
    .map(({ word, stemmed }) => ({
      word,
      hits: chunkStems.filter((set) => set.has(stemmed)).length,
    }))
    .sort((a, b) => a.hits - b.hits)
}

function describeSpread(series: AnalysisSeries): string {
  const gap = series.metrics.avgRelevance - series.metrics.cohesion
  if (gap >= 20) return 'the page swings hard between on-topic and off-topic passages'
  if (gap >= 10) return 'relevance is uneven across the page'
  return 'relevance is spread evenly across the page'
}

export function buildOfflineAnalysis(result: AnalysisResult): DeepAnalysis {
  const series = result.series[0]
  const chunks = series.chunks
  const sorted = [...chunks].sort((a, b) => b.score - a.score)
  const best = sorted[0]
  const worst = sorted[sorted.length - 1]
  const { wordsPerSentence, longest } = sentenceStats(chunks)
  const coverage = queryCoverage(result.query, chunks)
  const uncovered = coverage.filter((entry) => entry.hits === 0)
  const thin = coverage.filter((entry) => entry.hits > 0 && entry.hits <= Math.max(1, Math.floor(chunks.length * 0.3)))

  const executive = [
    `Against "${result.query}" this ${result.compare ? 'content set' : 'page'} averages ${series.metrics.avgRelevance.toFixed(
      0,
    )}% across ${chunks.length} passages, with an overall cohesion of ${series.metrics.cohesion} — ${describeSpread(series)}.`,
    best && worst && best.id !== worst.id
      ? `"${shortTitle(best.title)}" carries the page at ${best.score.toFixed(0)}%, while "${shortTitle(worst.title)}" trails at ${worst.score.toFixed(0)}%.`
      : '',
    series.metrics.optimizationNeeded > 0
      ? `${series.metrics.optimizationNeeded} of ${chunks.length} passages sit below the ${THRESHOLDS.highlyRelevant}% retrieval threshold, so a retriever has ${
          chunks.length - series.metrics.optimizationNeeded
        } passage${chunks.length - series.metrics.optimizationNeeded === 1 ? '' : 's'} worth surfacing for this query.`
      : 'Every passage clears the retrieval threshold for this query.',
  ]
    .filter(Boolean)
    .join(' ')

  const density = wordsPerSentence >= 28 ? 'dense' : wordsPerSentence >= 20 ? 'moderately dense' : 'easy to scan'
  const tone = [
    `Passages average ${Math.round(chunks.reduce((sum, chunk) => sum + chunk.wordCount, 0) / Math.max(1, chunks.length))} words with roughly ${wordsPerSentence} words per sentence, which reads as ${density}.`,
    longest && longest.wordCount > 350
      ? `"${shortTitle(longest.title)}" is the longest at ${longest.wordCount} words and would retrieve better split in two.`
      : `Passage lengths are in the range a retriever indexes comfortably.`,
    result.context.audience ? `Written for: ${result.context.audience}.` : '',
  ]
    .filter(Boolean)
    .join(' ')

  const chips = [
    ...uncovered.map((entry) => `"${entry.word}" — never used`),
    ...thin.map((entry) => `"${entry.word}" — only ${entry.hits}/${chunks.length} passages`),
    ...chunks
      .filter((chunk) => chunk.score < THRESHOLDS.broadMatch)
      .slice(0, 3)
      .map((chunk) => `off-query: ${shortTitle(chunk.title)}`),
  ].slice(0, MAX_CHIPS)

  const suggestions: Suggestion[] = []
  if (worst && worst.score < THRESHOLDS.broadMatch) {
    suggestions.push({
      type: 'Revision',
      text: `"${shortTitle(worst.title)}" scores ${worst.score.toFixed(0)}% — the weakest passage on the page. Rewrite it around the query or move it to its own page; as it stands it drags overall cohesion down.`,
    })
  }
  if (uncovered.length > 0) {
    suggestions.push({
      type: 'Addition',
      text: `The content never uses ${uncovered.map((entry) => `"${entry.word}"`).join(', ')}, though ${
        uncovered.length === 1 ? 'it is' : 'they are'
      } part of the target query. Add a passage that answers that part directly.`,
    })
  }
  if (best && best.index > 1) {
    suggestions.push({
      type: 'Structure',
      text: `Your strongest passage, "${shortTitle(best.title)}" (${best.score.toFixed(0)}%), sits at position ${
        best.index + 1
      }. Move it near the top so the first indexed passage is the one that answers the query.`,
    })
  }
  if (longest && longest.wordCount > 350) {
    suggestions.push({
      type: 'Structure',
      text: `Split "${shortTitle(longest.title)}" (${longest.wordCount} words) into two passages with their own headings. Long blocks dilute the signal of the sentence that actually answers the query.`,
    })
  }
  if (series.metrics.optimizationNeeded > chunks.length / 2) {
    suggestions.push({
      type: 'Addition',
      text: `${series.metrics.optimizationNeeded} of ${chunks.length} passages are below ${THRESHOLDS.highlyRelevant}%. The page reads as broadly about the topic rather than as an answer to this specific query — add a direct answer near the top and tie each section back to it.`,
    })
  }
  if (thin.length > 0) {
    suggestions.push({
      type: 'Revision',
      text: `${thin
        .map((entry) => `"${entry.word}" appears in only ${entry.hits} of ${chunks.length} passages`)
        .join('; ')}. Work the term naturally into the sections where it belongs.`,
    })
  }
  if (suggestions.length === 0) {
    suggestions.push({
      type: 'Structure',
      text: 'Every passage clears the threshold and coverage is even. Next lever is depth: add the adjacent questions a reader would ask after this one.',
    })
  }

  return {
    executive_summary: executive,
    tone_readability: tone,
    missing_entities: chips,
    suggestions: suggestions.slice(0, 6),
  }
}
