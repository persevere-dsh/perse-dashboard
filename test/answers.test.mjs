import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { makeBackend } from '../sim/lab/backend.mjs'
import { analysisPrompt } from '../lib/types/host/prompts.js'
import { boardSchema } from '../lib/types/host/board.js'

const issue = () => ({
  requestId: crypto.randomUUID(),
  workspaceId: 'alpha',
  title: 'Owner answers',
  description: 'The analysis needs product decisions.',
  criteria: ['old criterion'],
  priority: 1,
  assignee: null,
  intake: true,
  completionPolicy: { mode: 'reviewed', instructions: '', checks: [] },
})

test('owner answers persist, reset criteria/analysis and reach the next analysis prompt', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'perse-answers-'))
  const b = await makeBackend(folder)
  try {
    const t = await b.owner.create(issue())
    const analyzing = await b.board.beginAnalysis(
      'session-alpha-analyst',
      t.id,
      t.version,
    )
    const triaged = await b.board.triage('session-alpha-analyst', {
      requestId: crypto.randomUUID(),
      taskId: t.id,
      expectedVersion: analyzing.version,
      analysis: {
        summary: 'Need product decisions',
        plan: ['Plan'],
        risk: 'medium',
        route: 'needs-info',
        questions: ['Q1?', 'Q2?'],
      },
      criteria: ['old criterion'],
    })
    assert.equal(triaged.status, 'needs-info')
    assert.deepEqual(triaged.answers, [])
    const answered = await b.board.update({
      requestId: crypto.randomUUID(),
      id: triaged.id,
      expectedVersion: triaged.version,
      action: 'edit',
      answers: [
        { question: 'Q1?', answer: 'A1' },
        { question: 'Q2?', answer: 'A2' },
      ],
    })
    assert.equal(answered.status, 'triage')
    assert.equal(answered.analysis, null)
    assert.deepEqual(answered.criteria, [])
    assert.equal(answered.automationNote, '')
    assert.deepEqual(answered.answers, [
      { question: 'Q1?', answer: 'A1' },
      { question: 'Q2?', answer: 'A2' },
    ])
    const prompt = analysisPrompt(answered)
    assert.match(prompt, /A1/)
    assert.match(prompt, /Q2\?/)
    assert.match(prompt, /answers/)
  } finally {
    await b.close()
    await rm(folder, { recursive: true, force: true })
  }
})

test('legacy tasks without answers load with an empty list', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'perse-answers-legacy-'))
  const b = await makeBackend(folder)
  try {
    const t = await b.owner.create(issue())
    const raw = structuredClone(t)
    delete raw.answers
    const parsed = boardSchema.parse({
      revision: 0,
      tasks: [raw],
      ledger: [],
      receipts: [],
    })
    assert.deepEqual(parsed.tasks[0].answers, [])
  } finally {
    await b.close()
    await rm(folder, { recursive: true, force: true })
  }
})
