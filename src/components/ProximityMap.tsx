import { useState } from 'react'
import type { AnalysisSeries, ScoredChunk } from '../lib/types.ts'
import { CATEGORY_META, THRESHOLDS } from '../lib/types.ts'

const SIZE = 520
const CENTER = SIZE / 2
const R_MIN = 38
const R_MAX = 232

/** radius grows as similarity falls: R = Rmin + (1 - cos) * (Rmax - Rmin) */
function radiusFor(score: number): number {
  const similarity = Math.max(0, Math.min(100, score)) / 100
  return R_MIN + (1 - similarity) * (R_MAX - R_MIN)
}

const RINGS = [
  { score: THRESHOLDS.highlyRelevant, label: 'CORE' },
  { score: THRESHOLDS.broadMatch, label: 'ADJACENT' },
  { score: 20, label: 'PERIPHERY' },
]

interface Props {
  series: AnalysisSeries
  onSelectChunk: (chunkId: string) => void
}

export function ProximityMap({ series, onSelectChunk }: Props) {
  const [hovered, setHovered] = useState<ScoredChunk | null>(null)
  const chunks = series.chunks
  const cohesion = series.metrics.cohesion

  const points = chunks.map((chunk, index) => {
    const angle = (index / Math.max(1, chunks.length)) * Math.PI * 2 - Math.PI / 2
    const radius = radiusFor(chunk.score)
    return {
      chunk,
      x: CENTER + Math.cos(angle) * radius,
      y: CENTER + Math.sin(angle) * radius,
    }
  })

  return (
    <section className="panel p-5 sm:p-6">
      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="flex shrink-0 flex-col gap-4 lg:w-60">
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-5">
            <span className="label-caps">Overall Cohesion</span>
            <div className="mt-3 flex items-baseline gap-2">
              <span translate="no" className="text-5xl font-bold tabular-nums text-slate-50">{cohesion}</span>
              <span className="text-sm font-semibold text-slate-500">IDX</span>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500 transition-[width] duration-700"
                style={{ width: `${cohesion}%` }}
              />
            </div>
            <p className="mt-3 text-xs leading-relaxed text-slate-500">
              Mean passage relevance, penalised for spread across the page.
            </p>
          </div>

          <ul className="space-y-2 text-xs text-slate-400">
            <li className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-blue-500 shadow-[0_0_10px_3px_rgba(59,130,246,0.6)]" />
              Query
            </li>
            {(['highly-relevant', 'broad-match', 'semantic-noise'] as const).map((category) => (
              <li key={category} className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: CATEGORY_META[category].color }}
                />
                {category === 'semantic-noise' ? 'Noise' : CATEGORY_META[category].label}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative min-w-0 flex-1">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold tracking-wide text-slate-200">Semantic Proximity Map</h3>
            <span className="font-mono text-[11px] text-slate-500">R ∝ 1 − cos θ</span>
          </div>

          <div className="relative mx-auto aspect-square w-full max-w-[620px]">
            <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="h-full w-full" role="img" aria-label="Semantic proximity map">
              <defs>
                <radialGradient id="queryGlow">
                  <stop offset="0%" stopColor="#60a5fa" stopOpacity="0.55" />
                  <stop offset="100%" stopColor="#60a5fa" stopOpacity="0" />
                </radialGradient>
              </defs>

              {RINGS.map((ring) => {
                const radius = radiusFor(ring.score)
                return (
                  <g key={ring.label}>
                    <circle
                      cx={CENTER}
                      cy={CENTER}
                      r={radius}
                      fill="none"
                      stroke="#334155"
                      strokeWidth="1"
                      strokeDasharray="4 6"
                    />
                    <text
                      x={CENTER}
                      y={CENTER - radius - 6}
                      textAnchor="middle"
                      className="fill-slate-600"
                      style={{ fontSize: 10, letterSpacing: '0.18em', fontWeight: 600 }}
                    >
                      {ring.label}
                    </text>
                  </g>
                )
              })}
              <text
                x={CENTER}
                y={SIZE - 8}
                textAnchor="middle"
                className="fill-slate-700"
                style={{ fontSize: 10, letterSpacing: '0.18em', fontWeight: 600 }}
              >
                NOISE
              </text>

              {points.map((point) => (
                <line
                  key={`line-${point.chunk.id}`}
                  x1={CENTER}
                  y1={CENTER}
                  x2={point.x}
                  y2={point.y}
                  stroke={CATEGORY_META[point.chunk.category].color}
                  strokeOpacity={hovered?.id === point.chunk.id ? 0.5 : 0.16}
                  strokeWidth="1"
                />
              ))}

              <circle cx={CENTER} cy={CENTER} r="46" fill="url(#queryGlow)" />
              <circle cx={CENTER} cy={CENTER} r="11" fill="#3b82f6" stroke="#bfdbfe" strokeWidth="1.5" />

              {points.map((point) => {
                const active = hovered?.id === point.chunk.id
                const color = CATEGORY_META[point.chunk.category].color
                return (
                  <g
                    key={point.chunk.id}
                    className="cursor-pointer"
                    onMouseEnter={() => setHovered(point.chunk)}
                    onMouseLeave={() => setHovered(null)}
                    onClick={() => onSelectChunk(point.chunk.id)}
                    role="button"
                    tabIndex={0}
                    aria-label={`${point.chunk.title}, ${point.chunk.score.toFixed(0)} percent relevant`}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        onSelectChunk(point.chunk.id)
                      }
                    }}
                  >
                    <circle cx={point.x} cy={point.y} r={active ? 18 : 14} fill={color} fillOpacity={active ? 0.28 : 0} />
                    <circle
                      cx={point.x}
                      cy={point.y}
                      r="13"
                      fill={color}
                      fillOpacity="0.85"
                      stroke={active ? '#f8fafc' : color}
                      strokeWidth={active ? 2 : 1}
                    />
                    <text
                      x={point.x}
                      y={point.y + 3.5}
                      textAnchor="middle"
                      className="pointer-events-none fill-slate-950"
                      style={{ fontSize: 10, fontWeight: 700 }}
                    >
                      {point.chunk.index + 1}
                    </text>
                  </g>
                )
              })}
            </svg>

            {hovered && (
              <div
                className="pointer-events-none absolute z-10 w-52 -translate-x-1/2 -translate-y-full rounded-lg border border-slate-700 bg-slate-900/95 px-3 py-2 shadow-xl"
                style={{
                  left: `${((points.find((p) => p.chunk.id === hovered.id)?.x ?? CENTER) / SIZE) * 100}%`,
                  top: `${(((points.find((p) => p.chunk.id === hovered.id)?.y ?? CENTER) - 20) / SIZE) * 100}%`,
                }}
              >
                <p className="truncate text-xs font-semibold text-slate-100">{hovered.title}</p>
                <p className="mt-0.5 text-[11px]" style={{ color: CATEGORY_META[hovered.category].color }}>
                  {hovered.score.toFixed(0)}% · {CATEGORY_META[hovered.category].label}
                </p>
              </div>
            )}
          </div>

          <p className="mt-2 text-center text-xs text-slate-500">Click a node to jump to its passage below.</p>
        </div>
      </div>
    </section>
  )
}
