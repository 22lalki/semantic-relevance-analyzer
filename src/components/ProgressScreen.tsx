import type { ProgressStep } from '../lib/pipeline.ts'

const STEPS: { id: ProgressStep; label: string }[] = [
  { id: 'fetch', label: 'Fetching content' },
  { id: 'chunk', label: 'Chunking passages' },
  { id: 'score', label: 'Scoring against query' },
  { id: 'map', label: 'Building maps' },
]

interface Props {
  done: ProgressStep[]
  current: ProgressStep | null
}

export function ProgressScreen({ done, current }: Props) {
  return (
    <div className="panel flex flex-col items-center gap-8 px-6 py-16">
      <div className="relative h-24 w-24">
        <div className="absolute inset-0 animate-spin rounded-full border-2 border-slate-800 border-t-indigo-400 [animation-duration:1.1s]" />
        <div className="absolute inset-3 animate-spin rounded-full border-2 border-slate-800 border-b-fuchsia-400 [animation-direction:reverse] [animation-duration:1.6s]" />
        <div className="absolute inset-0 grid place-items-center">
          <span className="h-2.5 w-2.5 rounded-full bg-blue-400 shadow-[0_0_18px_6px_rgba(59,130,246,0.55)]" />
        </div>
      </div>

      <div className="text-center">
        <h2 className="text-lg font-semibold text-slate-100">Computing Vectors</h2>
        <p className="mt-1 text-sm text-slate-400">Mapping each passage against the target query.</p>
      </div>

      <ol className="w-full max-w-sm space-y-2.5">
        {STEPS.map((step) => {
          const isDone = done.includes(step.id)
          const isCurrent = current === step.id
          return (
            <li
              key={step.id}
              className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition ${
                isDone
                  ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-200'
                  : isCurrent
                    ? 'border-indigo-500/40 bg-indigo-500/10 text-indigo-100'
                    : 'border-slate-800 bg-slate-950/40 text-slate-500'
              }`}
            >
              <span
                className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[11px] font-bold ${
                  isDone
                    ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-300'
                    : isCurrent
                      ? 'border-indigo-400/60 bg-indigo-500/20 text-indigo-200'
                      : 'border-slate-700 text-slate-600'
                }`}
              >
                {isDone ? '✓' : isCurrent ? '•' : ''}
              </span>
              {step.label}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
