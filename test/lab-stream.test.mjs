/** Stepped transport replay and persistence using the production controller fixture host. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
test('SSE reconnect replays ordered committed frames; stale commands never create a frame', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'perse-stream-test-')),
    child = spawn(process.execPath, ['sim/lab/server.mjs'], {
      env: { ...process.env, PERSE_LAB_STATE: folder },
      stdio: ['ignore', 'ignore', 'pipe'],
    })
  let error = ''
  child.stderr.on('data', (c) => (error += c))
  try {
    let runtime
    for (let i = 0; i < 100; i++) {
      try {
        runtime = JSON.parse(
          await readFile(path.join(folder, 'runtime.json'), 'utf8'),
        )
        break
      } catch {}
      await delay(10)
    }
    assert.ok(runtime, error)
    const api = async (route, body) => {
      const response = await fetch(
        runtime.url + route,
        body ? { method: 'POST', body: JSON.stringify(body) } : {},
      )
      return { status: response.status, value: await response.json() }
    }
    await api('/control', { scenario: 'empty' })
    const first = (await api('/data')).value.sequence
    const created = (
      await api('/command/create', {
        requestId: 'replay-create',
        workspaceId: 'alpha',
        title: 'Replay',
        description: '',
        criteria: ['criterion'],
        priority: 1,
        assignee: null,
      })
    ).value.value
    await api('/command/update', {
      requestId: 'replay-edit',
      id: created.id,
      expectedVersion: created.version,
      action: 'edit',
      title: 'Replayed title',
    })
    const before = (await api('/data')).value
    const stale = await api('/command/update', {
      requestId: 'stale',
      id: created.id,
      expectedVersion: 1,
      action: 'edit',
      title: 'invalid',
    })
    assert.equal(stale.status, 409)
    assert.equal(
      (await api('/data')).value.snapshot.revision,
      before.snapshot.revision,
    )
    const abort = new AbortController(),
      response = await fetch(runtime.url + '/events', {
        headers: { 'last-event-id': String(first) },
        signal: abort.signal,
      }),
      reader = response.body.getReader()
    let text = ''
    while (!text.includes('Replayed title')) {
      const chunk = await reader.read()
      text += new TextDecoder().decode(chunk.value)
    }
    abort.abort()
    const frames = text
      .split('\n\n')
      .filter(Boolean)
      .map((frame) => ({
        id: Number(frame.match(/id: (\d+)/)[1]),
        data: JSON.parse(frame.match(/data: (.*)/)[1]),
      }))
    assert.ok(frames.length >= 2)
    assert.ok(
      frames.every((f, i) => f.id > first && (!i || f.id > frames[i - 1].id)),
    )
    assert.equal(frames.at(-1).data.snapshot.tasks[0].title, 'Replayed title')
    await api('/control', { action: 'restart' })
    const restored = (await api('/data')).value
    assert.deepEqual(restored.snapshot.tasks, before.snapshot.tasks)
    assert.equal(restored.snapshot.dispatch.enabled, false)
  } finally {
    child.kill('SIGTERM')
    await new Promise((resolve) => child.once('exit', resolve))
    await rm(folder, { recursive: true, force: true })
  }
})
