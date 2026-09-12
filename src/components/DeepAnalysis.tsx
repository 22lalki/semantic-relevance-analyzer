import { useState } from 'react'
import { ApiError, analyzeContent } from '../lib/api.ts'
import { buildOfflineAnalysis } from '../lib/offlineAnalysis.ts'
import type { AnalysisResult, DeepAnalysis as DeepAnalysisResult, Suggestion } from '../lib/types.ts'

const SUGGESTION_STYLES: Record<Suggestion['type'], { bar: string; chip: string }> = {
  Addition: { bar: '#22c55e', chip: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30' },
  Structure: { bar: '#3b82f6', chip: 'text-blue-300 bg-blue-500/10 border-blue-500/30' },
  Revision: { bar: '#f97316', chip: 'text-orange-300 bg-orange-500/10 border-orange-500/30' },
}

interface Props {
  result: AnalysisResult
  apiKey: string
}

type Status = 'idle' | 'loading' | 'ready'

export function DeepAnalysis({ result, apiKey }: Props) {
  const [status, setStatus] = useState<Status>('idle')
  const [analysis, setAnalysis] = useState<DeepAnalysisResult | null>(null)
  const [source, setSource] = useState<'live' | 'mock' | 'offline'>('live')
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    setStatus('loading')
    setError(null)
    try {
      const response = await analyzeContent({
        query: result.query,
        context: result.context,
        apiKey: apiKey || undefined,
        series: result.series.map((series) => ({
          label: series.label,
          chunks: series.chunks.map((chunk) => ({
            title: chunk.title,
            type: chunk.type,
            score: chunk.score,
            text: chunk.text,
          })),
        })),
      })
      setAnalysis(response)
      setSource(response.mock ? 'mock' : 'live')
      setStatus('ready')
    } catch (caught) {
      // 501 means "no key anywhere" - that is the demo path, not a failure
      if (caught instanceof ApiError && caught.status === 501) {
        setAnalysis(buildOfflineAnalysis(result))
        setSource('offline')
        setStatus('ready')
        return
      }
      setError(caught instanceof Error ? caught.message : 'The analysis could not be completed.')
      setStatus('idle')
    }
  }

  return (
    <section className="panel p-5 sm:p-6">
      <h3 className="text-sm font-semibold tracking-wide text-slate-200">Deep AI Semantic Analysis</h3>

      {status !== 'ready' && (
        <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/60 p-6 text-center">
          <p className="mx-auto max-w-xl text-sm leading-relaxed text-slate-400">
            The vector map shows structural proximity. To uncover which entities are missing, how the tone reads to
            your audience, and which edits would actually move retrieval, run the content through Claude.
          </p>
          {error && (
            <p className="mx-auto mt-4 max-w-xl rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={() => void run()}
            disabled={status === 'loading'}
            className="gradient-cta mt-5 rounded-xl px-6 py-3 text-sm font-bold tracking-wide text-white transition disabled:cursor-not-allowed disabled:opacity-70"
          >
            {status === 'loading' ? 'Analyzing content…' : 'GENERATE AI ANALYSIS'}
          </button>
        </div>
      )}

      {status === 'ready' && analysis && (
        <>
          {source === 'offline' && (
            <p className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
              Demo output — computed from your own scores, no AI involved. Add an API key for a live Claude
              analysis that can also name entities the page is missing.
            </p>
          )}

          {source === 'mock' && (
            <p className="mt-4 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sm text-sky-200">
              <strong className="font-semibold">Mock response.</strong> The test key ran the full live path —
              request, JSON parsing, normalisation, rendering — but no model was called and none of this text is a
              real reading of your content. Use a real Anthropic key for that.
            </p>
          )}

          <div className="mt-4 grid items-start gap-4 lg:grid-cols-3">
            <div className="min-w-0 space-y-4">
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                <span className="label-caps">Executive Summary</span>
                <blockquote className="mt-3 border-l-2 border-indigo-500/60 pl-3 text-sm italic leading-relaxed text-slate-300">
                  {analysis.executive_summary}
                </blockquote>
              </div>
              {analysis.tone_readability && (
                <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
                  <span className="label-caps">Tone &amp; Readability</span>
                  <p className="mt-2 text-sm leading-relaxed text-slate-400">{analysis.tone_readability}</p>
                </div>
              )}
            </div>

            <div className="min-w-0 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
              <span className="label-caps">Missing Semantic Entities</span>
              <div className="mt-3 flex flex-wrap gap-2">
                {analysis.missing_entities.length === 0 && (
                  <p className="text-sm text-slate-500">No significant gaps found.</p>
                )}
                {analysis.missing_entities.map((entity) => (
                  <span
                    key={entity}
                    title={entity}
                    className="max-w-full break-words rounded-full border border-rose-500/30 bg-rose-500/10 px-3 py-1 text-xs font-medium text-rose-200"
                  >
                    {entity}
                  </span>
                ))}
              </div>
            </div>

            <div className="min-w-0">
              <span className="label-caps">Actionable Optimization Suggestions</span>
              <ul className="mt-3 space-y-2.5">
                {analysis.suggestions.map((suggestion, index) => {
                  const style = SUGGESTION_STYLES[suggestion.type]
                  return (
                    <li
                      key={`${suggestion.type}-${index}`}
                      className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/60"
                      style={{ borderLeft: `3px solid ${style.bar}` }}
                    >
                      <div className="p-3.5">
                        <span className={`rounded-md border px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase ${style.chip}`}>
                          {suggestion.type}
                        </span>
                        <p className="mt-2 text-sm leading-relaxed text-slate-300">{suggestion.text}</p>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void run()}
            className="mt-4 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-slate-700"
          >
            Re-run analysis
          </button>
        </>
      )}
    </section>
  )
}
