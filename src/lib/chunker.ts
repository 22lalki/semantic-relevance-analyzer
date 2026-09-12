import type { Chunk, ChunkType } from './types.ts'

const MIN_WORDS = 150
const MAX_WORDS = 400
/** below this a block is merged into its neighbour instead of becoming a chunk */
const ORPHAN_WORDS = 12

interface Section {
  title: string | null
  type: ChunkType
  paragraphs: string[]
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*$/
/** "Some Title" on its own short line, no sentence punctuation — a heading in plain pasted text */
const BARE_HEADING_RE = /^[A-Z0-9][^.!?]{2,80}$/
/** a line ending this way is a wrapped sentence, not a heading */
const CONTINUATION_RE = /[,;:–—-]$|\b(and|or|the|a|an|of|to|for|with|in|on|by)$/i

function countWords(text: string): number {
  const matched = text.match(/[\p{L}\p{N}'’-]+/gu)
  return matched ? matched.length : 0
}

function headingType(level: number): ChunkType {
  return level >= 3 ? 'H3' : 'H2'
}

/** Splits raw text into heading-led sections. Markdown `#` levels and bare heading lines both count. */
function splitIntoSections(raw: string): Section[] {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n')
  const sections: Section[] = []
  let current: Section = { title: null, type: 'Paragraph', paragraphs: [] }
  let buffer: string[] = []

  const flushParagraph = () => {
    const text = buffer.join(' ').replace(/\s+/g, ' ').trim()
    if (text) current.paragraphs.push(text)
    buffer = []
  }
  const flushSection = () => {
    flushParagraph()
    if (current.title !== null || current.paragraphs.length > 0) sections.push(current)
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim()
    if (!line) {
      flushParagraph()
      continue
    }

    const md = HEADING_RE.exec(line)
    const nextLine = (lines[i + 1] ?? '').trim()
    const looksBare =
      !md &&
      buffer.length === 0 &&
      line.length <= 80 &&
      countWords(line) <= 12 &&
      BARE_HEADING_RE.test(line) &&
      !CONTINUATION_RE.test(line) &&
      nextLine.length > 0 &&
      !HEADING_RE.test(nextLine)

    if (md || looksBare) {
      flushSection()
      const level = md ? md[1].length : 2
      current = { title: md ? md[2].trim() : line, type: headingType(level), paragraphs: [] }
      continue
    }

    buffer.push(line)
  }
  flushSection()

  return sections.filter((section) => section.title !== null || section.paragraphs.length > 0)
}

/** Packs paragraphs into ~150-400 word groups, never splitting a paragraph. */
function packParagraphs(paragraphs: string[]): string[] {
  const groups: string[] = []
  let buffer: string[] = []
  let words = 0

  for (const paragraph of paragraphs) {
    const size = countWords(paragraph)
    if (words > 0 && words + size > MAX_WORDS && words >= MIN_WORDS) {
      groups.push(buffer.join('\n\n'))
      buffer = []
      words = 0
    }
    buffer.push(paragraph)
    words += size
    if (words >= MAX_WORDS) {
      groups.push(buffer.join('\n\n'))
      buffer = []
      words = 0
    }
  }
  if (buffer.length > 0) {
    const tail = buffer.join('\n\n')
    if (groups.length > 0 && countWords(tail) < ORPHAN_WORDS) groups[groups.length - 1] += `\n\n${tail}`
    else groups.push(tail)
  }
  return groups
}

/**
 * Splits content into retrieval passages.
 * Headings start a new chunk; long runs of prose are divided on paragraph
 * boundaries so a passage stays in the ~150-400 word range search engines index.
 */
export function chunkContent(raw: string): Chunk[] {
  const sections = splitIntoSections(raw ?? '')
  const chunks: Chunk[] = []
  let paragraphCounter = 0
  /** headings with no body of their own are parent headings - carried into the next passage */
  let pendingHeadings: string[] = []

  for (const section of sections) {
    const body = section.paragraphs.join('\n\n').trim()
    if (!body) {
      if (section.title) pendingHeadings.push(section.title)
      continue
    }

    const carried = pendingHeadings
    pendingHeadings = []
    const groups = packParagraphs(
      carried.length > 0 ? [carried.join(' — '), ...section.paragraphs] : section.paragraphs,
    )
    groups.forEach((group, groupIndex) => {
      let title: string
      let type: ChunkType
      if (section.title) {
        title = groupIndex === 0 ? section.title : `${section.title} (cont. ${groupIndex + 1})`
        type = groupIndex === 0 ? section.type : 'Paragraph'
      } else if (chunks.length === 0 && groupIndex === 0) {
        title = 'Intro'
        type = 'Paragraph'
      } else {
        paragraphCounter += 1
        title = `Paragraph ${paragraphCounter}`
        type = 'Paragraph'
      }
      const text = section.title && groupIndex === 0 ? `${section.title}\n\n${group}` : group
      chunks.push({
        id: `c${chunks.length + 1}`,
        index: chunks.length,
        title,
        type,
        text,
        wordCount: countWords(group),
      })
    })
  }

  // fold dust into a neighbour so the map has no meaningless points
  const merged: Chunk[] = []
  for (const chunk of chunks) {
    if (chunk.wordCount < ORPHAN_WORDS && merged.length > 0) {
      const previous = merged[merged.length - 1]
      previous.text = `${previous.text}\n\n${chunk.text}`
      previous.wordCount += chunk.wordCount
      continue
    }
    merged.push({ ...chunk })
  }
  if (merged.length > 1 && merged[0].wordCount < ORPHAN_WORDS) {
    merged[1].text = `${merged[0].text}\n\n${merged[1].text}`
    merged[1].wordCount += merged[0].wordCount
    merged.shift()
  }

  return merged.map((chunk, index) => ({ ...chunk, index, id: `c${index + 1}` }))
}
