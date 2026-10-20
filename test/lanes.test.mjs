import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  BoardController,
  initialBoard,
} from '../lib/types/host/board.js'
import { Dispatcher } from '../lib/types/host/dispatch.js'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function waitFor(predicate, label = 'condition', timeout = 2500) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = await predicate()
    if (value) return value
    await sleep(5)
  }
  throw Error(`Timed out waiting for ${label}`)
}
const request = (extra = {}) => ({
  requestId: crypto.randomUUID(),
  workspaceId: 'ws',
  title: 'Task',
  description: 'Implement',
  criteria: ['Verified'],
  priority: 1,
  assignee: null,
  intake: false,
  ...extra,
})
function harness() {
  let data = initialBoard(),
    clock = 1000
  const workspaceSessions = ['owner']
  const prompts = []
  let created = 0
  let failure = null
  const board = new BoardController(
    {
      get: () => data,
      set: async (value) => {
        data = value
      },
    },
    {
      workspaces: () => [
        { id: 'ws', path: '/tmp/ws', sessionIds: workspaceSessions },
      ],
      now: () => ++clock,
      id: () => crypto.randomUUID(),
    },
  )
  const taskForSession = (sessionId) =>
    board
      .snapshot()
      .tasks.find(
        (task) =>
          (task.sessionId === sessionId && task.status === 'in-progress') ||
          (task.analysisSessionId === sessionId && task.status === 'triage'),
      )
  const entryFor = (taskId, phase) =>
    prompts.find(
      (prompt) =>
        prompt.taskId === taskId &&
        (!phase || prompt.phase === phase) &&
        prompt.state === 'waiting',
    )
  const runtime = {
    create: async () => {
      const id = `session-${++created}`
      workspaceSessions.push(id)
      return id
    },
    running: () => false,
    readImage: async () => new Uint8Array(),
    imageRoute: async () => ({
      provider: 'test',
      model: 'test',
      images: true,
    }),
    prompt: (sessionId, content) => {
      const text = content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('\n')
      const phase =
        text.match(/PERSE_PHASE=(analysis|execution|review)/)?.[1] ??
        'execution'
      const fact = text.match(/^TASK_DATA=(.+)$/m)?.[1]
      const taskId = fact ? JSON.parse(fact).taskId : undefined
      const entry = {
        sessionId,
        phase,
        taskId,
        text,
        state: 'waiting',
      }
      prompts.push(entry)
      if (failure === taskId)
        return new Promise((_resolve, reject) => {
          entry.reject = reject
          entry.state = 'rejected'
          reject(Error('transport unavailable'))
        })
      return new Promise((resolve) => {
        entry.resolve = () => {
          entry.state = 'released'
          resolve()
        }
      })
    },
    idle: async (sessionId) => {
      const entry = prompts.filter((prompt) => prompt.sessionId === sessionId).at(-1)
      const task = entry ? taskForSession(sessionId) : undefined
      if (!task) return
      if (entry.phase === 'analysis') {
        await board.triage(sessionId, {
          requestId: crypto.randomUUID(),
          taskId: task.id,
          expectedVersion: task.version,
          criteria: task.criteria.length ? task.criteria : ['Generated'],
          analysis: {
            summary: 'Analysis',
            plan: ['Plan'],
            risk: 'low',
            route: 'express',
            questions: [],
            coordination: {
              dependencies: [],
              resourceKeys: [],
              dependencyOrder: [task.id],
              resourceConflicts: [],
              isolation: 'workspace',
              mergeRisk: 'low',
            },
          },
        })
      } else {
        await board.report(sessionId, {
          requestId: crypto.randomUUID(),
          taskId: task.id,
          expectedVersion: task.version,
          evidence: 'verified evidence',
        })
      }
    },
  }
  const dispatcher = new Dispatcher(
    board,
    runtime,
    () => {},
    async () => {},
  )
  return {
    board,
    dispatcher,
    prompts,
    setFailure: (taskId) => {
      failure = taskId
    },
    release: (taskId, phase) => {
      const entry = entryFor(taskId, phase)
      if (!entry) throw Error(`No waiting prompt for ${taskId}/${phase}`)
      entry.resolve()
      return entry
    },
    async accept(taskId) {
      const task = board.snapshot().tasks.find((candidate) => candidate.id === taskId)
      const checked = await board.update({
        requestId: crypto.randomUUID(),
        id: taskId,
        expectedVersion: task.version,
        action: 'edit',
        checked: task.criteria.map(() => true),
      })
      return board.update({
        requestId: crypto.randomUUID(),
        id: taskId,
        expectedVersion: checked.version,
        action: 'accept',
      })
    },
    task: (id) => board.snapshot().tasks.find((task) => task.id === id),
  }
}
async function create(harness, extra = {}) {
  return harness.board.create(request(extra))
}
test('two lanes run concurrently without exceeding the persisted lane count', async () => {
  const h = harness()
  await h.board.setLanes({
    requestId: 'lanes',
    workspaceId: 'ws',
    lanes: 2,
  })
  const first = await create(h)
  const second = await create(h)
  h.dispatcher.configure('ws', true)
  await waitFor(
    () =>
      h.prompts.filter((prompt) => prompt.phase === 'execution').length === 2,
    'two execution prompts',
  )
  const snapshot = h.dispatcher.snapshot()
  assert.equal(snapshot.lanes, 2)
  assert.equal(snapshot.active.length, 2)
  assert.deepEqual(
    new Set(snapshot.active.map((slot) => slot.taskId)),
    new Set([first.id, second.id]),
  )
  h.release(first.id)
  h.release(second.id)
  await waitFor(
    () => [first.id, second.id].every((id) => h.task(id).status === 'in-review'),
    'both reports',
  )
  assert.equal(h.prompts.length, 2)
  await waitFor(() => h.dispatcher.snapshot().enabled === false, 'idle queue')
})
test('lanes=1 serializes independent execution', async () => {
  const h = harness()
  await h.board.setLanes({
    requestId: 'lanes',
    workspaceId: 'ws',
    lanes: 1,
  })
  const first = await create(h)
  const second = await create(h)
  h.dispatcher.configure('ws', true)
  await waitFor(
    () => h.prompts.filter((prompt) => prompt.phase === 'execution').length === 1,
    'first execution prompt',
  )
  await sleep(80)
  assert.equal(
    h.prompts.filter((prompt) => prompt.phase === 'execution').length,
    1,
  )
  assert.equal(h.dispatcher.snapshot().active.length, 1)
  const running = h.dispatcher.snapshot().active[0].taskId
  h.release(running)
  await waitFor(
    () =>
      h.dispatcher.snapshot().active.length === 1 &&
      h.dispatcher.snapshot().active[0].taskId !== running,
    'second lane after the first report',
  )
  const next = h.dispatcher.snapshot().active[0].taskId
  h.release(next)
  await waitFor(
    () => [first.id, second.id].every((id) => h.task(id).status === 'in-review'),
    'both reports',
  )
})
test('the same resource key never runs concurrently even with free lanes', async () => {
  const h = harness()
  await h.board.setLanes({
    requestId: 'lanes',
    workspaceId: 'ws',
    lanes: 2,
  })
  const first = await create(h, { resourceKeys: ['file:src/index.ts'] })
  const second = await create(h, { resourceKeys: ['file:src/index.ts'] })
  h.dispatcher.configure('ws', true)
  await waitFor(
    () => h.prompts.filter((prompt) => prompt.phase === 'execution').length === 1,
    'first key holder',
  )
  await sleep(80)
  assert.equal(
    h.prompts.filter((prompt) => prompt.phase === 'execution').length,
    1,
  )
  const running = h.dispatcher.snapshot().active[0].taskId
  assert.equal(running, first.id)
  h.release(running)
  await waitFor(
    () =>
      h.dispatcher.snapshot().active.length === 1 &&
      h.dispatcher.snapshot().active[0].taskId === second.id,
    'second key holder after release',
  )
  h.release(second.id)
  await waitFor(
    () => h.task(second.id).status === 'in-review',
    'second report',
  )
})
test('dependent work is admitted only after the last dependency is done', async () => {
  const h = harness()
  await h.board.setLanes({
    requestId: 'lanes',
    workspaceId: 'ws',
    lanes: 2,
  })
  const dependency = await create(h)
  const successor = await create(h, { dependencies: [dependency.id] })
  // Watch keeps the queue alive across the independent review/accept step; the
  // dependency gate itself is what prevents the successor from starting early.
  h.dispatcher.configure('ws', true, { watch: true })
  await waitFor(
    () => h.prompts.some((prompt) => prompt.taskId === dependency.id),
    'dependency execution',
  )
  await sleep(80)
  assert.equal(
    h.prompts.some((prompt) => prompt.taskId === successor.id),
    false,
  )
  h.release(dependency.id)
  await waitFor(() => h.task(dependency.id).status === 'in-review', 'dependency report')
  await h.accept(dependency.id)
  await waitFor(
    () => h.prompts.some((prompt) => prompt.taskId === successor.id),
    'successor execution after completion',
  )
  h.release(successor.id)
  await waitFor(() => h.task(successor.id).status === 'in-review', 'successor report')
})
test('one lane failure blocks only its task while another running lane finishes', async () => {
  const h = harness()
  await h.board.setLanes({
    requestId: 'lanes',
    workspaceId: 'ws',
    lanes: 2,
  })
  const failing = await create(h)
  const healthy = await create(h)
  h.setFailure(failing.id)
  h.dispatcher.configure('ws', true)
  await waitFor(
    () => h.prompts.some((prompt) => prompt.taskId === healthy.id),
    'healthy execution prompt',
  )
  await waitFor(() => h.task(failing.id).status === 'blocked', 'failing task blocked')
  assert.equal(h.task(healthy.id).status, 'in-progress')
  assert.match(h.dispatcher.snapshot().error, /transport unavailable/)
  assert.equal(h.dispatcher.snapshot().enabled, false)
  h.release(healthy.id)
  await waitFor(() => h.task(healthy.id).status === 'in-review', 'healthy report')
  assert.match(h.task(failing.id).evidence, /transport unavailable/)
  assert.equal(h.task(failing.id).completion, null)
})
test('a stale in-progress claim keeps its lane and key and is never replayed', async () => {
  const h = harness()
  const stale = await create(h, {
    resourceKeys: ['port:3000'],
    assignee: 'owner',
  })
  const claimed = await h.board.claim('owner', {
    requestId: crypto.randomUUID(),
    taskId: stale.id,
  })
  assert.equal(claimed.status, 'in-progress')
  const waiting = await create(h, { resourceKeys: ['port:3000'] })
  const independentOne = await create(h)
  const independentTwo = await create(h)
  h.dispatcher.configure('ws', true)
  await sleep(120)
  // The stale claim owns one of the two lanes and the key; only one independent
  // task may start, and the stale Session is never prompted again.
  assert.equal(h.prompts.length, 1)
  assert.equal(h.dispatcher.snapshot().active.length, 1)
  assert.notEqual(h.prompts[0].taskId, stale.id)
  h.release(h.prompts[0].taskId)
  await waitFor(() => h.task(h.prompts[0].taskId).status === 'in-review', 'independent report')
  const state = h.board.snapshot()
  assert.equal(state.tasks.find((task) => task.id === stale.id).status, 'in-progress')
  assert.equal(state.tasks.find((task) => task.id === waiting.id).status, 'todo')
  // Owner recovery uses the existing retry command; it releases the key.
  await h.board.update({
    requestId: crypto.randomUUID(),
    id: stale.id,
    expectedVersion: claimed.version,
    action: 'retry',
  })
  h.dispatcher.configure('ws', true)
  await waitFor(
    () => h.prompts.some((prompt) => prompt.taskId === stale.id),
    'recovered task starts once',
  )
  const recoveredPrompt = h.prompts.find((prompt) => prompt.taskId === stale.id)
  // The retried task keeps its owner-selected assignee; this still proves no
  // old claim was replayed because no prompt existed for it before the retry.
  assert.equal(recoveredPrompt.sessionId, 'owner')
})
test('analysis is globally serial, shares the manual gate, and does not block execution lanes', async () => {
  const h = harness()
  await h.board.setLanes({
    requestId: 'lanes',
    workspaceId: 'ws',
    lanes: 2,
  })
  const analysisTask = await create(h, { intake: true, criteria: [] })
  const executionTask = await create(h)
  h.dispatcher.analysis.acquire('manual-analysis')
  h.dispatcher.configure('ws', true)
  await waitFor(
    () => h.prompts.some((prompt) => prompt.taskId === executionTask.id),
    'execution continues under the manual analysis gate',
  )
  await sleep(80)
  assert.equal(
    h.prompts.some(
      (prompt) =>
        prompt.taskId === analysisTask.id && prompt.phase === 'analysis',
    ),
    false,
  )
  h.dispatcher.analysis.release('manual-analysis')
  h.dispatcher.wake()
  await waitFor(
    () => h.prompts.some((prompt) => prompt.phase === 'analysis'),
    'queued analysis after gate release',
  )
  const analyses = h.prompts.filter((prompt) => prompt.phase === 'analysis')
  assert.equal(analyses.length, 1)
  h.release(analysisTask.id, 'analysis')
  await waitFor(
    () =>
      h.prompts.some(
        (prompt) =>
          prompt.taskId === analysisTask.id && prompt.phase === 'execution',
      ),
    'analysis result enters execution',
  )
  assert.equal(
    h.prompts.filter((prompt) => prompt.phase === 'analysis').length,
    1,
  )
})
test('maxTasks remains a single activation budget shared by analysis and execution', async () => {
  const h = harness()
  await h.board.setLanes({
    requestId: 'lanes',
    workspaceId: 'ws',
    lanes: 2,
  })
  const analysisTask = await create(h, { intake: true, criteria: [] })
  const executionTask = await create(h)
  h.dispatcher.configure('ws', true, { maxTasks: 1 })
  await waitFor(
    () => h.prompts.filter((prompt) => prompt.phase === 'analysis').length === 1,
    'one analysis activation',
  )
  await sleep(80)
  assert.equal(
    h.prompts.some((prompt) => prompt.taskId === executionTask.id),
    false,
  )
  assert.equal(h.dispatcher.snapshot().processed, 1)
  h.release(analysisTask.id, 'analysis')
  await waitFor(
    () =>
      h.prompts.some(
        (prompt) =>
          prompt.taskId === analysisTask.id && prompt.phase === 'execution',
      ),
    'analyzed task may use its budgeted claim',
  )
  assert.equal(
    h.prompts.some((prompt) => prompt.taskId === executionTask.id),
    false,
  )
})
test('pausing prevents new starts but does not stop or complete in-flight lanes', async () => {
  const h = harness()
  await h.board.setLanes({
    requestId: 'lanes',
    workspaceId: 'ws',
    lanes: 2,
  })
  const first = await create(h)
  const second = await create(h)
  const later = await create(h)
  h.dispatcher.configure('ws', true)
  await waitFor(
    () =>
      h.prompts.filter((prompt) => prompt.phase === 'execution').length === 2,
    'two running lanes before pause',
  )
  h.dispatcher.configure('ws', false)
  await sleep(50)
  assert.equal(h.prompts.length, 2)
  assert.equal(h.task(later.id).status, 'todo')
  h.release(first.id, 'execution')
  h.release(second.id, 'execution')
  await waitFor(
    () => [first.id, second.id].every((id) => h.task(id).status === 'in-review'),
    'in-flight lanes finish after pause',
  )
  assert.equal(h.task(later.id).status, 'todo')
  assert.equal(h.task(first.id).completion, null)
  assert.equal(h.task(second.id).completion, null)
  assert.equal(h.prompts.length, 2)
})

test('automatic analysis is globally serial while execution lanes continue', async () => {
  const h = harness()
  await h.board.setLanes({
    requestId: 'lanes',
    workspaceId: 'ws',
    lanes: 2,
  })
  const first = await create(h, { intake: true, criteria: [] })
  const second = await create(h, { intake: true, criteria: [] })
  h.dispatcher.configure('ws', true, { watch: true })
  await waitFor(
    () =>
      h.prompts.filter(
        (prompt) => prompt.phase === 'analysis' && prompt.state === 'waiting',
      ).length === 1,
    'one analysis at a time',
  )
  assert.equal(
    h.prompts.filter((prompt) => prompt.phase === 'analysis').length,
    1,
  )
  h.release(first.id, 'analysis')
  await waitFor(
    () =>
      h.prompts.some(
        (prompt) => prompt.taskId === first.id && prompt.phase === 'execution',
      ),
    'execution starts while the analysis gate is free',
  )
  await waitFor(
    () =>
      h.prompts.filter((prompt) => prompt.phase === 'analysis').length === 2,
    'second analysis starts only after the first',
  )
  assert.equal(
    h.prompts.filter(
      (prompt) => prompt.phase === 'analysis' && prompt.state === 'waiting',
    ).length,
    1,
  )
  h.release(second.id, 'analysis')
})
test('lowering lanes while tasks are running stops starts without preemption', async () => {
  const h = harness()
  await h.board.setLanes({
    requestId: 'lanes',
    workspaceId: 'ws',
    lanes: 2,
  })
  const first = await create(h)
  const second = await create(h)
  const third = await create(h)
  h.dispatcher.configure('ws', true, { watch: true })
  await waitFor(
    () =>
      h.dispatcher.snapshot().active.filter(
        (slot) => slot.phase === 'execution',
      ).length === 2,
    'two running lanes',
  )
  const active = h.dispatcher.snapshot().active.map((slot) => slot.taskId)
  await h.board.setLanes({
    requestId: 'lanes-low',
    workspaceId: 'ws',
    lanes: 1,
  })
  await sleep(60)
  assert.equal(h.dispatcher.snapshot().active.length, 2)
  h.release(active[0])
  await sleep(60)
  assert.equal(h.dispatcher.snapshot().active.length, 1)
  assert.equal(h.task(third.id).status, 'todo')
  h.release(active[1])
  await waitFor(
    () =>
      h.dispatcher.snapshot().active.some(
        (slot) => slot.taskId === third.id,
      ),
    'one remaining lane starts the queued task',
  )
  assert.equal(h.dispatcher.snapshot().lanes, 1)
})
