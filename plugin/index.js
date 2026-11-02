/**
 * dsh-fireworks host plugin.
 * Serves the fireworks renderer under /dsh-fireworks and publishes the audio
 * feeder's state file as JSON — the browser page cannot read local files, so
 * the host bridges ~/.dsh/fireworks/state.json into the same-origin route.
 */
import { readFile, stat } from 'node:fs/promises'
import { extname, resolve, sep, join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-fireworks'
export const inject = ['webServer']

const ROUTE = '/dsh-fireworks'
const ASSET_ROOT = resolve(fileURLToPath(new URL('../native-dist/', import.meta.url)))
const MIME = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
})

function statePath() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'fireworks', 'state.json')
}

function finish(res, status, headers = {}) {
  res.writeHead(status, {
    'cache-control': 'no-cache',
    'x-content-type-options': 'nosniff',
    ...headers,
  })
  res.end()
}

async function serveState(req, res) {
  const file = statePath()
  let body
  try {
    const info = await stat(file)
    // Feeder considered offline after 4 s without a fresh seq bump.
    const stale = Date.now() - info.mtimeMs > 4000
    body = await readFile(file)
    if (stale) {
      try {
        const data = JSON.parse(body.toString('utf-8'))
        data.stale = true
        body = Buffer.from(JSON.stringify(data), 'utf-8')
      } catch { /* serve raw */ }
    }
  } catch {
    body = Buffer.from(JSON.stringify({
      v: 1, stale: true, ts: 0, seq: 0, bass: -70, treb: -70,
      level: 0, events: [], meta: {},
    }), 'utf-8')
  }
  res.writeHead(200, {
    'cache-control': 'no-store',
    'content-length': String(body.byteLength),
    'content-type': MIME['.json'],
    'x-content-type-options': 'nosniff',
  })
  res.end(req.method === 'HEAD' ? undefined : body)
}

async function serveAsset(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    finish(res, 405, { allow: 'GET, HEAD' })
    return
  }

  let pathname
  try {
    pathname = decodeURIComponent(new URL(req.url ?? ROUTE, 'http://dsh.local').pathname)
  } catch {
    finish(res, 400)
    return
  }

  if (pathname === `${ROUTE}/state.json`) {
    await serveState(req, res)
    return
  }

  const suffix = pathname === ROUTE || pathname === `${ROUTE}/`
    ? 'fireworks.html'
    : pathname.slice(`${ROUTE}/`.length)
  const target = resolve(ASSET_ROOT, suffix)
  if (target !== ASSET_ROOT && !target.startsWith(`${ASSET_ROOT}${sep}`)) {
    finish(res, 403)
    return
  }

  try {
    const body = await readFile(target)
    res.writeHead(200, {
      'cache-control': 'no-cache',
      'content-length': String(body.byteLength),
      'content-type': MIME[extname(target)] ?? 'application/octet-stream',
      'x-content-type-options': 'nosniff',
    })
    res.end(req.method === 'HEAD' ? undefined : body)
  } catch (error) {
    if (error instanceof Error && 'code' in error
      && (error.code === 'ENOENT' || error.code === 'EISDIR')) {
      finish(res, 404)
      return
    }
    throw error
  }
}

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE,
    handler: serveAsset,
  }), 'dsh-fireworks: renderer + feeder state route')
}
