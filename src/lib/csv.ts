import type { AnalysisResult } from './types.ts'
import { CATEGORY_META } from './types.ts'

function escapeCell(value: string | number): string {
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function chunksToCsv(result: AnalysisResult): string {
  const header = ['set', 'index', 'title', 'type', 'score', 'category', 'words', 'text']
  const rows = result.series.flatMap((series) =>
    series.chunks.map((chunk) => [
      series.label,
      chunk.index + 1,
      chunk.title,
      chunk.type,
      chunk.score.toFixed(1),
      CATEGORY_META[chunk.category].label,
      chunk.wordCount,
      chunk.text.replace(/\s+/g, ' ').trim(),
    ]),
  )
  return [header, ...rows].map((row) => row.map(escapeCell).join(',')).join('\n')
}

export function summaryToText(result: AnalysisResult): string {
  const lines = [
    'Semantic Relevance Analysis',
    `Query: ${result.query}`,
    `Scoring: ${result.effectiveAlgorithm === 'embedding' ? 'Embedding-based' : 'Fast Mapping (lexical)'}`,
    '',
  ]
  for (const series of result.series) {
    if (result.compare) lines.push(`--- Content ${series.label} ---`)
    lines.push(
      `Overall cohesion: ${series.metrics.cohesion} IDX`,
      `Average relevance: ${series.metrics.avgRelevance.toFixed(1)}%`,
      `Passages needing optimization: ${series.metrics.optimizationNeeded} of ${series.metrics.chunkCount}`,
      '',
    )
    for (const chunk of series.chunks) {
      lines.push(`${String(chunk.score.toFixed(0)).padStart(3)}%  ${chunk.title} [${chunk.type}]`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  // let the download start before the object URL goes away
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // clipboard API needs a secure context; fall back to a hidden textarea
    try {
      const area = document.createElement('textarea')
      area.value = text
      area.setAttribute('readonly', '')
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.append(area)
      area.select()
      const ok = document.execCommand('copy')
      area.remove()
      return ok
    } catch {
      return false
    }
  }
}
