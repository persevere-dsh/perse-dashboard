import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { makeBackend } from '../sim/lab/backend.mjs'
import {
  BoardController,
  boardSchema,
  initialBoard,
} from '../lib/types/host/board.js'
import {
  inputImageDataUrl,
  taskImageLimits,
  imageLabel,
} from '../lib/types/host/images.js'
import {
  analysisPrompt,
  taskPrompt,
  reviewPrompt,
  phaseContent,
} from '../lib/types/host/prompts.js'
import { runPhase } from '../lib/types/host/phases.js'
import { Dispatcher } from '../lib/types/host/dispatch.js'
import { validSnapshot } from '../lib/types/client/validation.js'

const fixture = async (name) =>
  (
    await readFile(
      new URL(`../sim/fixtures/input-images/${name}`, import.meta.url),
    )
  ).toString('base64')
const ref = (extra = {}) => ({
  attachmentId: `attachment-${crypto.randomUUID()}`,
  mediaType: 'image/png',
  bytes: 87,
  width: 12,
  height: 8,
  name: 'fixture-description.png',
  source: 'description',
  ...extra,
})
const draft = async (extra = {}) => ({
  mediaType: 'image/png',
  data: await fixture('fixture-description.png'),
  name: 'fixture-description.png',
  source: 'description',
  ...extra,
})
const request = (extra = {}) => ({
  requestId: crypto.randomUUID(),
  workspaceId: 'ws',
  title: 'Task',
  description: 'Implement',
  criteria: ['Verified'],
  priority: 1,
  assignee: null,
  ...extra,
})
function fixtureBoard() {
  let data = initialBoard(),
    id = 0
  const persistence = {
    get: () => data,
    set: async (value) => {
      data = structuredClone(value)
    },
  }
  const env = {
    workspaces: () => [{ id: 'ws', path: '/tmp', sessionIds: ['a', 'b'] }],
    now: () => 100,
    id: () => `task-${++id}`,
    imageLimits: () => taskImageLimits(undefined),
  }
  return {
    controller: new BoardController(persistence, env),
    persistence,
    env,
    data: () => data,
    replace: (task) => {
      data.tasks[0] = task
    },
  }
}
test('input images default to an empty list and migrate from legacy task rows', async () => {
  const f = fixtureBoard()
  const t = await f.controller.create(request())
  assert.deepEqual(t.inputImages, [])
  const legacy = structuredClone(f.data().tasks[0])
  delete legacy.inputImages
  const migrated = boardSchema.parse({
    revision: 1,
    tasks: [legacy],
    ledger: [],
    receipts: [],
  })
  assert.deepEqual(migrated.tasks[0].inputImages, [])
  const snapshot = {
    revision: 1,
    tasks: [migrated.tasks[0]],
    ledger: [],
    dispatch: { enabled: false, error: null },
    capabilities: { imageInput: true },
    imageLimits: taskImageLimits(undefined),
  }
  assert.equal(validSnapshot(snapshot), true)
})
test('create and update image metadata are idempotent, versioned and bounded', async () => {
  const f = fixtureBoard(),
    c = f.controller
  const image = ref()
  const createRequest = request({ inputImages: [image] })
  const created = await c.create(createRequest)
  assert.deepEqual(created.inputImages, [image])
  assert.deepEqual(await c.create(createRequest), created)
  assert.equal(c.snapshot().tasks.length, 1)
  await assert.rejects(
    c.create({ ...createRequest, title: 'different' }),
    /already used/,
  )
  assert.throws(
    () =>
      c.create(
        request({
          inputImages: Array.from({ length: 5 }, (_, i) =>
            ref({ attachmentId: `too-many-${i}` }),
          ),
        }),
      ),
    /Too big|expected array/i,
  )
  assert.throws(
    () =>
      c.create(request({ inputImages: [ref({ mediaType: 'image/svg+xml' })] })),
    /image\/svg|Invalid option/i,
  )
  await assert.rejects(
    c.create(
      request({
        inputImages: [ref({ bytes: taskImageLimits(undefined).maxImageBytes + 1 })],
      }),
    ),
    /byte size|too-large/i,
  )
  const update = {
    requestId: crypto.randomUUID(),
    id: created.id,
    expectedVersion: created.version,
    action: 'edit',
    inputImages: [
      created.inputImages[0],
      ref({
        source: 'criteria',
        name: 'fixture-criteria.jpg',
        mediaType: 'image/jpeg',
        bytes: 650,
      }),
    ],
  }
  const edited = await c.update(update)
  assert.equal(edited.inputImages.length, 2)
  assert.equal(
    edited.inputImages[0].attachmentId,
    created.inputImages[0].attachmentId,
  )
  assert.equal(edited.inputImages[1].source, 'criteria')
  assert.deepEqual(await c.update(update), edited)
  const restarted = new BoardController(f.persistence, f.env)
  assert.equal(restarted.snapshot().tasks[0].inputImages.length, 2)
})
test('editing input images invalidates analysis, review and completion', async () => {
  const f = fixtureBoard(),
    c = f.controller
  const created = await c.create(request({ intake: true }))
  f.replace({
    ...f.data().tasks[0],
    analysis: {
      summary: 'ready',
      plan: ['work'],
      risk: 'low',
      route: 'express',
      questions: [],
    },
    analysisSessionId: 'analysis-session',
    reviewSessionId: 'review-session',
    review: {
      verdict: 'pass',
      risk: 'low',
      results: [{ criterion: 0, passed: true, evidence: 'checked' }],
      remainingRisks: [],
      evidence: 'reviewed',
    },
    reviewPromptHash: 'hash',
    completion: {
      kind: 'reviewed',
      time: 1,
      ruleVersion: 'completion/3',
      promptHash: 'hash',
      evidenceHash: 'hash',
      reviewerSessionId: 'review-session',
      checks: [],
      results: [{ criterion: 0, passed: true, evidence: 'checked' }],
    },
    status: 'blocked',
  })
  const restarted = new BoardController(f.persistence, f.env)
  const edited = await restarted.update({
    requestId: crypto.randomUUID(),
    id: created.id,
    expectedVersion: 1,
    action: 'edit',
    inputImages: [ref({ source: 'criteria' })],
  })
  assert.equal(edited.analysis, null)
  assert.equal(edited.analysisSessionId, null)
  assert.equal(edited.review, null)
  assert.equal(edited.reviewPromptHash, null)
  assert.equal(edited.reviewSessionId, null)
  assert.equal(edited.completion, null)
  assert.equal(edited.status, 'triage')
  assert.equal(edited.inputImages.length, 1)
  const active = {
    ...edited,
    status: 'in-progress',
    version: edited.version + 1,
  }
  f.replace(active)
  await assert.rejects(
    new BoardController(f.persistence, f.env).update({
      requestId: crypto.randomUUID(),
      id: active.id,
      expectedVersion: active.version,
      action: 'edit',
      inputImages: [],
    }),
    /Return the task to the queue/,
  )
})
test('attachment reads are confined to images recorded on the addressed task', async () => {
  const f = fixtureBoard()
  const recorded = ref()
  const created = await f.controller.create(
    request({ inputImages: [recorded] }),
  )
  const bytes = Buffer.from(await fixture('fixture-description.png'), 'base64')
  const url = await inputImageDataUrl(created, recorded.attachmentId, async () => ({
    data: bytes,
    mediaType: 'image/png',
  }))
  assert.match(url, /^data:image\/png;base64,/)
  await assert.rejects(
    inputImageDataUrl(created, 'foreign-attachment', async () => ({
      data: bytes,
      mediaType: 'image/png',
    })),
    /not recorded/,
  )
  await assert.rejects(
    inputImageDataUrl(created, recorded.attachmentId, async () => {
      throw Error('digest mismatch')
    }),
    /failed verification: digest mismatch/,
  )
  const snapshot = JSON.stringify(f.controller.snapshot())
  assert.ok(!snapshot.includes('base64'))
  assert.ok(!snapshot.includes('"data"'))
})
test('phase prompts carry ordered source labels and metadata but never image bytes', async () => {
  const f = fixtureBoard()
  const created = await f.controller.create(
    request({
      intake: true,
      inputImages: [
        ref({ source: 'description', attachmentId: 'one' }),
        ref({
          source: 'criteria',
          attachmentId: 'two',
          name: 'fixture-criteria.jpg',
          mediaType: 'image/jpeg',
          bytes: 650,
        }),
      ],
    }),
  )
  for (const prompt of [
    analysisPrompt(created),
    taskPrompt(created),
    reviewPrompt(created),
  ]) {
    const facts = prompt.split('TASK_DATA=')[1].split('\n')[0]
    const data = JSON.parse(facts)
    assert.equal(data.inputImages.length, 2)
    assert.deepEqual(
      data.inputImages.map((i) => [i.order, i.source]),
      [
        [1, 'description'],
        [2, 'criteria'],
      ],
    )
    assert.ok(!prompt.includes('base64'))
    assert.ok(!/"data"/.test(prompt))
  }
  assert.match(
    imageLabel(created.inputImages[1], 2, 2),
    /INPUT_IMAGE 2\/2 source=criteria/,
  )
  const calls = []
  const runtime = {
    readImage: async (image) => {
      calls.push(image.attachmentId)
      return Buffer.from('bytes')
    },
  }
  const content = await phaseContent(runtime, created, 'PROMPT')
  assert.deepEqual(calls, ['one', 'two'])
  assert.equal(content.length, 5)
  assert.equal(content[0].text, 'PROMPT')
  assert.match(content[1].text, /INPUT_IMAGE 1\/2 source=description/)
  assert.deepEqual(content[2], {
    type: 'image',
    mediaType: 'image/png',
    data: Buffer.from('bytes').toString('base64'),
    name: 'fixture-description.png',
  })
  assert.match(content[3].text, /INPUT_IMAGE 2\/2 source=criteria/)
  assert.equal(content[4].type, 'image')
})
test('bounded repair reminder reuses text only and never duplicates image parts', async () => {
  const f = fixtureBoard()
  const stats = { prompts: [], reads: 0 }
  const created = await f.controller.create(
    request({ intake: true, inputImages: [ref()] }),
  )
  const analyzing = await f.controller.beginAnalysis(
    'a',
    created.id,
    created.version,
  )
  const runtime = {
    readImage: async () => {
      stats.reads++
      return Buffer.from('bytes')
    },
    prompt: async (_session, content) => {
      stats.prompts.push(content)
    },
    idle: async () => {},
    running: () => false,
  }
  await runPhase(
    f.controller,
    runtime,
    analyzing,
    'a',
    'analysis',
    analysisPrompt(analyzing),
  )
  assert.equal(stats.prompts.length, 2)
  assert.equal(stats.prompts[0].filter((p) => p.type === 'image').length, 1)
  assert.equal(stats.prompts[1].length, 1)
  assert.match(stats.prompts[1][0].text, /REPORT_REMINDER/)
  assert.ok(!stats.prompts[1].some((p) => p.type === 'image'))
  // The ordered image parts are read once; the text-only reminder reuses no parts.
  assert.equal(stats.reads, 1)
})
test('a text-only route blocks image work with a clear capability message', async () => {
  const f = fixtureBoard()
  const created = await f.controller.create(
    request({
      intake: true,
      criteria: [],
      inputImages: [ref()],
      completionPolicy: { mode: 'reviewed', instructions: '', checks: [] },
    }),
  )
  let prompts = 0
  const dispatcher = new Dispatcher(
    f.controller,
    {
      create: async () => 'b',
      prompt: async () => {
        prompts++
      },
      idle: async () => {},
      running: () => false,
      readImage: async () => Buffer.from('bytes'),
      imageRoute: async () => ({
        provider: 'deepseek',
        model: 'text-only-model',
        images: false,
      }),
    },
    () => {},
  )
  dispatcher.configure('ws', true)
  await new Promise((resolve) => setTimeout(resolve, 40))
  const blocked = f.controller.snapshot().tasks.find((t) => t.id === created.id)
  assert.equal(prompts, 0)
  assert.equal(blocked.status, 'blocked')
  assert.match(
    blocked.evidence,
    /Image input is unsupported by deepseek\/text-only-model/,
  )
  assert.match(blocked.evidence, /not silently dropped/)
  assert.equal(dispatcher.snapshot().error, null)
  await dispatcher.close()
})
test('lab wire flow persists image references and rejects foreign keeps', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'perse-image-test-'))
  const b = await makeBackend(folder)
  try {
    const wire = await draft()
    const created = await b.owner.create({
      ...request({ workspaceId: 'alpha', inputImages: [wire] }),
    })
    assert.equal(created.inputImages.length, 1)
    assert.equal(created.inputImages[0].source, 'description')
    assert.ok(created.inputImages[0].width >= 1)
    assert.equal(created.inputImages[0].bytes, Buffer.from(wire.data, 'base64').length)
    assert.match(
      await b.owner.inputImage({
        id: created.id,
        attachmentId: created.inputImages[0].attachmentId,
      }),
      /^data:image\/png;base64,/,
    )
    await assert.rejects(
      b.owner.inputImage({
        id: created.id,
        attachmentId: 'foreign-attachment',
      }),
      /not recorded/,
    )
    await assert.rejects(
      b.owner.create({
        ...request({
          workspaceId: 'alpha',
          inputImages: [await draft({ mediaType: 'image/svg+xml' })],
        }),
      }),
      /image-unsupported|Unsupported image type/,
    )
    const edited = await b.owner.update({
      requestId: crypto.randomUUID(),
      id: created.id,
      expectedVersion: created.version,
      action: 'edit',
      inputImages: [
        { keep: true, attachmentId: created.inputImages[0].attachmentId },
        await draft({ source: 'criteria' }),
      ],
    })
    assert.equal(edited.inputImages.length, 2)
    assert.equal(edited.inputImages[1].source, 'criteria')
    await assert.rejects(
      b.owner.update({
        requestId: crypto.randomUUID(),
        id: edited.id,
        expectedVersion: edited.version,
        action: 'edit',
        inputImages: [{ keep: true, attachmentId: 'foreign-attachment' }],
      }),
      /image-missing|no longer recorded/,
    )
  } finally {
    await b.close()
    await rm(folder, { recursive: true, force: true })
  }
})
