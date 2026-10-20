import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  BoardController,
  BoardError,
  boardSchema,
  initialBoard,
} from '../lib/types/host/board.js'
import {
  dependenciesProblem,
  dependencyCandidates,
  dependencyNote,
  invalidatedSuccessors,
  resourceKeyProblem,
  resourceKeysProblem,
  resolveLanes,
} from '../lib/types/contract/coordination.js'
function fixture() {
  let data = initialBoard(),
    id = 0,
    clock = 1000
  const env = {
    workspaces: () => [
      { id: 'ws', path: '/tmp/ws', sessionIds: ['a', 'b', 'c'] },
      { id: 'other', path: '/tmp/other', sessionIds: ['d'] },
    ],
    now: () => ++clock,
    id: () => `task-${++id}`,
  }
  const persistence = {
    get: () => data,
    set: async (value) => {
      data = value
    },
  }
  return {
    controller: new BoardController(persistence, env),
    persistence,
    env,
    data: () => data,
  }
}
const task = (extra = {}) => ({
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
async function complete(controller, created, session = 'a') {
  const claimed = await controller.claim(session, {
    requestId: crypto.randomUUID(),
    taskId: created.id,
  })
  const reported = await controller.report(session, {
    requestId: crypto.randomUUID(),
    taskId: created.id,
    expectedVersion: claimed.version,
    evidence: 'verified evidence',
  })
  const checked = await controller.update({
    requestId: crypto.randomUUID(),
    id: created.id,
    expectedVersion: reported.version,
    action: 'edit',
    checked: reported.criteria.map(() => true),
  })
  return controller.update({
    requestId: crypto.randomUUID(),
    id: created.id,
    expectedVersion: checked.version,
    action: 'accept',
  })
}
test('resource keys are namespace:value, case-sensitive, bounded and unique', () => {
  for (const key of [
    'file:src/index.ts',
    'port:3000',
    'build:dist dir',
    'db:main',
    'branch:main',
    'custom:Value With Spaces',
  ])
    assert.equal(resourceKeyProblem(key), null, key)
  for (const key of [
    '',
    'file',
    ':value',
    '1port:3000',
    'file:',
    ' file:x',
    'file:x ',
    'file:value\u0000',
    `file:${'x'.repeat(124)}`,
  ])
    assert.notEqual(resourceKeyProblem(key), null, String(key))
  assert.equal(resourceKeyProblem('file:X'), null)
  // Keys are case-sensitive: these are distinct, while exact duplicates fail.
  assert.equal(resourceKeysProblem(['file:x', 'file:X']), null)
  assert.notEqual(
    resourceKeysProblem(Array.from({ length: 9 }, (_, index) => `file:${index}`)),
    null,
  )
  assert.notEqual(resourceKeysProblem(['file:x', 'file:x']), null)
})
test('Host rejects self, unknown, cross-workspace, archived and cyclic dependencies', async () => {
  const { controller: c } = fixture()
  const base = await c.create(task())
  const other = await c.create(task({ workspaceId: 'other' }))
  await assert.rejects(
    c.create(task({ dependencies: ['missing'] })),
    /not a known task/,
  )
  await assert.rejects(
    c.create(task({ dependencies: [other.id] })),
    /another workspace/,
  )
  await assert.rejects(
    c.update({
      requestId: crypto.randomUUID(),
      id: base.id,
      expectedVersion: base.version,
      action: 'edit',
      dependencies: [base.id],
    }),
    /cannot depend on itself/,
  )
  const second = await c.create(task())
  const linked = await c.update({
    requestId: crypto.randomUUID(),
    id: second.id,
    expectedVersion: second.version,
    action: 'edit',
    dependencies: [base.id],
  })
  assert.deepEqual(linked.dependencies, [base.id])
  await assert.rejects(
    c.update({
      requestId: crypto.randomUUID(),
      id: base.id,
      expectedVersion: base.version,
      action: 'edit',
      dependencies: [second.id],
    }),
    /cycle/,
  )
  const third = await c.create(task())
  await c.update({
    requestId: crypto.randomUUID(),
    id: third.id,
    expectedVersion: third.version,
    action: 'edit',
    dependencies: [second.id],
  })
  await assert.rejects(
    c.update({
      requestId: crypto.randomUUID(),
      id: base.id,
      expectedVersion: base.version,
      action: 'edit',
      dependencies: [third.id],
    }),
    /cycle/,
  )
  const archived = await c.create(task())
  const back = await c.update({
    requestId: crypto.randomUUID(),
    id: archived.id,
    expectedVersion: archived.version,
    action: 'archive',
  })
  await assert.rejects(
    c.create(task({ dependencies: [back.id] })),
    /archived/,
  )
  assert.equal(dependencyCandidates(c.snapshot().tasks, 'ws', null).some((t) => t.id === archived.id), false)
})
test('dependency gates claim and the last completion unlocks the successor in the same commit', async () => {
  const { controller: c } = fixture()
  const dependency = await c.create(task())
  const successor = await c.create(task({ dependencies: [dependency.id] }))
  assert.equal(c.eligible('ws').some((t) => t.id === successor.id), false)
  await assert.rejects(
    c.claim('b', { requestId: crypto.randomUUID(), taskId: successor.id }),
    /Dependencies are not complete/,
  )
  await complete(c, dependency)
  const after = c.snapshot()
  assert.equal(after.tasks.find((t) => t.id === dependency.id).status, 'done')
  assert.equal(c.eligible('ws').some((t) => t.id === successor.id), true)
  const claimed = await c.claim('b', {
    requestId: crypto.randomUUID(),
    taskId: successor.id,
  })
  assert.equal(claimed.status, 'in-progress')
})
test('same resource key stays serial, priority cannot jump an earlier runnable task, empty keys are disjoint', async () => {
  const { controller: c } = fixture()
  const early = await c.create(task({ priority: 0, resourceKeys: ['file:src'] }))
  const late = await c.create(task({ priority: 2, resourceKeys: ['file:src'] }))
  const independent = await c.create(task({ priority: 2 }))
  const first = await c.claim('a', {
    requestId: crypto.randomUUID(),
    taskId: early.id,
  })
  assert.equal(first.id, early.id)
  assert.equal(first.status, 'in-progress')
  await assert.rejects(
    c.claim('b', { requestId: crypto.randomUUID(), taskId: late.id }),
    /Resource file:src is held/,
  )
  assert.equal(c.eligible('ws').some((t) => t.id === late.id), false)
  // The same Session cannot claim another task, but another Session can claim
  // an independent (empty-key) task concurrently.
  const other = await c.claim('b', { requestId: crypto.randomUUID() })
  assert.equal(other.id, independent.id)
  await c.update({
    requestId: crypto.randomUUID(),
    id: early.id,
    expectedVersion: first.version,
    action: 'move',
    status: 'todo',
  })
  const again = await c.claim('c', { requestId: crypto.randomUUID() })
  assert.equal(again.id, early.id)
})
test('an earlier same-key task that cannot run does not block a later candidate', async () => {
  const { controller: c } = fixture()
  const blocker = await c.create(task())
  const early = await c.create(task({
    priority: 0,
    resourceKeys: ['port:3000'],
    dependencies: [blocker.id],
  }))
  const late = await c.create(task({ priority: 2, resourceKeys: ['port:3000'] }))
  const claimed = await c.claim('b', { requestId: crypto.randomUUID() })
  assert.equal(claimed.id, late.id)
  assert.equal(c.eligible('ws').some((t) => t.id === early.id), false)
})
test('blocked, archived and reopened dependencies persist blocked successors with a stable note', async () => {
  const { controller: c } = fixture()
  const root = await c.create(task())
  const middle = await c.create(task({ dependencies: [root.id] }))
  const leaf = await c.create(task({ dependencies: [middle.id] }))
  const blocked = await c.update({
    requestId: crypto.randomUUID(),
    id: root.id,
    expectedVersion: root.version,
    action: 'move',
    status: 'blocked',
  })
  const state = c.snapshot()
  const blockedMiddle = state.tasks.find((t) => t.id === middle.id)
  const blockedLeaf = state.tasks.find((t) => t.id === leaf.id)
  assert.equal(blocked.status, 'blocked')
  assert.equal(blockedMiddle.status, 'blocked')
  assert.equal(blockedLeaf.status, 'blocked')
  assert.equal(blockedMiddle.automationNote, dependencyNote(root.id, 'blocked'))
  assert.equal(blockedLeaf.automationNote, dependencyNote(root.id, 'blocked'))
  const retried = await c.update({
    requestId: crypto.randomUUID(),
    id: middle.id,
    expectedVersion: blockedMiddle.version,
    action: 'retry',
  })
  assert.equal(retried.status, 'todo')
  assert.equal(retried.automationNote, '')
  assert.equal(c.snapshot().tasks.find((t) => t.id === leaf.id).status, 'blocked')
  const archived = await c.update({
    requestId: crypto.randomUUID(),
    id: root.id,
    expectedVersion: blocked.version,
    action: 'archive',
  })
  assert.equal(archived.archived, true)
  assert.equal(
    c.snapshot().tasks.find((t) => t.id === leaf.id).automationNote,
    dependencyNote(root.id, 'archived'),
  )
})
test('a running successor keeps running when a dependency is reopened, while later work is blocked', async () => {
  const { controller: c } = fixture()
  const root = await complete(c, await c.create(task()), 'a')
  const middle = await c.create(task({ dependencies: [root.id] }))
  const leaf = await c.create(task({ dependencies: [middle.id] }))
  const running = await c.claim('b', {
    requestId: crypto.randomUUID(),
    taskId: middle.id,
  })
  const reopened = await c.update({
    requestId: crypto.randomUUID(),
    id: root.id,
    expectedVersion: root.version,
    action: 'move',
    status: 'todo',
  })
  const state = c.snapshot()
  assert.equal(reopened.status, 'todo')
  assert.equal(state.tasks.find((t) => t.id === middle.id).status, 'in-progress')
  assert.equal(state.tasks.find((t) => t.id === leaf.id).status, 'blocked')
  assert.equal(
    state.tasks.find((t) => t.id === leaf.id).automationNote,
    dependencyNote(root.id, 'todo'),
  )
  // The running successor was never rewritten by the invalidation commit.
  assert.equal(state.tasks.find((t) => t.id === middle.id).version, running.version)
})
test('coordination suggestions are machine readable, validated and never written to the task', async () => {
  const { controller: c } = fixture()
  const other = await c.create(task())
  const analyzed = await c.create(task({ intake: true, criteria: [] }))
  const analysis = (extra = {}) => ({
    summary: 'Plan',
    plan: ['Inspect'],
    risk: 'low',
    route: 'express',
    questions: [],
    coordination: {
      dependencies: [],
      resourceKeys: ['file:src/index.ts'],
      dependencyOrder: [analyzed.id, other.id],
      resourceConflicts: [{ key: 'file:src/index.ts', taskIds: [other.id] }],
      isolation: 'workspace',
      mergeRisk: 'low',
      ...extra,
    },
  })
  const reanalyze = async () => {
    const current = c.snapshot().tasks.find((t) => t.id === analyzed.id)
    const moved = await c.update({
      requestId: crypto.randomUUID(),
      id: analyzed.id,
      expectedVersion: current.version,
      action: 'move',
      status: 'triage',
    })
    return c.beginAnalysis('a', analyzed.id, moved.version)
  }
  let bound = await c.beginAnalysis('a', analyzed.id, analyzed.version)
  const valid = await c.triage('a', {
    requestId: crypto.randomUUID(),
    taskId: analyzed.id,
    expectedVersion: bound.version,
    criteria: ['Verified result'],
    analysis: analysis(),
  })
  assert.deepEqual(valid.analysis.coordination.resourceKeys, ['file:src/index.ts'])
  assert.deepEqual(valid.dependencies, [])
  assert.deepEqual(valid.resourceKeys, [])
  // A new analysis starts from an explicit return to triage.
  bound = await reanalyze()
  await assert.rejects(
    c.triage('a', {
      requestId: crypto.randomUUID(),
      taskId: analyzed.id,
      expectedVersion: bound.version,
      criteria: ['Verified result'],
      analysis: analysis({ dependencies: [analyzed.id] }),
    }),
    /cannot depend on itself/,
  )
  bound = await reanalyze()
  await assert.rejects(
    c.triage('a', {
      requestId: crypto.randomUUID(),
      taskId: analyzed.id,
      expectedVersion: bound.version,
      criteria: ['Verified result'],
      analysis: analysis({ dependencies: ['missing'] }),
    }),
    /not a known task/,
  )
  bound = await reanalyze()
  const cyclic = await c.update({
    requestId: crypto.randomUUID(),
    id: other.id,
    expectedVersion: other.version,
    action: 'edit',
    dependencies: [analyzed.id],
  })
  await assert.rejects(
    c.triage('a', {
      requestId: crypto.randomUUID(),
      taskId: analyzed.id,
      expectedVersion: bound.version,
      criteria: ['Verified result'],
      analysis: analysis({ dependencies: [cyclic.id] }),
    }),
    /cycle/,
  )
})
test('lanes persist per workspace, default to 2, reject invalid values and dedupe requests', async () => {
  const f = fixture()
  assert.equal(f.controller.lanes('ws'), 2)
  assert.equal(f.controller.lanes('other'), 2)
  const first = await f.controller.setLanes({
    requestId: 'lanes-1',
    workspaceId: 'ws',
    lanes: 4,
  })
  assert.equal(first.lanes, 4)
  assert.equal(f.controller.lanes('ws'), 4)
  const replay = await f.controller.setLanes({
    requestId: 'lanes-1',
    workspaceId: 'ws',
    lanes: 4,
  })
  assert.equal(replay.revision, first.revision)
  await assert.rejects(
    f.controller.setLanes({
      requestId: 'lanes-1',
      workspaceId: 'ws',
      lanes: 3,
    }),
    /already used/,
  )
  for (const lanes of [0, 5, 2.5]) {
    await assert.rejects(async () =>
      f.controller.setLanes({
        requestId: crypto.randomUUID(),
        workspaceId: 'ws',
        lanes,
      }),
    )
  }
  const restarted = new BoardController(f.persistence, f.env)
  assert.equal(restarted.lanes('ws'), 4)
  assert.equal(restarted.lanes('other'), 2)
  assert.equal(restarted.snapshot().settings.workspaces.ws.lanes, 4)
})
test('legacy boards and tasks migrate with empty dependencies, default lanes and tolerated unknown fields', async () => {
  const { controller: c } = fixture()
  const created = await c.create(task())
  const raw = structuredClone(c.snapshot())
  delete raw.settings
  delete raw.settingsReceipts
  raw.extraWireField = { tolerated: true }
  const stored = raw.tasks[0]
  delete stored.dependencies
  delete stored.resourceKeys
  stored.unknownTaskField = 'keep readable'
  stored.analysis = {
    summary: 'Legacy',
    plan: ['Plan'],
    risk: 'low',
    route: 'express',
    questions: [],
    // A newer additive field and a newer coordination field must not make the
    // persisted record unreadable.
    futureAnalysisField: 'tolerated',
    coordination: {
      dependencies: [],
      resourceKeys: [],
      dependencyOrder: [],
      resourceConflicts: [
        {
          key: 'file:src/index.ts',
          taskIds: [],
          futureNestedConflictField: 'tolerated',
        },
      ],
      isolation: 'none',
      mergeRisk: 'low',
      futureCoordinationField: true,
    },
  }
  const legacyAnalysis = structuredClone(stored)
  legacyAnalysis.id = 'legacy-no-coordination'
  legacyAnalysis.analysis = {
    summary: 'Legacy',
    plan: ['Plan'],
    risk: 'low',
    route: 'express',
    questions: [],
  }
  raw.tasks.push(legacyAnalysis)
  const parsed = boardSchema.parse(raw)
  assert.deepEqual(parsed.tasks[0].dependencies, [])
  assert.deepEqual(parsed.tasks[0].resourceKeys, [])
  assert.equal(parsed.tasks[0].analysis.coordination.isolation, 'none')
  assert.equal(parsed.tasks[1].analysis.coordination, null)
  assert.deepEqual(parsed.settings, { workspaces: {} })
  assert.deepEqual(parsed.settingsReceipts, [])
  assert.equal(resolveLanes(parsed.settings.workspaces.ws?.lanes), 2)
  let data = raw
  const legacy = new BoardController(
    {
      get: () => data,
      set: async (value) => {
        data = value
      },
    },
    {
      workspaces: () => [
        { id: 'ws', path: '/tmp', sessionIds: ['a', 'b', 'c'] },
        { id: 'other', path: '/tmp', sessionIds: ['d'] },
      ],
      now: Date.now,
      id: () => 'new-task',
    },
  )
  assert.equal(legacy.lanes('ws'), 2)
  assert.deepEqual(legacy.snapshot().tasks[0].dependencies, [])
  await legacy.setLanes({
    requestId: 'migrate',
    workspaceId: 'ws',
    lanes: 3,
  })
  assert.equal(legacy.lanes('ws'), 3)
  // Commands stay strict even though persisted records tolerate unknown fields.
  await assert.rejects(async () =>
    legacy.create({ ...task(), unexpected: true }),
  )
  await assert.rejects(async () =>
    legacy.update({
      requestId: crypto.randomUUID(),
      id: created.id,
      expectedVersion: 1,
      action: 'edit',
      unexpected: true,
    }),
  )
})
test('invalidatedSuccessors traverses indirect descendants deterministically', () => {
  const tasks = [
    { id: 'a', workspaceId: 'ws', status: 'blocked', archived: false, dependencies: [], createdAt: 1 },
    { id: 'b', workspaceId: 'ws', status: 'in-progress', archived: false, dependencies: ['a'], createdAt: 2 },
    { id: 'c', workspaceId: 'ws', status: 'todo', archived: false, dependencies: ['b'], createdAt: 3 },
    { id: 'd', workspaceId: 'ws', status: 'triage', archived: false, dependencies: ['c'], createdAt: 4 },
    { id: 'e', workspaceId: 'ws', status: 'done', archived: false, dependencies: ['a'], createdAt: 5 },
  ]
  const found = invalidatedSuccessors('a', 'blocked', tasks)
  assert.deepEqual(
    found.map((item) => item.taskId),
    ['c', 'd'],
  )
  assert.deepEqual(dependenciesProblem('x', ['b'], tasks, 'ws'), null)
  assert.notEqual(
    dependenciesProblem('a', ['c'], tasks, 'ws'),
    null,
  )
  assert.equal(dependencyNote('a', 'archived'), 'dependency-invalidated:a:archived')
})
test('BoardError exposes stable coordination codes', () => {
  const error = new BoardError('dependency-cycle', 'cycle')
  assert.equal(error.code, 'dependency-cycle')
})
