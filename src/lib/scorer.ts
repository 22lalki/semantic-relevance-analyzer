import type { Chunk, ScoredChunk } from './types.ts'
import { categorize } from './types.ts'

const STOPWORDS = new Set(
  `a an the and or but if then than that this these those of in on at to for from by with without about into over under
   is are was were be been being am do does did doing have has had having i you he she it we they them his her its our
   your their as not no nor so such can could should would may might must will shall there here what which who whom when
   where why how all any both each few more most other some only own same too very just also`
    .split(/\s+/)
    .filter(Boolean),
)

export function tokenize(text: string): string[] {
  const lowered = text.toLowerCase().replace(/['’]/g, '')
  const matches = lowered.match(/[\p{L}\p{N}]+/gu) ?? []
  return matches.filter((token) => token.length > 1)
}

/** Longer stems are folded to this many characters so morphological families collide. */
const STEM_FOLD = 6

/**
 * Cheap English stemmer plus prefix folding, so that "accountant", "accountancy"
 * and "accounting" all land on the same term. Crude, but a lexical scorer is
 * useless if a passage about accountancy looks unrelated to the word accountant.
 */
export function stem(token: string): string {
  let out = token
  if (out.length > 4 && out.endsWith('ies')) out = `${out.slice(0, -3)}y`
  else if (out.length > 4 && out.endsWith('sses')) out = out.slice(0, -2)
  else if (out.length > 3 && out.endsWith('s') && !out.endsWith('ss') && !out.endsWith('us')) out = out.slice(0, -1)
  if (out.length > 5 && out.endsWith('ing')) out = out.slice(0, -3)
  else if (out.length > 4 && out.endsWith('ed')) out = out.slice(0, -2)
  if (out.length > 4 && out.endsWith('e')) out = out.slice(0, -1)
  return out.length > STEM_FOLD ? out.slice(0, STEM_FOLD) : out
}

export interface Terms {
  /** stemmed content words, stopwords removed, in order */
  words: string[]
  /** stemmed adjacent pairs of the original (stopword-bearing) token stream */
  bigrams: string[]
}

export function extractTerms(text: string): Terms {
  const tokens = tokenize(text)
  const words: string[] = []
  for (const token of tokens) {
    if (STOPWORDS.has(token)) continue
    words.push(stem(token))
  }
  const stemmedAll = tokens.map(stem)
  const bigrams: string[] = []
  for (let i = 0; i + 1 < stemmedAll.length; i += 1) {
    if (STOPWORDS.has(tokens[i]) && STOPWORDS.has(tokens[i + 1])) continue
    bigrams.push(`${stemmedAll[i]}_${stemmedAll[i + 1]}`)
  }
  return { words, bigrams }
}

function counts(terms: string[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const term of terms) map.set(term, (map.get(term) ?? 0) + 1)
  return map
}

function idfTable(documents: Map<string, number>[]): Map<string, number> {
  const total = documents.length
  const df = new Map<string, number>()
  for (const doc of documents) for (const term of doc.keys()) df.set(term, (df.get(term) ?? 0) + 1)
  const idf = new Map<string, number>()
  for (const [term, frequency] of df) {
    // Rarity within one page, not across a web corpus: a term that appears in every passage
    // IS the topic here, so the weight is floored rather than driven to zero.
    idf.set(term, Math.max(0.6, 1 + Math.log(total / Math.max(1, frequency))))
  }
  return idf
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  const length = Math.min(a.length, b.length)
  for (let i = 0; i < length; i += 1) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

const BM25_K = 1.35
const BM25_B = 0.6

/** idf-weighted, length-normalised share of the query's terms that a passage actually covers */
function coverage(
  queryCounts: Map<string, number>,
  chunkCounts: Map<string, number>,
  idf: Map<string, number>,
  length: number,
  avgLength: number,
): number {
  let hit = 0
  let total = 0
  for (const term of queryCounts.keys()) {
    const weight = idf.get(term) ?? 0.25
    total += weight
    const tf = chunkCounts.get(term) ?? 0
    if (tf === 0) continue
    const saturated = tf / (tf + BM25_K * (1 - BM25_B + (BM25_B * length) / Math.max(1, avgLength)))
    hit += weight * (saturated / (saturated + 0.32))
  }
  return total > 0 ? Math.min(1, hit / total) : 0
}

/** how many of the page's own topic terms are used as the expanded query */
const TOPIC_TERM_LIMIT = 32

/**
 * The page's own topic vocabulary: the highest tf-idf terms across every passage.
 * Measuring a passage against this - rather than against the best-matching passage -
 * avoids the self-match bias that makes pseudo-relevance feedback rate the seed
 * passage at 100% and everything else at nothing.
 */
function documentTopicTerms(chunkWords: Map<string, number>[], idf: Map<string, number>): Map<string, number> {
  const totals = new Map<string, number>()
  for (const doc of chunkWords) {
    for (const [term, count] of doc) {
      const weight = (1 + Math.log(count)) * (idf.get(term) ?? 0)
      totals.set(term, (totals.get(term) ?? 0) + weight)
    }
  }
  const top = [...totals].sort((a, b) => b[1] - a[1]).slice(0, TOPIC_TERM_LIMIT)
  const mass = top.reduce((sum, entry) => sum + entry[1], 0) || 1
  return new Map(top.map(([term, weight]) => [term, weight / mass]))
}

/** raw blend 0..1 -> reported 0..100; see the note on lexicalSignals */
const LEXICAL_CALIBRATION = { low: 0.045, high: 0.3, curve: 0.78 } as const

export interface LexicalSignals {
  /** literal query-term coverage of this passage */
  cov: number
  /** coverage of the page's topic vocabulary, gated by how well the page matches the query */
  topical: number
  /** query bigram coverage */
  phrase: number
  /** literal query-term coverage of the whole page - the anchor that keeps scores absolute */
  docCov: number
  raw: number
  score: number
}

/**
 * Lexical relevance signals, all over a stemmed unigram + bigram space:
 *   - `cov`      BM25-saturated, idf-weighted share of the literal query terms a passage covers
 *   - `topical`  the same measure against the page's own topic vocabulary, gated by
 *                sqrt(`docCov`). This is what lets a passage rank on topic vocabulary rather
 *                than on the exact words of the query - "ACCA exam exemptions" is on topic for
 *                "become an accountant" even with zero literal overlap - while the gate keeps
 *                the scale absolute: on a page that never mentions the query at all, the topic
 *                term contributes nothing and every passage correctly reads as noise.
 *   - `phrase`   query bigram coverage
 *
 * The blend weights and the final calibration are exactly that - a calibration. Raw lexical
 * similarity for a 6-word query against a 300-word passage lives in a narrow low band; the
 * calibration maps it onto the 0-100 scale the 65 / 43 thresholds are defined against. The
 * mode is labelled "Fast Mapping (lexical)" in the UI because it measures wording overlap,
 * not meaning - two passages that say the same thing in different words score apart.
 */
export function lexicalSignals(query: string, chunks: Chunk[]): LexicalSignals[] {
  if (chunks.length === 0) return []
  const empty: LexicalSignals = { cov: 0, topical: 0, phrase: 0, docCov: 0, raw: 0, score: 0 }
  const queryTerms = extractTerms(query)
  const chunkTerms = chunks.map((chunk) => extractTerms(chunk.text))

  const queryWords = counts(queryTerms.words)
  const queryBigrams = counts(queryTerms.bigrams)
  if (queryWords.size === 0) return chunks.map(() => ({ ...empty }))

  const chunkWords = chunkTerms.map((terms) => counts(terms.words))
  const chunkBigrams = chunkTerms.map((terms) => counts(terms.bigrams))

  const idfWords = idfTable([...chunkWords, queryWords])
  const idfBigrams = idfTable([...chunkBigrams, queryBigrams])

  const lengths = chunkTerms.map((terms) => terms.words.length)
  const avgLength = lengths.reduce((sum, value) => sum + value, 0) / Math.max(1, lengths.length)

  // page-level anchor: does this page talk about the query at all?
  const documentWords = new Map<string, number>()
  for (const doc of chunkWords) for (const [term, count] of doc) documentWords.set(term, (documentWords.get(term) ?? 0) + count)
  const documentLength = lengths.reduce((sum, value) => sum + value, 0)
  const docCov = coverage(queryWords, documentWords, idfWords, documentLength, Math.max(1, documentLength))
  // soft gate: a page only partly on-query still lets its best passages score
  const topicGate = Math.sqrt(docCov)

  const topicTerms = documentTopicTerms(chunkWords, idfWords)
  const topicCounts = new Map<string, number>()
  for (const term of topicTerms.keys()) topicCounts.set(term, 1)

  const { low, high, curve } = LEXICAL_CALIBRATION
  return chunks.map((_, index) => {
    const cov = coverage(queryWords, chunkWords[index], idfWords, lengths[index], avgLength)
    const topical =
      topicGate * coverage(topicCounts, chunkWords[index], topicTerms, lengths[index], avgLength)
    const phrase =
      queryBigrams.size > 0 ? coverage(queryBigrams, chunkBigrams[index], idfBigrams, lengths[index], avgLength) : 0

    const raw = 0.32 * cov + 0.56 * topical + 0.12 * phrase
    const scaled = Math.pow(Math.min(1, Math.max(0, (raw - low) / (high - low))), curve)
    return { cov, topical, phrase, docCov, raw, score: Math.round(scaled * 1000) / 10 }
  })
}

/** Lexical relevance, 0..100. See {@link lexicalSignals} for how the number is built. */
export function scoreLexical(query: string, chunks: Chunk[]): number[] {
  return lexicalSignals(query, chunks).map((signals) => signals.score)
}

/** Embedding cosines land in a narrow band; this stretches them onto the same 0-100 scale. */
export const EMBEDDING_CALIBRATION = { low: 0.14, high: 0.76 } as const

export function scoreFromEmbeddings(queryVector: number[], chunkVectors: number[][]): number[] {
  const { low, high } = EMBEDDING_CALIBRATION
  return chunkVectors.map((vector) => {
    const raw = cosine(queryVector, vector)
    const scaled = (raw - low) / (high - low)
    return Math.round(Math.min(1, Math.max(0, scaled)) * 1000) / 10
  })
}

export function attachScores(chunks: Chunk[], scores: number[]): ScoredChunk[] {
  return chunks.map((chunk, index) => {
    const score = Math.max(0, Math.min(100, scores[index] ?? 0))
    return { ...chunk, score, category: categorize(score) }
  })
}
