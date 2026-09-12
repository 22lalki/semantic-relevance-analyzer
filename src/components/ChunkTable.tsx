import { useState } from 'react'
import type { ScoredChunk } from '../lib/types.ts'
import { CATEGORY_META } from '../lib/types.ts'

interface Props {
  chunks: ScoredChunk[]
  /** id of the chunk the map asked us to reveal */
  highlightId: string | null
}

/**
 * The chunk text carries its own heading so the scorer sees it, but repeating the
 * heading under the title reads as a stutter - drop it for display only.
 */
function body(chunk: ScoredChunk): string {
  const text = chunk.text.trimStart()
  return text.startsWith(chunk.title) ? text.slice(chunk.title.length).trimStart() : text
}

function preview(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > 150 ? `${flat.slice(0, 150)}…` : flat
}

export function ChunkTable({ chunks, highlightId }: Props) {
  const [openId, setOpenId] = useState<string | null>(null)

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-left">
        <thead>
          <tr className="border-b border-slate-800">
            <th className="label-caps w-16 px-3 py-2.5">Status</th>
            <th className="label-caps px-3 py-2.5">Content Chunk</th>
            <th className="label-caps w-28 px-3 py-2.5">Type</th>
            <th className="label-caps w-20 px-3 py-2.5 text-right">Score</th>
          </tr>
        </thead>
        <tbody>
          {chunks.map((chunk) => {
            const meta = CATEGORY_META[chunk.category]
            const isOpen = openId === chunk.id
            const isHighlighted = highlightId === chunk.id
            const text = body(chunk)
            return (
              <tr
                key={chunk.id}
                id={`chunk-row-${chunk.id}`}
                onClick={() => setOpenId(isOpen ? null : chunk.id)}
                className={`cursor-pointer border-b border-slate-800/60 align-top transition ${
                  isHighlighted ? 'bg-indigo-500/10' : 'hover:bg-slate-800/40'
                }`}
              >
                <td className="px-3 py-3">
                  <span className="inline-flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: meta.color, boxShadow: `0 0 8px ${meta.color}66` }}
                    />
                    <span translate="no" className="text-[11px] font-semibold tabular-nums text-slate-500">{chunk.index + 1}</span>
                  </span>
                </td>
                <td className="px-3 py-3">
                  <p className="text-sm font-semibold text-slate-100">{chunk.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-400">
                    {isOpen ? '' : preview(text)}
                  </p>
                  {isOpen && (
                    <p className="mt-1 max-h-64 overflow-y-auto whitespace-pre-line rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs leading-relaxed text-slate-300">
                      {text}
                    </p>
                  )}
                  <p className="mt-1.5 text-[11px] text-slate-600">
                    <span translate="no">{chunk.wordCount}</span> words · {isOpen ? 'click to collapse' : 'click to expand'}
                  </p>
                </td>
                <td className="px-3 py-3">
                  <span className="rounded-md border border-slate-700 bg-slate-800/70 px-2 py-0.5 text-[11px] font-medium text-slate-300">
                    {chunk.type}
                  </span>
                </td>
                <td className="px-3 py-3 text-right">
                  <span translate="no" className="text-sm font-bold tabular-nums" style={{ color: meta.color }}>
                    {chunk.score.toFixed(0)}%
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
