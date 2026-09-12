import { useEffect, useRef, useState } from 'react'
import { ChunkTable } from './ChunkTable.tsx'
import { chunksToCsv, copyText, downloadCsv, summaryToText } from '../lib/csv.ts'
import { compareVerdict } from '../lib/pipeline.ts'
import type { AnalysisResult, AnalysisSeries } from '../lib/types.ts'
import { CATEGORY_META, THRESHOLDS, categorize } from '../lib/types.ts'

const WIDTH = 900
const HEIGHT = 340
const PAD = { top: 18, right: 22, bottom: 96, left: 78 }
const PLOT_W = WIDTH - PAD.left - PAD.right
const PLOT_H = HEIGHT - PAD.top - PAD.bottom

interface Point {
  x: number
  y: number
  score: number
  title: string
}

function positions(series: AnalysisSeries): Point[] {
  const count = series.chunks.length
  return series.chunks.map((chunk, index) => ({
    x: PAD.left + (count <= 1 ? PLOT_W / 2 : (index / (count - 1)) * PLOT_W),
    y: PAD.top + PLOT_H * (1 - Math.max(0, Math.min(100, chunk.score)) / 100),
    score: chunk.score,
    title: chunk.title,
  }))
}

/** Catmull-Rom converted to cubic beziers - a readable curve without a charting dependency. */
function smoothPath(points: Point[]): string {
  if (points.length === 0) return ''
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`
  const commands = [`M ${points[0].x} ${points[0].y}`]
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2] ?? p2
    const c1x = p1.x + (p2.x - p0.x) / 6
    const c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6
    const c2y = p2.y - (p3.y - p1.y) / 6
    commands.push(`C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`)
  }
  return commands.join(' ')
}

function yFor(score: number): number {
  return PAD.top + PLOT_H * (1 - score / 100)
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

/** Tooltip anchor as a percentage of the chart width. */
function anchorPercent(x: number): number {
  return (x / WIDTH) * 100
}

/** matches the tooltip's w-56 */
const TOOLTIP_WIDTH = 224

/**
 * The chart lives in an overflow-x container, and CSS computes the other axis to
 * `auto` alongside it - so anything drawn above a high-scoring point gets clipped.
 * The card therefore sits beside the point, flipping to its left when it would not
 * otherwise fit. The decision needs the measured pixel width: as a fraction of the
 * plot the card is ~25% wide on a desktop chart but ~48% on a 375px screen, where
 * the chart is pinned to its 560px minimum.
 */
function flipsLeft(x: number, boxWidth: number): boolean {
  const anchor = (x / WIDTH) * boxWidth
  if (boxWidth <= 0) return (x - PAD.left) / PLOT_W > 0.62
  return anchor + TOOLTIP_WIDTH > boxWidth && anchor - TOOLTIP_WIDTH >= 0
}

/**
 * Tallest the card can get: the title is clamped to two lines, so the height is
 * bounded and the vertical clamp below can be computed without measuring it.
 */
const TOOLTIP_MAX_HEIGHT = 104

/**
 * Keeps the vertically-centred card inside the plot. In percentages this cannot be
 * done: the card is a fixed pixel height while the chart is 382px tall on a desktop
 * and 212px at 375px, so the same percentage clamp leaves it hanging off the top.
 */
function tooltipTop(y: number, boxWidth: number): number {
  const boxHeight = (boxWidth || 560) * (HEIGHT / WIDTH)
  const anchor = (y / HEIGHT) * boxHeight
  const half = TOOLTIP_MAX_HEIGHT / 2
  return Math.max(half, Math.min(boxHeight - half, anchor))
}

interface HoverTarget {
  label: 'A' | 'B'
  index: number
}

interface Props {
  result: AnalysisResult
  activeLabel: 'A' | 'B'
  onActiveLabelChange: (label: 'A' | 'B') => void
  highlightId: string | null
}

export function RelevanceDashboard({ result, activeLabel, onActiveLabelChange, highlightId }: Props) {
  const [copied, setCopied] = useState(false)
  const [hovered, setHovered] = useState<HoverTarget | null>(null)
  const chartRef = useRef<HTMLDivElement>(null)
  const [chartWidth, setChartWidth] = useState(0)

  // the flip decision is in pixels, so the rendered chart width has to be measured
  useEffect(() => {
    const node = chartRef.current
    if (!node) return
    setChartWidth(node.getBoundingClientRect().width)
    const observer = new ResizeObserver((entries) => setChartWidth(entries[0].contentRect.width))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  const active = result.series.find((series) => series.label === activeLabel) ?? result.series[0]
  const verdict = compareVerdict(result)

  const seriesPoints = result.series.map((series) => ({ series, points: positions(series) }))
  const labelSeries = seriesPoints[0]

  const hoveredEntry = hovered ? seriesPoints.find((entry) => entry.series.label === hovered.label) : undefined
  const hoveredPoint =
    hoveredEntry && hovered
      ? { series: hoveredEntry.series, point: hoveredEntry.points[hovered.index], index: hovered.index }
      : null

  const handleCopy = async () => {
    const ok = await copyText(summaryToText(result))
    setCopied(ok)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <section className="panel p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold tracking-wide text-slate-200">Semantic Relevance Dashboard</h3>
          <p className="mt-1 text-xs text-slate-500">Relevance across the content flow, in reading order.</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-slate-700"
          >
            {copied ? 'Copied ✓' : 'Copy'}
          </button>
          <button
            type="button"
            onClick={() => downloadCsv('semantic-relevance.csv', chunksToCsv(result))}
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-slate-700"
          >
            Download CSV
          </button>
        </div>
      </div>

      {verdict && (
        <p className="mt-4 rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-4 py-2.5 text-sm font-semibold text-indigo-100">
          {verdict}
        </p>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
          <span className="label-caps">Avg Relevance</span>
          <p translate="no" className="mt-1.5 text-2xl font-bold tabular-nums text-slate-50">
            {active.metrics.avgRelevance.toFixed(1)}%
          </p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
          <span className="label-caps">Optimization Needed</span>
          <p className="mt-1.5 text-2xl font-bold tabular-nums text-slate-50">
            <span translate="no">{active.metrics.optimizationNeeded}</span>
            <span className="ml-1 text-sm font-medium text-slate-500">of <span translate="no">{active.metrics.chunkCount}</span></span>
          </p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
          <span className="label-caps">Query Context</span>
          <p className="mt-1.5 line-clamp-2 text-sm font-medium text-slate-200">{result.query}</p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-slate-400">
        {(['highly-relevant', 'broad-match', 'semantic-noise'] as const).map((category) => (
          <span key={category} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: CATEGORY_META[category].color }} />
            {CATEGORY_META[category].label}
            <span className="text-slate-600">
              {category === 'highly-relevant'
                ? `≥ ${THRESHOLDS.highlyRelevant}%`
                : category === 'broad-match'
                  ? `${THRESHOLDS.broadMatch}–${THRESHOLDS.highlyRelevant - 1}%`
                  : `0–${THRESHOLDS.broadMatch - 1}%`}
            </span>
          </span>
        ))}
        {result.compare && (
          <span className="flex items-center gap-3 text-slate-500">
            <span className="flex items-center gap-1.5">
              <svg width="22" height="6" aria-hidden="true">
                <line x1="0" y1="3" x2="22" y2="3" stroke="#a5b4fc" strokeWidth="2" />
              </svg>
              Content A
            </span>
            <span className="flex items-center gap-1.5">
              <svg width="22" height="6" aria-hidden="true">
                <line x1="0" y1="3" x2="22" y2="3" stroke="#f0abfc" strokeWidth="2" strokeDasharray="5 4" />
              </svg>
              Content B
            </span>
          </span>
        )}
      </div>

      <div className="mt-3 overflow-x-auto">
        <div ref={chartRef} className="relative min-w-[560px]">
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className="h-auto w-full"
            role="img"
            aria-label="Relevance across the content flow"
            onMouseLeave={() => setHovered(null)}
          >
            <rect
              x={PAD.left}
              y={yFor(100)}
              width={PLOT_W}
              height={yFor(THRESHOLDS.highlyRelevant) - yFor(100)}
              fill={CATEGORY_META['highly-relevant'].color}
              fillOpacity="0.06"
            />
            <rect
              x={PAD.left}
              y={yFor(THRESHOLDS.highlyRelevant)}
              width={PLOT_W}
              height={yFor(THRESHOLDS.broadMatch) - yFor(THRESHOLDS.highlyRelevant)}
              fill={CATEGORY_META['broad-match'].color}
              fillOpacity="0.06"
            />
            <rect
              x={PAD.left}
              y={yFor(THRESHOLDS.broadMatch)}
              width={PLOT_W}
              height={yFor(0) - yFor(THRESHOLDS.broadMatch)}
              fill={CATEGORY_META['semantic-noise'].color}
              fillOpacity="0.06"
            />

            {[0, 25, 50, 75, 100].map((tick) => (
              <g key={tick}>
                <line
                  x1={PAD.left}
                  y1={yFor(tick)}
                  x2={WIDTH - PAD.right}
                  y2={yFor(tick)}
                  stroke="#1e293b"
                  strokeWidth="1"
                />
                <text x={PAD.left - 10} y={yFor(tick) + 4} textAnchor="end" className="fill-slate-600" style={{ fontSize: 11 }}>
                  {tick}%
                </text>
              </g>
            ))}

            {[THRESHOLDS.highlyRelevant, THRESHOLDS.broadMatch].map((threshold) => (
              <line
                key={threshold}
                x1={PAD.left}
                y1={yFor(threshold)}
                x2={WIDTH - PAD.right}
                y2={yFor(threshold)}
                stroke={CATEGORY_META[categorize(threshold)].color}
                strokeOpacity="0.45"
                strokeDasharray="5 5"
                strokeWidth="1"
              />
            ))}

            {seriesPoints.map(({ series, points }) => (
              <path
                key={`line-${series.label}`}
                d={smoothPath(points)}
                fill="none"
                stroke={series.label === 'A' ? '#a5b4fc' : '#f0abfc'}
                strokeWidth="2.5"
                strokeDasharray={series.label === 'B' ? '6 5' : undefined}
                strokeLinecap="round"
              />
            ))}

            {seriesPoints.map(({ series, points }) =>
              points.map((point, index) => {
                const active = hovered?.label === series.label && hovered.index === index
                return (
                  <g
                    key={`dot-${series.label}-${index}`}
                    onMouseEnter={() => setHovered({ label: series.label, index })}
                    onFocus={() => setHovered({ label: series.label, index })}
                    onBlur={() => setHovered(null)}
                    tabIndex={0}
                    role="button"
                    aria-label={`${result.compare ? `Content ${series.label}: ` : ''}${point.title}, ${point.score.toFixed(
                      0,
                    )} percent relevant`}
                    className="cursor-pointer focus:outline-none"
                  >
                    {/* generous transparent hit area - a 5px dot is hard to hover */}
                    <circle cx={point.x} cy={point.y} r="15" fill="transparent" />
                    {active && (
                      <circle
                        cx={point.x}
                        cy={point.y}
                        r="11"
                        fill={CATEGORY_META[categorize(point.score)].color}
                        fillOpacity="0.25"
                      />
                    )}
                    <circle
                      cx={point.x}
                      cy={point.y}
                      r={active ? 7 : series.label === activeLabel ? 5.5 : 4}
                      fill={CATEGORY_META[categorize(point.score)].color}
                      stroke={active ? '#f8fafc' : '#020617'}
                      strokeWidth="1.5"
                    />
                  </g>
                )
              }),
            )}

            {hoveredPoint && (
              <line
                x1={hoveredPoint.point.x}
                y1={PAD.top}
                x2={hoveredPoint.point.x}
                y2={PAD.top + PLOT_H}
                stroke="#94a3b8"
                strokeOpacity="0.25"
                strokeDasharray="3 4"
                strokeWidth="1"
              />
            )}

            {labelSeries?.points.map((point, index) => (
              <text
                key={`label-${index}`}
                x={point.x}
                y={PAD.top + PLOT_H + 14}
                textAnchor="end"
                transform={`rotate(-40 ${point.x} ${PAD.top + PLOT_H + 14})`}
                className="fill-slate-500"
                style={{ fontSize: 11 }}
              >
                {truncate(point.title, 16)}
              </text>
            ))}
          </svg>

          {hoveredPoint && (
            <div
              className="pointer-events-none absolute z-20 w-56 rounded-lg border border-slate-700 bg-slate-900/95 px-3 py-2 shadow-xl"
              style={{
                left: `${anchorPercent(hoveredPoint.point.x)}%`,
                top: `${tooltipTop(hoveredPoint.point.y, chartWidth)}px`,
                // flush against the point, vertically centred on it
                transform: flipsLeft(hoveredPoint.point.x, chartWidth)
                  ? 'translate(-100%, -50%)'
                  : 'translate(0, -50%)',
              }}
            >
              {result.compare && (
                <p className="text-[10px] font-bold tracking-wider text-slate-500 uppercase">
                  Content {hoveredPoint.series.label}
                </p>
              )}
              <p className="line-clamp-2 text-xs font-semibold text-slate-100">{hoveredPoint.point.title}</p>
              <p
                className="mt-0.5 text-[11px]"
                style={{ color: CATEGORY_META[categorize(hoveredPoint.point.score)].color }}
              >
                {hoveredPoint.point.score.toFixed(0)}% · {CATEGORY_META[categorize(hoveredPoint.point.score)].label}
              </p>
              <p className="mt-1 text-[10px] text-slate-500">
                Passage {hoveredPoint.index + 1} of {hoveredPoint.series.chunks.length}
              </p>
            </div>
          )}
          </div>
        </div>

        {result.compare && (
          <div className="mt-5 inline-flex rounded-lg border border-slate-800 bg-slate-950/60 p-1">
            {result.series.map((series) => (
              <button
                key={series.label}
                type="button"
                onClick={() => onActiveLabelChange(series.label)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                  series.label === activeLabel ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Content {series.label}
              </button>
            ))}
        </div>
      )}

      <div className="mt-3">
        <ChunkTable key={active.label} chunks={active.chunks} highlightId={highlightId} />
      </div>
    </section>
  )
}
