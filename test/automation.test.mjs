import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { makeBackend } from '../sim/lab/backend.mjs'
import { checkFiles, digest } from '../lib/types/host/policy.js'
import { boardSchema } from '../lib/types/host/board.js'
const policy = (mode = 'reviewed') => ({
  mode,
  instructions:
    'Verify the actual result; unavailable checks never count as pass.',
  checks:
    mode === 'verified'
      ? [
          {
            criterion: 0,
            path: 'result.txt',
            kind: 'text-equals',
            expected: 'APPROVED_RESULT',
          },
        ]
      : [],
})
async function harness(fn) {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'perse-policy-test-'))
  const b = await makeBackend(folder)
  try {
    await fn(b, folder)
  } finally {
    await b.close()
    await rm(folder, { recursive: true, force: true })
  }
}
const issue = (extra = {}) => ({
  requestId: crypto.randomUUID(),
  workspaceId: 'alpha',
  title: 'A clear workspace task',
  description: 'Produce and verify a result',
  criteria: ['Result matches the approved scope'],
  priority: 1,
  assignee: null,
  intake: true,
  completionPolicy: policy(),
  ...extra,
})
async function execute(b, t) {
  b.dispatcher.configure('alpha', true)
  await b.idle()
  return b.task(t.id)
}
test('complete intake → analysis → actual claim → independent review → automatic done', () =>
  harness(async (b) => {
    const t = await b.owner.create(issue())
    const done = await execute(b, t)
    assert.equal(done.status, 'done')
    assert.equal(done.completion.kind, 'reviewed')
    assert.notEqual(done.reviewSessionId, done.sessionId)
    assert.notEqual(done.analysisSessionId, done.sessionId)
    assert.deepEqual(
      b.board
        .snapshot()
        .ledger.filter((a) => a.taskId === t.id)
        .map((a) => a.action),
      [
        'create',
        'analysis-start',
        'analysis-report',
        'claim',
        'report',
        'review-start',
        'review-report',
        'auto-complete',
      ],
    )
    assert.equal(done.checked[0], true)
  }))
test('machine checks complete exact approved files and keep a failed check in review', () =>
  harness(async (b) => {
    let t = await b.owner.create(
      issue({ completionPolicy: policy('verified') }),
    )
    t = await execute(b, t)
    assert.equal(t.status, 'done')
    assert.equal(t.completion.kind, 'verified')
    assert.equal(t.completion.results[0].passed, true)
    const bad = await b.owner.create(
      issue({
        completionPolicy: {
          ...policy('verified'),
          checks: [
            {
              criterion: 0,
              path: 'missing.txt',
              kind: 'sha256',
              expected: '0'.repeat(64),
            },
          ],
        },
      }),
    )
    const held = await execute(b, bad)
    assert.equal(held.status, 'in-review')
    assert.match(held.automationNote, /unavailable/)
    assert.equal(held.completion, null)
  }))
test('needs-info and human analysis never become executable; staged and manual flags never auto-finish', () =>
  harness(async (b) => {
    const t = await b.owner.create(issue({ needsManual: true }))
    const held = await execute(b, t)
    assert.equal(held.analysis.route, 'staged')
    assert.equal(held.status, 'in-review')
    assert.equal(held.completion, null)
    assert.match(held.automationNote, /human-acceptance-required/)
  }))
test('old stored data migrates to manual completion without silently authorizing automation', () =>
  harness(async (b) => {
    let t = await b.owner.create(
      issue({ intake: false, completionPolicy: policy('manual') }),
    )
    const raw = { revision: 0, tasks: [t], receipts: [], ledger: [] }
    for (const key of [
      'intake',
      'needsManual',
      'analysis',
      'analysisSessionId',
      'review',
      'reviewSessionId',
      'completionPolicy',
      'completion',
      'automationNote',
    ])
      delete raw.tasks[0][key]
    const parsed = boardSchema.parse(raw)
    assert.equal(parsed.tasks[0].completionPolicy.mode, 'manual')
    assert.equal(parsed.tasks[0].intake, false)
  }))
test('file verification rejects path traversal and symlink escape and requires every criterion', () =>
  harness(async (b, folder) => {
    const task = await b.owner.create(
      issue({ completionPolicy: policy('verified') }),
    )
    const ws = b.workspaces[0].path
    await writeFile(path.join(folder, 'outside.txt'), 'APPROVED_RESULT')
    await symlink(path.join(folder, 'outside.txt'), path.join(ws, 'escape.txt'))
    for (const name of ['../outside.txt', 'escape.txt']) {
      task.completionPolicy.checks[0].path = name
      await assert.rejects(checkFiles(task, ws), /outside|escapes/)
    }
    task.completionPolicy.checks = []
    await assert.rejects(checkFiles(task, ws), /every criterion/)
  }))
test('analysis/reviewer identity and frozen criteria prevent self-approval and scope rewriting', () =>
  harness(async (b) => {
    let t = await b.owner.create(issue())
    const a = await b.runtime.create('alpha')
    t = await b.board.beginAnalysis(a, t.id, t.version)
    await assert.rejects(
      b.board.triage(a, {
        requestId: crypto.randomUUID(),
        taskId: t.id,
        expectedVersion: t.version,
        criteria: ['rewritten'],
        analysis: {
          summary: 'x',
          plan: ['x'],
          risk: 'low',
          route: 'express',
          questions: [],
        },
      }),
      /rewritten/,
    )
    await assert.rejects(
      b.board.claim(a, { requestId: crypto.randomUUID() }),
      /cannot claim/,
    )
    await assert.rejects(
      b.board.submitReview(a, {
        requestId: crypto.randomUUID(),
        taskId: t.id,
        expectedVersion: t.version,
        review: {
          verdict: 'pass',
          risk: 'low',
          results: [],
          remainingRisks: [],
          evidence: 'claim',
        },
      }),
      /not assigned/,
    )
  }))
test('watcher consumes new issues, preserves pause, and enforces its activation budget', () =>
  harness(async (b) => {
    b.dispatcher.configure('alpha', true, { watch: true, maxTasks: 1 })
    assert.equal(b.dispatcher.snapshot().enabled, true)
    const t = await b.owner.create(issue())
    await b.idle()
    assert.equal(b.task(t.id).status, 'done')
    assert.equal(b.dispatcher.snapshot().enabled, false)
    const next = await b.owner.create(issue())
    await Promise.resolve()
    assert.equal(b.task(next.id).status, 'triage')
    assert.equal(b.dispatcher.snapshot().processed, 1)
  }))

test('analysis can propose missing criteria but cannot change approved rules or execute across workspaces', () =>
  harness(async (b) => {
    const t = await b.owner.create(issue({ criteria: [] }))
    const done = await execute(b, t)
    assert.deepEqual(done.criteria, ['Result is verified'])
    assert.deepEqual(done.completionPolicy, policy())
    assert.equal(done.status, 'done')
    await assert.rejects(
      b.board.claim('session-beta-builder', {
        requestId: crypto.randomUUID(),
        taskId: done.id,
      }),
      /eligible/,
    )
  }))
test('SHA256 checks hash actual bytes and reject oversize files', () =>
  harness(async (b) => {
    const t = await b.owner.create(
        issue({ completionPolicy: policy('verified') }),
      ),
      ws = b.workspaces[0].path
    t.completionPolicy.checks[0] = {
      criterion: 0,
      path: 'bytes.bin',
      kind: 'sha256',
      expected: digest(new Uint8Array([0, 255, 13, 10])),
    }
    await writeFile(
      path.join(ws, 'bytes.bin'),
      new Uint8Array([0, 255, 13, 10]),
    )
    assert.equal((await checkFiles(t, ws))[0].passed, true)
    await writeFile(path.join(ws, 'bytes.bin'), Buffer.alloc(1024 * 1024 + 1))
    await assert.rejects(checkFiles(t, ws), /1 MiB/)
  }))
test('phase Sessions cannot be assigned execution and invalid dispatch options never arm processing', () =>
  harness(async (b) => {
    let t = await b.owner.create(issue())
    t = await b.board.beginAnalysis('session-alpha-analyst', t.id, t.version)
    await assert.rejects(
      b.owner.create(issue({ assignee: 'session-alpha-analyst' })),
      /cannot receive/,
    )
    for (const options of [
      { watch: 'true' },
      { maxTasks: 0 },
      { maxTasks: 101 },
      { maxTasks: 1.2 },
    ])
      assert.throws(() => b.dispatcher.configure('alpha', true, options))
    assert.equal(b.dispatcher.snapshot().enabled, false)
  }))

test('late idle notification from a superseded analyst cannot block the new analysis phase', () =>
  harness(async (b) => {
    const t = await b.owner.create(issue())
    b.scripts[t.id] = { missingAnalysis: true }
    const original = b.runtime.idle
    b.runtime.idle = async (id) => {
      await original(id)
      let current = b.task(t.id)
      if (current.analysisSessionId !== id) return
      current = await b.board.update({
        requestId: crypto.randomUUID(),
        id: t.id,
        expectedVersion: current.version,
        action: 'move',
        status: 'triage',
      })
      await b.board.beginAnalysis(
        'session-alpha-analyst',
        t.id,
        current.version,
      )
    }
    b.dispatcher.configure('alpha', true)
    await b.idle()
    assert.equal(b.task(t.id).status, 'triage')
    assert.equal(b.task(t.id).analysisSessionId, 'session-alpha-analyst')
    assert.equal(b.dispatcher.snapshot().error, null)
  }))
