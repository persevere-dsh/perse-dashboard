import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  attentionKey,
  activeTaskSessions,
} from '../lib/types/client/attention.js'
import { permissionControls } from '../lib/types/client/permission-api.js'
test('official pending interaction has display precedence without rewriting running', () => {
  const status = {
    running: true,
    pendingInteraction: { kind: 'approval', key: 'request-1', sessionId: 's' },
  }
  assert.equal(attentionKey(status), 'waitingApproval')
  assert.equal(status.running, true)
  assert.equal(
    attentionKey({ pendingInteraction: { kind: 'plan-review' } }),
    'waitingPlan',
  )
  assert.equal(
    attentionKey({ pendingInteraction: { kind: 'question' } }),
    'waitingAnswer',
  )
  assert.equal(
    attentionKey({ pendingInteraction: { kind: 'future' } }),
    'waitingInteraction',
  )
  assert.equal(attentionKey({ pendingInteraction: undefined }), undefined)
})
test('attention follows active phase identity and ignores completed history and assignments', () => {
  const task = {
    status: 'in-progress',
    sessionId: 'worker',
    analysisSessionId: 'analyst',
    reviewSessionId: 'reviewer',
    assignee: 'assigned',
  }
  assert.deepEqual(activeTaskSessions(task), ['worker'])
  assert.deepEqual(activeTaskSessions({ ...task, status: 'triage' }), [
    'analyst',
  ])
  assert.deepEqual(activeTaskSessions({ ...task, status: 'in-review' }), [
    'worker',
    'reviewer',
  ])
  assert.deepEqual(activeTaskSessions({ ...task, status: 'done' }), [])
  assert.deepEqual(activeTaskSessions({ ...task, status: 'todo' }), [])
  assert.deepEqual(activeTaskSessions({ ...task, archived: true }), [])
})
function harness() {
  const state = {
    preset: 'workspace-write',
    revision: 4,
    writable: true,
    available: true,
    reject: false,
    calls: [],
  }
  const api = permissionControls({
    async catalog() {
      if (!state.available) throw Error('unavailable')
      return {
        ok: true,
        value: {
          defaultPreset: state.preset,
          defaultOptions: [
            { value: 'workspace-write', name: 'Workspace write' },
            { value: 'danger-full-access', name: 'Full access' },
          ],
        },
      }
    },
    async describe() {
      return {
        ok: true,
        value: {
          writable: state.writable,
          namespaces: [
            { ns: 'unrelated', revision: 88 },
            { ns: 'permission', revision: state.revision },
          ],
        },
      }
    },
    async mutate(...args) {
      state.calls.push(args)
      if (state.reject) return { ok: false, error: Error('Host rejected') }
      state.preset = args[1][0].value
      state.revision++
      return { ok: true, value: {} }
    },
  })
  return { state, api }
}
test('permission adapter writes only advertised official default field with captured revision and readback', async () => {
  const { state, api } = harness()
  const before = await api.loadPermissions()
  assert.equal(state.calls.length, 0)
  const after = await api.savePermissionDefault(
    'danger-full-access',
    before.revision,
  )
  assert.deepEqual(state.calls, [
    [
      'permission',
      [{ op: 'set', path: ['defaultPreset'], value: 'danger-full-access' }],
      4,
    ],
  ])
  assert.equal(after.currentValue, 'danger-full-access')
  assert.equal(after.revision, 5)
})
test('stale, read-only, unavailable and unadvertised permission defaults never issue writes', async () => {
  for (const mode of ['stale', 'readonly', 'unavailable', 'unknown']) {
    const { state, api } = harness()
    if (mode === 'stale') state.revision++
    if (mode === 'readonly') state.writable = false
    if (mode === 'unavailable') state.available = false
    await assert.rejects(
      api.savePermissionDefault(
        mode === 'unknown' ? 'auto' : 'workspace-write',
        4,
      ),
    )
    assert.equal(state.calls.length, 0)
  }
})
test('permission write failure is visible and is never automatically retried', async () => {
  const { state, api } = harness()
  state.reject = true
  await assert.rejects(
    api.savePermissionDefault('danger-full-access', 4),
    /Host rejected/,
  )
  assert.equal(state.calls.length, 1)
  assert.equal(state.preset, 'workspace-write')
})
