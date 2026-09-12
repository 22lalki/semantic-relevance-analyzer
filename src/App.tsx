import { useRef, useState } from 'react'
import { ConfigForm } from './components/ConfigForm.tsx'
import { INITIAL_CONFIG } from './lib/config.ts'
import type { ConfigState } from './lib/config.ts'
import { DeepAnalysis } from './components/DeepAnalysis.tsx'
import { ProgressScreen } from './components/ProgressScreen.tsx'
import { ProximityMap } from './components/ProximityMap.tsx'
import { RelevanceDashboard } from './components/RelevanceDashboard.tsx'
import { runAnalysis } from './lib/pipeline.ts'
import type { ProgressStep } from './lib/pipeline.ts'
import type { AnalysisResult } from './lib/types.ts'

type View = 'config' | 'running' | 'results'

/** Selects the content the active tab feeds into the pipeline. */
function collectContents(config: ConfigState): { label: 'A' | 'B'; name: string; text: string }[] | string {
  if (config.tab === 'url') {
    if (!config.urlText.trim()) return 'Fetch a URL first, or switch to the Text tab and paste the content.'
    return [{ label: 'A', name: config.url || 'Fetched page', text: config.urlText }]
  }
  if (config.tab === 'compare') {
    if (!config.compareA.trim() || !config.compareB.trim()) return 'Compare mode needs content in both A and B.'
    return [
      { label: 'A', name: 'Content A', text: config.compareA },
      { label: 'B', name: 'Content B', text: config.compareB },
    ]
  }
  if (!config.text.trim()) return 'Paste some content to analyse.'
  return [{ label: 'A', name: 'Pasted content', text: config.text }]
}

export default function App() {
  const [config, setConfig] = useState<ConfigState>(INITIAL_CONFIG)
  const [view, setView] = useState<View>('config')
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [doneSteps, setDoneSteps] = useState<ProgressStep[]>([])
  const [currentStep, setCurrentStep] = useState<ProgressStep | null>(null)
  const [activeLabel, setActiveLabel] = useState<'A' | 'B'>('A')
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const resultsRef = useRef<HTMLDivElement>(null)

  const handleRun = async () => {
    setError(null)
    if (!config.query.trim()) {
      setError('Enter a target keyword or prompt first.')
      return
    }
    const contents = collectContents(config)
    if (typeof contents === 'string') {
      setError(contents)
      return
    }

    setView('running')
    setDoneSteps(config.tab === 'url' ? ['fetch'] : [])
    setCurrentStep('chunk')
    setActiveLabel('A')
    setHighlightId(null)

    const started = Date.now()
    try {
      const analysis = await runAnalysis(
        {
          query: config.query,
          algorithm: config.algorithm,
          context: config.context,
          apiKey: config.apiKey || undefined,
          contents,
        },
        {
          onStep: (step) => {
            setDoneSteps((previous) => (previous.includes(step) ? previous : [...previous, step]))
            setCurrentStep(step)
          },
        },
      )
      // let the step list read as a sequence rather than a flash
      const elapsed = Date.now() - started
      if (elapsed < 900) await new Promise((resolve) => setTimeout(resolve, 900 - elapsed))
      setDoneSteps(['fetch', 'chunk', 'score', 'map'])
      setCurrentStep(null)
      setResult(analysis)
      setView('results')
      requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The analysis could not be completed.')
      setView('config')
      setCurrentStep(null)
    }
  }

  const handleSelectChunk = (chunkId: string) => {
    setHighlightId(chunkId)
    const row = document.getElementById(`chunk-row-${chunkId}`)
    row?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const activeSeries = result?.series.find((series) => series.label === activeLabel) ?? result?.series[0]

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-8">
        <p className="label-caps text-indigo-400">Semantic SEO</p>
        <h1 className="mt-2 bg-gradient-to-r from-slate-50 via-indigo-200 to-fuchsia-300 bg-clip-text text-3xl font-bold text-transparent sm:text-4xl">
          Semantic Relevance Analyzer
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">
          Split a page into retrieval passages, score each one against the query it should win, and see which
          sections pull the page into AI search results — and which are dead weight.
        </p>
      </header>

      {view === 'config' && (
        <ConfigForm value={config} onChange={setConfig} onRun={() => void handleRun()} error={error} />
      )}

      {view === 'running' && <ProgressScreen done={doneSteps} current={currentStep} />}

      {view === 'results' && result && activeSeries && (
        <div ref={resultsRef} className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                  result.effectiveAlgorithm === 'embedding'
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                    : 'border-slate-700 bg-slate-800/70 text-slate-300'
                }`}
              >
                {result.effectiveAlgorithm === 'embedding' ? 'Embedding-based' : 'Fast Mapping (lexical)'}
              </span>
              <span className="text-xs text-slate-500">
                {result.series.reduce((sum, series) => sum + series.chunks.length, 0)} passages ·{' '}
                {result.compare ? '2 content sets' : '1 content set'}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setView('config')
                setError(null)
              }}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-slate-700"
            >
              ← New analysis
            </button>
          </div>

          {result.fallbackNotice && (
            <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-200">
              {result.fallbackNotice}
            </p>
          )}

          <ProximityMap series={activeSeries} onSelectChunk={handleSelectChunk} />
          <RelevanceDashboard
            result={result}
            activeLabel={activeLabel}
            onActiveLabelChange={setActiveLabel}
            highlightId={highlightId}
          />
          <DeepAnalysis result={result} apiKey={config.apiKey} />
        </div>
      )}

      <footer className="mt-10 border-t border-slate-800/70 pt-5 text-xs text-slate-600">
        Passage scoring runs locally in Fast Mapping mode; embeddings and Claude analysis run through serverless
        functions so keys never reach the browser.
      </footer>
    </div>
  )
}
