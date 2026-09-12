import { useId, useState } from 'react'
import { Select } from './Select.tsx'
import type { SelectOption } from './Select.tsx'
import { autofillContext, fetchPage } from '../lib/api.ts'
import { DEMO_CONTENT, DEMO_CONTENT_B, DEMO_QUERY } from '../lib/demo.ts'
import type { ConfigState, SourceTab } from '../lib/config.ts'
import type { VectorAlgorithm } from '../lib/types.ts'

interface Props {
  value: ConfigState
  onChange: (next: ConfigState) => void
  onRun: () => void
  error: string | null
}

const ALGORITHM_OPTIONS: SelectOption<VectorAlgorithm>[] = [
  { value: 'lexical', label: 'Layout-based (Fast Mapping)', hint: 'Lexical, no key needed' },
  { value: 'embedding', label: 'Embedding-based', hint: 'Real vectors via /api/embed' },
]

const TABS: { id: SourceTab; label: string; hint: string }[] = [
  { id: 'url', label: 'URL', hint: 'Fetch a live page' },
  { id: 'text', label: 'Text', hint: 'Paste raw content' },
  { id: 'compare', label: 'Compare', hint: 'Two versions, one query' },
]

export function ConfigForm({ value, onChange, onRun, error }: Props) {
  const formId = useId()
  const [fetching, setFetching] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [autofilling, setAutofilling] = useState(false)

  const patch = (partial: Partial<ConfigState>) => onChange({ ...value, ...partial })

  const handleFetch = async () => {
    if (!value.url.trim() || fetching) return
    setFetching(true)
    setFetchError(null)
    try {
      const page = await fetchPage(value.url.trim())
      patch({ urlText: page.text, urlChars: page.chars, query: value.query })
    } catch (caught) {
      setFetchError(caught instanceof Error ? caught.message : 'Could not fetch that page.')
      patch({ urlText: '', urlChars: 0 })
    } finally {
      setFetching(false)
    }
  }

  const handleAutofill = async () => {
    if (!value.query.trim() || autofilling) return
    setAutofilling(true)
    try {
      const context = await autofillContext(value.query.trim(), value.apiKey)
      patch({ context })
    } catch {
      // /api/autofill degrades to heuristics server-side; nothing useful to say here
    } finally {
      setAutofilling(false)
    }
  }

  const loadDemo = () => {
    onChange({
      ...value,
      query: DEMO_QUERY,
      tab: value.tab === 'compare' ? 'compare' : 'text',
      text: DEMO_CONTENT,
      compareA: DEMO_CONTENT,
      compareB: DEMO_CONTENT_B,
      context: {
        audience: 'Career changers and graduates in the UK',
        purpose: 'Explain every route into the profession end to end',
        niche: 'Careers advice / professional qualifications',
      },
    })
  }

  return (
    <form
      className="panel p-5 sm:p-7"
      onSubmit={(event) => {
        event.preventDefault()
        onRun()
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Analysis Configuration</h2>
          <p className="mt-1 text-sm text-slate-400">
            Score every passage of a page against the query it should win in AI search.
          </p>
        </div>
        <button
          type="button"
          onClick={loadDemo}
          className="rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-3 py-1.5 text-xs font-semibold text-indigo-200 transition hover:bg-indigo-500/20"
        >
          Try demo
        </button>
      </div>

      <div className="mt-6 space-y-6">
        <div>
          <label className="label-caps" htmlFor={`${formId}-query`}>
            Target Keyword / Prompt <span className="text-rose-400">*</span>
          </label>
          <input
            id={`${formId}-query`}
            className="field mt-2"
            placeholder="how to become an accountant in the uk"
            value={value.query}
            onChange={(event) => patch({ query: event.target.value })}
          />
        </div>

        <div>
          <span className="label-caps">Content Source Selection</span>
          <div className="mt-2 flex flex-wrap gap-1 rounded-xl border border-slate-800 bg-slate-950/60 p-1">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => patch({ tab: tab.id })}
                aria-pressed={value.tab === tab.id}
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  value.tab === tab.id
                    ? 'bg-slate-800 text-slate-100 shadow-inner'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab.label}
                <span className="ml-2 hidden text-[11px] font-normal text-slate-500 sm:inline">{tab.hint}</span>
              </button>
            ))}
          </div>

          {value.tab === 'url' && (
            <div className="mt-3 space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  className="field"
                  placeholder="https://example.com/guide"
                  value={value.url}
                  onChange={(event) => patch({ url: event.target.value })}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void handleFetch()
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={() => void handleFetch()}
                  disabled={fetching || !value.url.trim()}
                  className="shrink-0 rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-100 transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {fetching ? 'Fetching…' : 'Fetch'}
                </button>
              </div>
              {value.urlChars > 0 && (
                <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
                  Ready: {value.urlChars.toLocaleString()} chars indexed
                </p>
              )}
              {fetchError && (
                <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                  {fetchError}
                </p>
              )}
            </div>
          )}

          {value.tab === 'text' && (
            <textarea
              className="field mt-3 min-h-52 font-mono text-[13px] leading-relaxed"
              placeholder={'Paste your content. Markdown headings (# / ##) are used as passage boundaries.'}
              value={value.text}
              onChange={(event) => patch({ text: event.target.value })}
            />
          )}

          {value.tab === 'compare' && (
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div>
                <span className="label-caps">Content A</span>
                <textarea
                  className="field mt-2 min-h-44 font-mono text-[13px] leading-relaxed"
                  placeholder="Version A"
                  value={value.compareA}
                  onChange={(event) => patch({ compareA: event.target.value })}
                />
              </div>
              <div>
                <span className="label-caps">Content B</span>
                <textarea
                  className="field mt-2 min-h-44 font-mono text-[13px] leading-relaxed"
                  placeholder="Version B"
                  value={value.compareB}
                  onChange={(event) => patch({ compareB: event.target.value })}
                />
              </div>
            </div>
          )}
        </div>

        <div>
          <span className="label-caps" id={`${formId}-algorithm-label`}>
            Vector Algorithm
          </span>
          <div className="mt-2">
            <Select<VectorAlgorithm>
              id={`${formId}-algorithm`}
              aria-labelledby={`${formId}-algorithm-label`}
              value={value.algorithm}
              options={ALGORITHM_OPTIONS}
              onChange={(algorithm) => patch({ algorithm })}
            />
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {value.algorithm === 'lexical'
              ? 'TF-IDF over stemmed unigrams and bigrams. Measures wording overlap, not meaning.'
              : 'Calls an OpenAI-compatible embedding endpoint server-side. Falls back to Fast Mapping if it is not configured.'}
          </p>
        </div>

        <details className="group rounded-xl border border-slate-800 bg-slate-950/40 p-4">
          <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium text-slate-300">
            <span>
              Semantic Context <span className="text-slate-500">(optional)</span>
            </span>
            <span className="text-slate-500 transition group-open:rotate-180">▾</span>
          </summary>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div>
              <span className="label-caps">Target Audience</span>
              <input
                className="field mt-2"
                value={value.context.audience}
                onChange={(event) => patch({ context: { ...value.context, audience: event.target.value } })}
              />
            </div>
            <div>
              <span className="label-caps">Content Purpose</span>
              <input
                className="field mt-2"
                value={value.context.purpose}
                onChange={(event) => patch({ context: { ...value.context, purpose: event.target.value } })}
              />
            </div>
            <div>
              <span className="label-caps">Website Niche</span>
              <input
                className="field mt-2"
                value={value.context.niche}
                onChange={(event) => patch({ context: { ...value.context, niche: event.target.value } })}
              />
            </div>
          </div>
          <button
            type="button"
            onClick={() => void handleAutofill()}
            disabled={autofilling || !value.query.trim()}
            className="mt-3 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {autofilling ? 'Generating…' : 'Auto-fill from keyword'}
          </button>
        </details>

        <div>
          <label className="label-caps" htmlFor={`${formId}-key`}>
            AI API Key <span className="text-slate-500">(optional)</span>
          </label>
          <input
            id={`${formId}-key`}
            className="field mt-2 font-mono text-[13px]"
            type="password"
            autoComplete="off"
            placeholder="sk-ant-…  unlocks deeper AI analysis"
            value={value.apiKey}
            onChange={(event) => patch({ apiKey: event.target.value })}
          />
          <p className="mt-2 text-xs text-slate-500">
            Used only for this analysis, never stored. Type <code className="rounded bg-slate-800 px-1 py-0.5 text-slate-300">test</code>{' '}
            to exercise the live path with a mock response instead of calling Claude.
          </p>
        </div>

        {error && (
          <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>
        )}

        <button
          type="submit"
          className="gradient-cta w-full rounded-xl px-6 py-3.5 text-sm font-bold tracking-wide text-white transition"
        >
          RUN SEMANTIC ANALYSIS
        </button>
      </div>
    </form>
  )
}
