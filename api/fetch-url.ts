import type { VercelRequest, VercelResponse } from '@vercel/node'

const MAX_BYTES = 3_000_000
const TIMEOUT_MS = 15_000

const BLOCK_TAGS = ['script', 'style', 'noscript', 'template', 'svg', 'iframe', 'form', 'nav', 'header', 'footer']

/**
 * Matches a whole tag including attribute values that themselves contain ">".
 * A naive /<[^>]+>/ leaks the tail of attributes like Wikipedia's data-mw JSON
 * into the extracted text.
 */
const ANY_TAG =
  /<\/?[a-zA-Z][a-zA-Z0-9:-]*(?:\s+[^\s/>="']+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?>/g

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
  pound: '£',
  euro: '€',
  deg: '°',
  laquo: '«',
  raquo: '»',
  lsaquo: '‹',
  rsaquo: '›',
  bdquo: '„',
  sbquo: '‚',
  bull: '•',
  middot: '·',
  times: '×',
  divide: '÷',
  minus: '−',
  plusmn: '±',
  prime: '′',
  Prime: '″',
  dagger: '†',
  copy: '©',
  reg: '®',
  trade: '™',
  sect: '§',
  para: '¶',
  permil: '‰',
  micro: 'µ',
  larr: '←',
  rarr: '→',
  harr: '↔',
  ensp: ' ',
  emsp: ' ',
  thinsp: ' ',
  shy: '',
  zwj: '',
  zwnj: '',
}

function decodeEntities(input: string): string {
  return (
    input
      .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
      .replace(/&([a-z]+);/gi, (match, name: string) => ENTITIES[name.toLowerCase()] ?? match)
      // Anything still unresolved is markup, not prose. Left in place it shows up in the UI
      // and - worse - "laquo" becomes a scoring token. Requiring the semicolon keeps "AT&T" safe.
      .replace(/&[a-zA-Z][a-zA-Z0-9]{1,10};/g, ' ')
  )
}

/** Picks the densest <article>/<main> region if one exists, so nav and sidebars drop out. */
function mainRegion(html: string): string {
  for (const tag of ['article', 'main']) {
    const matches = [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'gi'))]
    if (matches.length > 0) {
      const best = matches.reduce((a, b) => (b[1].length > a[1].length ? b : a))
      if (best[1].length > 600) return best[1]
    }
  }
  const body = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html)
  return body ? body[1] : html
}

/**
 * HTML -> plain text, keeping the heading structure as markdown so the chunker
 * can still split the page on its real section boundaries.
 */
function htmlToStructuredText(html: string): { title: string; text: string } {
  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  const title = titleMatch ? decodeEntities(titleMatch[1]).replace(/\s+/g, ' ').trim() : ''

  let working = mainRegion(html)
  working = working.replace(/<!--[\s\S]*?-->/g, ' ')
  for (const tag of BLOCK_TAGS) {
    working = working.replace(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}\\s*>`, 'gi'), ' ')
  }

  working = working
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level: string, inner: string) => {
      const text = decodeEntities(inner.replace(ANY_TAG, ' ')).replace(/\s+/g, ' ').trim()
      if (!text) return '\n\n'
      return `\n\n${'#'.repeat(Math.min(6, Number(level)))} ${text}\n\n`
    })
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|tr|ul|ol|li|blockquote|table)>/gi, '\n\n')
    .replace(ANY_TAG, ' ')

  const text = decodeEntities(working)
    // reference and edit markers are noise in every scoring mode
    .replace(/\[(?:\d{1,3}|edit|citation needed|note \d+)\]/gi, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t ]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    // a newline inside a block is whitespace in HTML; only blank lines, headings
    // and list items are real breaks, and a soft break must not look like a heading
    .replace(/([^\n])\n(?![\n#]|- )/g, '$1 ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return { title, text }
}

function isPublicHttpUrl(raw: string): URL | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  const host = url.hostname.toLowerCase()
  // no SSRF into the private network from a public endpoint
  const blocked =
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host === '[::1]'
  return blocked ? null : url
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed.' })
    return
  }
  const body = (req.body ?? {}) as { url?: unknown }
  const raw = typeof body.url === 'string' ? body.url.trim() : ''
  const withScheme = raw && !/^https?:\/\//i.test(raw) ? `https://${raw}` : raw

  const url = isPublicHttpUrl(withScheme)
  if (!url) {
    res.status(400).json({ error: 'Enter a valid public http(s) URL.' })
    return
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        // plenty of sites return 403 to an unrecognised agent
        'user-agent':
          'Mozilla/5.0 (compatible; SemanticRelevanceAnalyzer/1.0; +https://vercel.com) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'en-GB,en;q=0.9',
      },
    })

    if (!response.ok) {
      res.status(502).json({
        error: `The page returned ${response.status} ${response.statusText || ''}`.trim() +
          '. Many sites block automated fetches - paste the text into the Text tab instead.',
      })
      return
    }

    const contentType = response.headers.get('content-type') ?? ''
    if (contentType && !/text\/html|text\/plain|application\/xhtml/i.test(contentType)) {
      res.status(415).json({ error: `That URL returned ${contentType.split(';')[0]}, not a web page.` })
      return
    }

    const buffer = await response.arrayBuffer()
    if (buffer.byteLength > MAX_BYTES) {
      res.status(413).json({ error: 'That page is too large to analyse. Paste the relevant section instead.' })
      return
    }
    const html = new TextDecoder('utf-8').decode(buffer)
    const { title, text } = /text\/plain/i.test(contentType)
      ? { title: '', text: html.trim() }
      : htmlToStructuredText(html)

    if (text.replace(/\s/g, '').length < 200) {
      res.status(422).json({
        error:
          'Fetched the page but found almost no readable text - it is probably rendered by JavaScript. Paste the text into the Text tab instead.',
      })
      return
    }

    res.status(200).json({ title, text, chars: text.length, url: response.url || url.toString() })
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError'
    res.status(504).json({
      error: aborted
        ? 'The page took too long to respond. Try again, or paste the text into the Text tab.'
        : 'Could not reach that URL. Check the address, or paste the text into the Text tab.',
    })
  } finally {
    clearTimeout(timer)
  }
}
