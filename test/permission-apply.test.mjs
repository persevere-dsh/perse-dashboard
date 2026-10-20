import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  permissionApply,
  permissionApplyPreview,
} from '../lib/types/host/permission-apply.js'
import { createPermissionCapability } from '../lib/types/host/permission-capability.js'
const preset = (name) => {
  if (name === 'read-only') return { sandbox: 'read-only', approval: 'ask' }
  if (name === 'workspace-write')
    return { sandbox: 'workspace-write', approval: 'ask' }
  if (name === 'danger-full-access')
    return { sandbox: 'danger-full-access', approval: 'never' }
  return null
}
const environment = (overrides = {}) => ({
  available: true,
  reason: '',
  preset: 'workspace-write',
  presetName: 'Workspace write',
  revision: 7,
  writable: true,
  fullAccessBlocked: false,
  options: [
    { id: 'workspace-write', name: 'Workspace write' },
    { id: 'danger-full-access', name: 'Full access' },
  ],
  spec: preset('workspace-write'),
  ...overrides,
})
const facts = (overrides = {}) => ({
  sessionId: 'session-a',
  workspaceId: 'alpha',
  workspaceTitle: 'Application',
  title: 'Alpha builder',
  live: true,
  archived: false,
  child: false,
  running: false,
  pendingKind: null,
  effective: {
    preset: 'read-only',
    sandbox: 'read-only',
    approval: 'ask',
  },
  ...overrides,
})
const effectiveOf = (name) => ({
  preset: name,
  ...preset(name),
})
test('preview classifies targets, exclusions and unsupported Sessions without any write', () => {
  const writes = []
  const preview = permissionApplyPreview(
    environment(),
    [
      facts(),
      facts({
        sessionId: 'session-running',
        title: 'Running',
        running: true,
      }),
      facts({ sessionId: 'session-pending', title: 'Pending' }),
      facts({
        sessionId: 'session-target',
        title: 'Already',
        effective: effectiveOf('workspace-write'),
      }),
      facts({
        sessionId: 'session-archived',
        title: 'Archived',
        archived: true,
      }),
      facts({ sessionId: 'session-cold', title: 'Cold', live: false }),
      facts({ sessionId: 'session-child', title: 'Child', child: true }),
      facts({
        sessionId: 'session-foreign',
        title: 'Foreign',
        workspaceId: null,
        workspaceTitle: null,
      }),
    ],
    {
      pending: [
        { sessionId: 'session-pending', kind: 'approval' },
        { sessionId: 'session-running', kind: 'question' },
      ],
    },
  )
  assert.equal(preview.available, true)
  assert.deepEqual(
    preview.targets.map((item) => item.sessionId),
    ['session-a'],
  )
  assert.deepEqual(preview.workspaces, [
    { workspaceId: 'alpha', title: 'Application', count: 1 },
  ])
  assert.deepEqual(
    preview.excluded.map((item) => [item.sessionId, item.reason]),
    [
      ['session-target', 'already-target'],
      ['session-pending', 'pending-approval'],
      ['session-running', 'pending-question'],
    ],
  )
  assert.deepEqual(
    preview.unsupported.map((item) => [item.sessionId, item.reason]),
    [
      ['session-archived', 'archived'],
      ['session-child', 'child'],
      ['session-cold', 'cold'],
      ['session-foreign', 'other-workspace'],
    ],
  )
  assert.deepEqual(writes, [])
})
test('apply is fenced by revision and preset and never writes before validation', () => {
  const writes = []
  const runtime = {
    read: (id) => effectiveOf('read-only'),
    write: (id, name) => writes.push([id, name]),
  }
  const request = {
    expectedRevision: 7,
    expectedPreset: 'workspace-write',
    sessionIds: ['session-a'],
  }
  assert.throws(
    () =>
      permissionApply(
        environment(),
        [facts()],
        { ...request, expectedRevision: 6 },
        runtime,
      ),
    (error) => error.code === 'permission-stale',
  )
  assert.throws(
    () =>
      permissionApply(
        environment(),
        [facts()],
        { ...request, expectedPreset: 'read-only' },
        runtime,
      ),
    (error) => error.code === 'permission-stale',
  )
  assert.throws(
    () =>
      permissionApply(
        environment({
          available: false,
          reason: 'permission-full-access',
          preset: 'danger-full-access',
          fullAccessBlocked: true,
          spec: preset('danger-full-access'),
        }),
        [facts()],
        request,
        runtime,
      ),
    (error) => error.code === 'permission-full-access',
  )
  assert.deepEqual(writes, [])
})
test('apply writes each target once, reads effective permission back and skips duplicates', () => {
  const current = new Map([
    ['session-a', 'read-only'],
    ['session-b', 'read-only'],
    ['session-c', 'workspace-write'],
  ])
  const writes = []
  const runtime = {
    read: (id) => effectiveOf(current.get(id)),
    write: (id, name) => {
      writes.push([id, name])
      current.set(id, name)
    },
  }
  const result = permissionApply(
    environment(),
    [
      facts({ sessionId: 'session-a', title: 'A' }),
      facts({ sessionId: 'session-b', title: 'B' }),
      facts({ sessionId: 'session-c', title: 'C' }),
    ],
    {
      expectedRevision: 7,
      expectedPreset: 'workspace-write',
      sessionIds: ['session-a', 'session-b', 'session-a', 'session-c'],
    },
    runtime,
  )
  assert.deepEqual(writes, [
    ['session-a', 'workspace-write'],
    ['session-b', 'workspace-write'],
  ])
  assert.deepEqual(
    result.applied.map((item) => [item.sessionId, item.effective.preset]),
    [
      ['session-a', 'workspace-write'],
      ['session-b', 'workspace-write'],
    ],
  )
  assert.deepEqual(
    result.skipped.map((item) => [item.sessionId, item.reason]),
    [['session-c', 'already-target']],
  )
  assert.deepEqual(result.failed, [])
  const again = permissionApply(
    environment(),
    [facts({ sessionId: 'session-a', title: 'A' })],
    {
      expectedRevision: 7,
      expectedPreset: 'workspace-write',
      sessionIds: ['session-a'],
    },
    runtime,
  )
  assert.equal(again.applied.length, 0)
  assert.equal(again.skipped[0].reason, 'already-target')
  assert.equal(writes.length, 2)
})
test('partial write failure and read-back mismatch stay visible and are not retried', () => {
  const current = new Map([
    ['session-a', 'read-only'],
    ['session-fail', 'read-only'],
    ['session-mismatch', 'read-only'],
  ])
  const writes = []
  const runtime = {
    read: (id) => effectiveOf(current.get(id)),
    write: (id, name) => {
      writes.push(id)
      if (id === 'session-fail') throw Error('scripted write failure')
      if (id === 'session-mismatch') return
      current.set(id, name)
    },
  }
  const result = permissionApply(
    environment(),
    [
      facts({ sessionId: 'session-a', title: 'A' }),
      facts({ sessionId: 'session-fail', title: 'Fail' }),
      facts({ sessionId: 'session-mismatch', title: 'Mismatch' }),
    ],
    {
      expectedRevision: 7,
      expectedPreset: 'workspace-write',
      sessionIds: ['session-a', 'session-fail', 'session-mismatch'],
    },
    runtime,
  )
  assert.deepEqual(
    result.applied.map((item) => item.sessionId),
    ['session-a'],
  )
  assert.deepEqual(
    result.failed.map((item) => [item.sessionId, item.reason]),
    [
      ['session-fail', 'set-failed'],
      ['session-mismatch', 'readback-mismatch'],
    ],
  )
  assert.deepEqual(writes, ['session-a', 'session-fail', 'session-mismatch'])
  assert.match(result.failed[0].detail, /scripted write failure/)
  assert.match(result.failed[1].detail, /Read-back returned/)
})
const liveSession = (id, presetName, header = {}) => {
  const values = new Map()
  return {
    id,
    header: { cwd: '/workspace/alpha', ...header },
    append() {
      values.set('append', (values.get('append') ?? 0) + 1)
    },
    appends: () => values.get('append') ?? 0,
    presetName,
  }
}
const summary = (id, extra = {}) => ({
  sessionId: id,
  running: false,
  cwd: '/workspace/alpha',
  projections: { values: { title: id } },
  ...extra,
})
const fakeHost = ({
  sessions = [],
  summaries = [],
  workspaces = [],
  archived = [],
  agents = {},
  defaultPreset = 'workspace-write',
  revision = 7,
  sandboxBySession = () => 'workspace-write',
  failWrite = () => false,
  mismatchRead = () => false,
} = {}) => {
  const values = new Map(
    sessions.map((session) => [session.id, session.presetName]),
  )
  const writes = []
  const calls = { request: 0, setPolicy: 0 }
  const approval = {
    config: { policy: 'ask' },
    overrideOf: () => undefined,
    request() {
      calls.request++
      throw Error('approval decisions are forbidden')
    },
    setPolicy() {
      calls.setPolicy++
      throw Error('approval policy writes are forbidden')
    },
  }
  const permissionPresets = {
    catalog: () => ({
      defaultPreset,
      defaultOptions: [
        { value: 'workspace-write', name: 'Workspace write' },
        { value: 'danger-full-access', name: 'Full access' },
      ],
      options: [],
    }),
    current: (session) => values.get(session.id) ?? 'custom',
    resolve: (name) => preset(name),
    set: (session, name) => {
      writes.push([session.id, name])
      if (failWrite(session.id)) throw Error('scripted write failure')
      if (!mismatchRead(session.id)) values.set(session.id, name)
    },
  }
  const host = {
    get(name) {
      return {
        permissionPresets,
        settings: {
          writable: true,
          describe: () => [{ ns: 'permission', revision }],
        },
        sandboxPolicy: {
          resolve: ({ session }) => ({
            mode: sandboxBySession(session.id, values.get(session.id)),
          }),
        },
        approval,
        sessionTitle: {
          get: (session) => ({ title: session.id }),
        },
      }[name]
    },
    sessions: {
      get: (id) => sessions.find((session) => session.id === id),
      list: () => sessions,
    },
    agents: { get: (id) => agents[id] },
    sessionController: {
      list: async () => ({ items: summaries }),
    },
    workspaceRegistry: {
      list: () => workspaces,
      archivedSessionIds: archived,
    },
  }
  return { host, writes, approval, calls }
}
test('Host adapter previews live/registered scope and supplies pending facts', async () => {
  const alpha = liveSession('session-a', 'read-only')
  const running = liveSession('session-running', 'read-only')
  const pending = liveSession('session-pending', 'read-only')
  const child = liveSession('session-child', 'read-only', {
    parentSession: 'session-a',
  })
  const archivedSession = liveSession('session-archived', 'read-only')
  const foreign = liveSession('session-foreign', 'read-only', {
    cwd: '/elsewhere',
  })
  const { host, writes } = fakeHost({
    sessions: [alpha, running, pending, child, archivedSession, foreign],
    summaries: [
      summary('session-a'),
      summary('session-running', { running: true }),
      summary('session-pending'),
      summary('session-child', { parentSessionId: 'session-a' }),
      summary('session-archived'),
      summary('session-foreign', { cwd: '/elsewhere' }),
    ],
    workspaces: [
      {
        id: 'alpha',
        path: '/workspace/alpha',
        title: 'Application',
        sessionIds: [
          'session-a',
          'session-running',
          'session-pending',
          'session-child',
          'session-cold',
        ],
      },
      {
        id: 'beta',
        path: '/workspace/alpha',
        title: 'Beta',
        sessionIds: ['session-archived'],
      },
    ],
    archived: ['session-archived'],
    agents: { 'session-running': { status: 'running' } },
    sandboxBySession: (id, value) =>
      value === 'read-only' ? 'read-only' : 'workspace-write',
  })
  const capability = createPermissionCapability(host)
  const preview = await capability.preview({
    pending: [
      { sessionId: 'session-pending', kind: 'approval' },
      { sessionId: 'session-a', kind: 'question' },
    ],
  })
  assert.equal(preview.available, true)
  assert.equal(preview.preset, 'workspace-write')
  assert.equal(preview.revision, 7)
  assert.deepEqual(preview.targets, [])
  assert.deepEqual(
    preview.excluded.map((item) => [item.sessionId, item.reason]),
    [
      ['session-pending', 'pending-approval'],
      ['session-a', 'pending-question'],
      ['session-running', 'running'],
    ],
  )
  assert.deepEqual(
    preview.unsupported.map((item) => [item.sessionId, item.reason]),
    [
      ['session-archived', 'archived'],
      ['session-child', 'child'],
      ['session-cold', 'cold'],
      ['session-foreign', 'other-workspace'],
    ],
  )
  assert.deepEqual(writes, [])
  for (const session of [
    alpha,
    running,
    pending,
    child,
    archivedSession,
    foreign,
  ])
    assert.equal(session.appends(), 0)
})
test('reading and previewing the default never applies it; only an explicit apply writes', async () => {
  const target = liveSession('session-a', 'read-only')
  const { host, writes } = fakeHost({
    sessions: [target],
    summaries: [summary('session-a')],
    workspaces: [
      {
        id: 'alpha',
        path: '/workspace/alpha',
        title: 'Application',
        sessionIds: ['session-a'],
      },
    ],
    sandboxBySession: (id, value) =>
      value === 'read-only' ? 'read-only' : 'workspace-write',
  })
  const capability = createPermissionCapability(host)
  await capability.preview({ pending: [] })
  await capability.preview({ pending: [] })
  assert.deepEqual(writes, [])
  assert.equal(target.appends(), 0)
  await capability.apply({
    expectedRevision: 7,
    expectedPreset: 'workspace-write',
    sessionIds: ['session-a'],
    pending: [],
  })
  assert.deepEqual(writes, [['session-a', 'workspace-write']])
})
test('Host adapter applies once through the official permission setter and reads back', async () => {
  const target = liveSession('session-a', 'read-only')
  const other = liveSession('session-b', 'read-only')
  const { host, writes, calls } = fakeHost({
    sessions: [target, other],
    summaries: [summary('session-a'), summary('session-b')],
    workspaces: [
      {
        id: 'alpha',
        path: '/workspace/alpha',
        title: 'Application',
        sessionIds: ['session-a', 'session-b'],
      },
    ],
    sandboxBySession: (id, value) =>
      value === 'read-only' ? 'read-only' : 'workspace-write',
  })
  const capability = createPermissionCapability(host)
  const result = await capability.apply({
    expectedRevision: 7,
    expectedPreset: 'workspace-write',
    sessionIds: ['session-a'],
    pending: [],
  })
  assert.deepEqual(writes, [['session-a', 'workspace-write']])
  assert.deepEqual(
    result.applied.map((item) => [item.sessionId, item.effective.preset]),
    [['session-a', 'workspace-write']],
  )
  assert.equal(target.appends(), 0)
  assert.equal(calls.request, 0)
  assert.equal(calls.setPolicy, 0)
  assert.equal(other.appends(), 0)
  await assert.rejects(
    () =>
      capability.apply({
        expectedRevision: 6,
        expectedPreset: 'workspace-write',
        sessionIds: ['session-b'],
      }),
    (error) => error.code === 'permission-stale',
  )
  assert.deepEqual(writes, [['session-a', 'workspace-write']])
})
test('Host adapter reports partial failures, full access refusal and missing services', async () => {
  const fail = liveSession('session-fail', 'read-only')
  const mismatch = liveSession('session-mismatch', 'read-only')
  const applied = liveSession('session-a', 'read-only')
  const { host, writes } = fakeHost({
    sessions: [fail, mismatch, applied],
    summaries: [
      summary('session-fail'),
      summary('session-mismatch'),
      summary('session-a'),
    ],
    workspaces: [
      {
        id: 'alpha',
        path: '/workspace/alpha',
        title: 'Application',
        sessionIds: ['session-fail', 'session-mismatch', 'session-a'],
      },
    ],
    sandboxBySession: (id, value) =>
      value === 'read-only' ? 'read-only' : 'workspace-write',
    failWrite: (id) => id === 'session-fail',
    mismatchRead: (id) => id === 'session-mismatch',
  })
  const capability = createPermissionCapability(host)
  const result = await capability.apply({
    expectedRevision: 7,
    expectedPreset: 'workspace-write',
    sessionIds: ['session-a', 'session-fail', 'session-mismatch'],
    pending: [],
  })
  assert.deepEqual(
    result.applied.map((item) => item.sessionId),
    ['session-a'],
  )
  assert.deepEqual(
    result.failed.map((item) => [item.sessionId, item.reason]),
    [
      ['session-fail', 'set-failed'],
      ['session-mismatch', 'readback-mismatch'],
    ],
  )
  assert.deepEqual(writes, [
    ['session-a', 'workspace-write'],
    ['session-fail', 'workspace-write'],
    ['session-mismatch', 'workspace-write'],
  ])
  const full = fakeHost({
    sessions: [liveSession('session-a', 'read-only')],
    summaries: [summary('session-a')],
    workspaces: [
      {
        id: 'alpha',
        path: '/workspace/alpha',
        title: 'Application',
        sessionIds: ['session-a'],
      },
    ],
    defaultPreset: 'danger-full-access',
  })
  const fullCapability = createPermissionCapability(full.host)
  const preview = await fullCapability.preview({ pending: [] })
  assert.equal(preview.available, false)
  assert.equal(preview.fullAccessBlocked, true)
  assert.equal(preview.reason, 'permission-full-access')
  await assert.rejects(
    () =>
      fullCapability.apply({
        expectedRevision: 7,
        expectedPreset: 'danger-full-access',
        sessionIds: ['session-a'],
      }),
    (error) => error.code === 'permission-full-access',
  )
  assert.deepEqual(full.writes, [])
  const missing = createPermissionCapability({
    get: () => undefined,
    sessions: { get: () => undefined, list: () => [] },
    agents: { get: () => undefined },
    sessionController: { list: async () => ({ items: [] }) },
    workspaceRegistry: { list: () => [], archivedSessionIds: [] },
  })
  const unavailable = await missing.preview({ pending: [] })
  assert.equal(unavailable.available, false)
  assert.equal(unavailable.reason, 'permission-unavailable')
  await assert.rejects(
    () =>
      missing.apply({
        expectedRevision: 0,
        expectedPreset: '',
        sessionIds: [],
      }),
    (error) => error.code === 'permission-unavailable',
  )
})
