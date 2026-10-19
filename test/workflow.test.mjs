import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { makeBackend } from '../sim/lab/backend.mjs'
import { evidenceImage } from '../lib/types/host/artifacts.js'
import {
  nextStep,
  completionBlocks,
  taskNeedsAction,
} from '../lib/types/client/workflow.js'
const issue = (extra = {}) => ({
  requestId: crypto.randomUUID(),
  workspaceId: 'alpha',
  title: 'Bounded recovery',
  description: 'Verify result',
  criteria: [],
  priority: 1,
  assignee: null,
  intake: true,
  completionPolicy: { mode: 'reviewed', instructions: '', checks: [] },
  ...extra,
})
async function harness(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'perse-recovery-'))
  const b = await makeBackend(dir)
  try {
    await fn(b, dir)
  } finally {
    await b.close()
    await rm(dir, { recursive: true, force: true })
  }
}
test('reasoning-only analysis stop receives exactly one reminder and then completes the full pipeline', () =>
  harness(async (b) => {
    const t = await b.owner.create(issue())
    b.scripts[t.id] = { missingAnalysisOnce: true }
    b.dispatcher.configure('alpha', true)
    await b.idle()
    const done = b.task(t.id)
    assert.equal(done.status, 'done')
    assert.equal(b.history.get(done.analysisSessionId).length, 2)
    assert.match(b.history.get(done.analysisSessionId)[1], /REPORT_REMINDER/)
  }))
test('missing reports block only their tasks, have a bounded reminder, and never auto-accept; later work completes', () =>
  harness(async (b) => {
    const bad = await b.owner.create(issue())
    b.scripts[bad.id] = { missingAnalysis: true }
    const good = await b.owner.create(issue())
    b.dispatcher.configure('alpha', true)
    await b.idle()
    assert.equal(b.task(bad.id).status, 'blocked')
    assert.equal(b.task(bad.id).completion, null)
    assert.equal(b.history.get(b.task(bad.id).analysisSessionId).length, 2)
    assert.equal(b.task(good.id).status, 'done')
    assert.equal(b.dispatcher.snapshot().error, null)
  }))
test('owner recovery resets missing analysis to triage, keeps evidence, rejects stale writes and resumes', () =>
  harness(async (b) => {
    let t = await b.owner.create(issue())
    b.scripts[t.id] = { missingAnalysis: true }
    b.dispatcher.configure('alpha', true)
    await b.idle()
    t = b.task(t.id)
    const old = t
    t = await b.owner.update({
      requestId: crypto.randomUUID(),
      id: t.id,
      expectedVersion: t.version,
      action: 'retry',
    })
    assert.equal(t.status, 'triage')
    assert.equal(t.analysisSessionId, null)
    assert.equal(t.evidence, old.evidence)
    await assert.rejects(
      b.owner.update({
        requestId: crypto.randomUUID(),
        id: t.id,
        expectedVersion: old.version,
        action: 'retry',
      }),
      /changed/,
    )
    b.scripts[t.id] = {}
    b.dispatcher.configure('alpha', true)
    await b.idle()
    assert.equal(b.task(t.id).status, 'done')
  }))
test('execution reminder forbids duplicate implementation and remains bounded', () =>
  harness(async (b) => {
    const t = await b.owner.create(issue())
    b.scripts[t.id] = { missingReportOnce: true }
    b.dispatcher.configure('alpha', true)
    await b.idle()
    const done = b.task(t.id)
    assert.equal(done.status, 'done')
    assert.equal(b.history.get(done.sessionId).length, 2)
    assert.match(
      b.history.get(done.sessionId)[1],
      /Do not repeat implementation/,
    )
  }))
test('staged work obtains independent evidence but requires explicit owner acceptance; repeated verification reuses passed review', () =>
  harness(async (b) => {
    let t = await b.owner.create(issue())
    b.scripts[t.id] = { route: 'staged', risk: 'medium' }
    b.dispatcher.configure('alpha', true)
    await b.idle()
    t = b.task(t.id)
    assert.equal(t.status, 'in-review')
    assert.equal(t.review.verdict, 'pass')
    assert.equal(t.completion, null)
    assert.ok(completionBlocks(t).includes('gateStaged'))
    assert.ok(completionBlocks(t).includes('gateRisk'))
    const reviewer = t.reviewSessionId
    t = await b.owner.verify({
      id: t.id,
      expectedVersion: t.version,
      requestId: crypto.randomUUID(),
    })
    assert.equal(t.reviewSessionId, reviewer)
    assert.equal(b.history.get(reviewer).length, 1)
    assert.equal(t.status, 'in-review')
    assert.equal(nextStep(t, false, false), 'nextHuman')
    assert.equal(taskNeedsAction(t, false, false), true)
  }))
test('needs-info may report no premature criteria; owner edits generate a new analysis boundary', () =>
  harness(async (b) => {
    let t = await b.owner.create(issue())
    const analyst = await b.runtime.create('alpha')
    t = await b.board.beginAnalysis(analyst, t.id, t.version)
    t = await b.board.triage(analyst, {
      requestId: crypto.randomUUID(),
      taskId: t.id,
      expectedVersion: t.version,
      criteria: [],
      analysis: {
        summary: 'Need exact terms',
        plan: ['Clarify intended wording'],
        risk: 'medium',
        route: 'needs-info',
        questions: ['Which text is incorrect?'],
      },
    })
    assert.equal(t.status, 'needs-info')
    assert.equal(nextStep(t, false, false), 'nextClarify')
    t = await b.owner.update({
      requestId: crypto.randomUUID(),
      id: t.id,
      expectedVersion: t.version,
      action: 'edit',
      description: 'Replace obsolete author attribution',
      criteria: ['No obsolete author attribution remains'],
    })
    assert.equal(t.status, 'triage')
    assert.equal(t.analysis, null)
    assert.equal(t.analysisSessionId, null)
    assert.equal(t.checked[0], false)
  }))
test('image evidence reads only recorded workspace artifacts and rejects traversal, symlink escape, non-images and oversized files', () =>
  harness(async (b, dir) => {
    const t = await b.owner.create(issue({ criteria: ['Visible result'] }))
    const ws = b.workspaces[0].path
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
      'base64',
    )
    await writeFile(path.join(ws, 'proof.png'), png)
    t.images = [{ path: 'proof.png', caption: 'Visible result', criterion: 0 }]
    assert.match(
      await evidenceImage(t, ws, 'proof.png'),
      /^data:image\/png;base64,/,
    )
    await assert.rejects(evidenceImage(t, ws, 'missing.png'), /not recorded/)
    await writeFile(path.join(dir, 'outside.png'), png)
    await symlink(path.join(dir, 'outside.png'), path.join(ws, 'escape.png'))
    t.images.push(
      { path: 'escape.png', caption: 'x' },
      { path: '../outside.png', caption: 'x' },
      { path: 'text.png', caption: 'x' },
      { path: 'large.png', caption: 'x' },
    )
    await assert.rejects(evidenceImage(t, ws, 'escape.png'), /escapes/)
    await assert.rejects(evidenceImage(t, ws, '../outside.png'), /inside/)
    await writeFile(path.join(ws, 'text.png'), '<script>bad</script>')
    await assert.rejects(evidenceImage(t, ws, 'text.png'), /Only PNG/)
    await writeFile(
      path.join(ws, 'large.png'),
      Buffer.alloc(2 * 1024 * 1024 + 1),
    )
    await assert.rejects(evidenceImage(t, ws, 'large.png'), /2 MiB/)
  }))
