import type { SemanticContext, VectorAlgorithm } from './types.ts'

export type SourceTab = 'url' | 'text' | 'compare'

/** Everything the configuration screen collects before a run. */
export interface ConfigState {
  query: string
  tab: SourceTab
  url: string
  urlText: string
  urlChars: number
  text: string
  compareA: string
  compareB: string
  algorithm: VectorAlgorithm
  context: SemanticContext
  apiKey: string
}

export const INITIAL_CONFIG: ConfigState = {
  query: '',
  tab: 'text',
  url: '',
  urlText: '',
  urlChars: 0,
  text: '',
  compareA: '',
  compareB: '',
  algorithm: 'lexical',
  context: { audience: '', purpose: '', niche: '' },
  apiKey: '',
}
