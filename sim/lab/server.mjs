/** Loopback-only synthetic fixture host. Never shipped in the production plugin. */
import http from 'node:http'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { makeBackend } from './backend.mjs'
const fixtures = JSON.parse(
  await readFile(
    new URL('../fixtures/scenarios.json', import.meta.url),
    'utf8',
  ),
)
const root = process.env.PERSE_LAB_STATE
if (!root) throw Error('PERSE_LAB_STATE is required')
await mkdir(root, { recursive: true })
let backend,
  scenario = 'dense',
  fault = null,
  generation = 0,
  sequence = 0,
  frames = [],
  clients = new Set(),
  pending = new Set(),
  serial = Promise.resolve()
const json = (res, value, status = 200) => {
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(value))
}
async function payload() {
  let snapshot = await backend.owner.snapshot()
  if (fault === 'partial')
    snapshot.capabilities = {
      create: false,
      update: false,
      dispatch: false,
      analyze: false,
      verify: false,
    }
  if (fault === 'incompatible') snapshot.tasks[0].status = 'future-state'
  return { generation, sequence, scenario, snapshot, ...backend.data() }
}
async function publish() {
  const frame = { id: ++sequence, data: await payload() }
  frames.push(frame)
  frames = frames.slice(-128)
  for (const res of clients)
    res.write(`id: ${frame.id}\ndata: ${JSON.stringify(frame.data)}\n\n`)
}
async function reset(id) {
  const definition = fixtures.scenarios.find((s) => s.id === id)
  if (!definition) throw Error('Unknown scenario')
  if (backend) await backend.close()
  generation++
  scenario = id
  fault = id
  sequence = 0
  frames = []
  const seed = structuredClone(
    definition.seed === 'dense' ? fixtures.dense : [],
  )
  if (id === 'detail-long') {
    seed[0].description = 'Long description. '.repeat(650)
    seed[0].evidence = 'VERIFIED_LONG_EVIDENCE '.repeat(800)
  }
  backend = await makeBackend(path.join(root, String(generation)), {
    seed,
    persist: true,
    scenario: id,
  })
  backend.events.on('change', () => {
    serial = serial.then(publish).catch(console.error)
  })
  await publish()
}
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost')
    if (url.pathname === '/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      })
      clients.add(res)
      req.on('close', () => clients.delete(res))
      const last = Number(req.headers['last-event-id'] ?? 0)
      const replay = frames.filter((f) => f.id > last)
      for (const f of replay)
        res.write(`id: ${f.id}\ndata: ${JSON.stringify(f.data)}\n\n`)
      return
    }
    if (url.pathname === '/data') {
      if (fault === 'first-load') {
        pending.add(res)
        req.on('close', () => pending.delete(res))
        return
      }
      if (fault === 'authentication')
        return json(res, { error: 'Authentication required' }, 401)
      if (fault === 'server-unavailable')
        return json(res, { error: 'Service unavailable' }, 503)
      if (fault === 'network' || fault === 'offline') {
        res.destroy()
        return
      }
      return json(res, await payload())
    }
    if (url.pathname === '/fixtures') return json(res, fixtures)
    if (url.pathname === '/permissions' && req.method === 'GET')
      return json(res, {
        ok: true,
        value: await backend.permissions.loadPermissions(),
      })
    if (req.method === 'POST') {
      let raw = ''
      for await (const chunk of req) {
        raw += chunk
        if (raw.length > 150000) throw Error('Request too large')
      }
      const body = JSON.parse(raw || '{}')
      if (url.pathname === '/permissions')
        return json(res, {
          ok: true,
          value: await backend.permissions.savePermissionDefault(
            body.preset,
            body.revision,
          ),
        })
      if (url.pathname === '/permission-apply/preview')
        return json(res, {
          ok: true,
          value: await backend.permissionPreview(body),
        })
      if (url.pathname === '/permission-apply/apply')
        return json(res, {
          ok: true,
          value: await backend.permissionApply(body),
        })
      if (url.pathname === '/control') {
        if (body.scenario) await reset(body.scenario)
        if (body.action === 'recover') {
          fault = null
          for (const p of pending) json(p, await payload())
          pending.clear()
          await publish()
        }
        if (body.action === 'disconnect') {
          fault = 'offline'
          for (const c of clients) c.end()
          clients.clear()
        }
        if (body.action === 'script') {
          backend.scripts[body.id] = body.script
        }
        if (body.action === 'interaction')
          await backend.setInteraction(body.id, body.kind)
        if (body.action === 'permissions') await backend.permissionControl(body)
        if (body.action === 'release') backend.release(body.id)
        if (body.action === 'claim')
          await backend.board.claim('session-alpha-builder', {
            requestId: crypto.randomUUID(),
            taskId: body.id,
          })
        if (body.action === 'restart') {
          const directory = path.join(root, String(generation))
          await backend.close()
          backend = await makeBackend(directory, { persist: true })
          backend.events.on('change', () => {
            serial = serial.then(publish).catch(console.error)
          })
          await publish()
        }
        return json(res, { ok: true, value: await payload() })
      }
      if (url.pathname.startsWith('/command/')) {
        if (
          [
            'partial',
            'offline',
            'authentication',
            'server-unavailable',
            'network',
            'incompatible',
          ].includes(fault)
        )
          return json(
            res,
            { ok: false, error: 'Commands unavailable in this scenario' },
            503,
          )
        const name = url.pathname.split('/').pop()
        if (
          ![
            'create',
            'update',
            'dispatch',
            'setAutomationLanes',
            'analyze',
            'verify',
            'image',
            'inputImage',
          ].includes(name)
        )
          return json(res, { ok: false, error: 'Unknown command' }, 404)
        if (fault === 'detail-error' && name === 'update')
          return json(
            res,
            { ok: false, error: 'Scripted detail save failure; no commit' },
            503,
          )
        const value = await backend.owner[name](body)
        if (!['image', 'inputImage'].includes(name)) await publish()
        return json(res, { ok: true, value })
      }
    }
    if (url.pathname === '/client.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' })
      return res.end(
        await readFile(new URL('../../.build/lab/client.js', import.meta.url)),
      )
    }
    if (url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html' })
      return res.end(
        '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dashboard Lab</title><div id="root"></div><script type="module" src="/client.js"></script></html>',
      )
    }
    json(res, { error: 'Not found' }, 404)
  } catch (e) {
    if (!res.headersSent)
      json(
        res,
        {
          ok: false,
          error:
            e && typeof e.code === 'string'
              ? `${e.code}: ${e.message}`
              : e.message,
        },
        409,
      )
    else res.end()
  }
})
await reset('dense')
server.listen(Number(process.env.PORT ?? 0), '127.0.0.1', async () => {
  const runtime = {
    pid: process.pid,
    url: `http://127.0.0.1:${server.address().port}`,
    state: root,
  }
  await writeFile(path.join(root, 'runtime.json'), JSON.stringify(runtime))
  console.log(JSON.stringify(runtime))
})
async function stop() {
  for (const c of clients) c.end()
  for (const p of pending) p.end()
  server.close()
  await backend.close()
}
process.once('SIGTERM', () => void stop())
process.once('SIGINT', () => void stop())
