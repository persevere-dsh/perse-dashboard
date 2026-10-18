import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BoardController, initialBoard } from '../lib/types/host/board.js'
import { Dispatcher } from '../lib/types/host/dispatch.js'
async function setup(report = true) {
  let board = initialBoard(),
    id = 0,
    calls = 0
  const c = new BoardController(
    {
      get: () => board,
      set: async (b) => {
        board = b
      },
    },
    {
      workspaces: () => [{ id: 'ws', path: '/tmp', sessionIds: ['a'] }],
      id: () => `t${++id}`,
      now: Date.now,
    },
  )
  for (let n = 0; n < 2; n++)
    await c.create({
      requestId: `r${n}`,
      workspaceId: 'ws',
      title: 'T',
      description: '',
      criteria: ['yes'],
      priority: 1,
      assignee: 'a',
    })
  const d = new Dispatcher(
    c,
    {
      running: () => false,
      create: async () => {
        throw Error('assigned task must reuse session')
      },
      prompt: async () => {
        calls++
      },
      idle: async () => {
        if (report) {
          const t = c.snapshot().tasks.find((t) => t.status === 'in-progress')
          await c.report('a', {
            requestId: `report${calls}`,
            taskId: t.id,
            expectedVersion: t.version,
            evidence: 'passed',
          })
        }
      },
    },
    () => {},
  )
  return { c, d, calls: () => calls }
}
test('bounded native dispatch consumes queue and never auto-accepts', async () => {
  const { c, d, calls } = await setup()
  d.configure('ws', true)
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(calls(), 2)
  assert.ok(c.snapshot().tasks.every((t) => t.status === 'in-review'))
  assert.equal(d.snapshot().enabled, false)
})
test('missing evidence halts the queue and records blocked state', async () => {
  const { c, d, calls } = await setup(false)
  d.configure('ws', true)
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(calls(), 1)
  assert.equal(c.snapshot().tasks[0].status, 'blocked')
  assert.match(d.snapshot().error, /without reporting/)
  assert.equal(c.snapshot().tasks[1].status, 'todo')
})
test('pause prevents starting subsequent work', async () => {
  const { d, calls } = await setup()
  d.configure('ws', true)
  d.configure('ws', false)
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(calls(), 0)
  await d.close()
  assert.throws(() => d.configure('ws', true), /closed/)
})

test('prompt failure blocks the active claim and leaves later tasks queued', async () => {
  let state = initialBoard()
  const c = new BoardController(
    {
      get: () => state,
      set: async (b) => {
        state = b
      },
    },
    {
      workspaces: () => [{ id: 'w', path: '/tmp', sessionIds: ['a'] }],
      now: Date.now,
      id: () => crypto.randomUUID(),
    },
  )
  for (let i = 0; i < 2; i++)
    await c.create({
      requestId: `create-${i}`,
      workspaceId: 'w',
      title: 'T',
      description: '',
      criteria: ['C'],
      priority: 1,
      assignee: 'a',
    })
  const d = new Dispatcher(
    c,
    {
      running: () => false,
      create: async () => {
        throw Error('must reuse assigned Session')
      },
      prompt: async () => {
        throw Error('transport unavailable')
      },
      idle: async () => {},
    },
    () => {},
  )
  d.configure('w', true)
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(c.snapshot().tasks[0].status, 'blocked')
  assert.match(c.snapshot().tasks[0].evidence, /transport unavailable/)
  assert.equal(c.snapshot().tasks[1].status, 'todo')
  assert.match(d.snapshot().error, /transport unavailable/)
})
