import type { IncomingMessage, ServerResponse } from 'node:http'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Plugin, ViteDevServer } from 'vite'

/**
 * Runs the Vercel serverless functions in `api/` inside the Vite dev server so
 * that `npm run dev` behaves like `vercel dev` (no separate process needed).
 * Adapts node's req/res to the small slice of the Vercel API the handlers use.
 */

type Handler = (req: DevRequest, res: DevResponse) => unknown | Promise<unknown>

interface DevRequest extends IncomingMessage {
  query: Record<string, string>
  body: unknown
}

interface DevResponse extends ServerResponse {
  status: (code: number) => DevResponse
  json: (payload: unknown) => DevResponse
  send: (payload: string) => DevResponse
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  if (chunks.length === 0) return undefined
  const raw = Buffer.concat(chunks).toString('utf8')
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return raw
  }
}

export function devApiPlugin(): Plugin {
  return {
    name: 'dev-api-functions',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? ''
        if (!url.startsWith('/api/')) return next()

        const parsed = new URL(url, 'http://localhost')
        const name = parsed.pathname.replace(/^\/api\//, '').replace(/\/$/, '')
        const file = resolve(process.cwd(), 'api', `${name}.ts`)
        if (!name || !existsSync(file)) return next()

        const request = req as DevRequest
        request.query = Object.fromEntries(parsed.searchParams.entries())
        request.body = await readBody(req)

        const response = res as DevResponse
        response.status = (code) => {
          response.statusCode = code
          return response
        }
        response.json = (payload) => {
          response.setHeader('content-type', 'application/json')
          response.end(JSON.stringify(payload))
          return response
        }
        response.send = (payload) => {
          response.end(payload)
          return response
        }

        try {
          const mod = (await server.ssrLoadModule(file)) as { default?: Handler }
          if (typeof mod.default !== 'function') {
            response.status(500).json({ error: `api/${name}.ts has no default export` })
            return
          }
          await mod.default(request, response)
        } catch (error) {
          server.ssrFixStacktrace(error as Error)
          const message = error instanceof Error ? error.message : String(error)
          if (!response.headersSent) response.status(500).json({ error: message })
          else response.end()
        }
      })
    },
  }
}
