import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  OWNER_EXPECTATIONS_EN,
  OWNER_EXPECTATIONS_ZH,
  detectTaskLanguage,
  normalizeDescription,
  resolveTaskLanguage,
  taskDescription,
} from '../lib/types/contract/language.js'
import { boardSchema, BoardController, initialBoard } from '../lib/types/host/board.js'
import {
  analysisPrompt,
  reportReminder,
  reviewPrompt,
  taskPrompt,
} from '../lib/types/host/prompts.js'
import { runPhase } from '../lib/types/host/phases.js'
import { automationNoteText } from '../lib/types/client/notes.js'
import { handoffPrompt } from '../lib/types/client/handoff.js'
import { en, zh } from '../lib/types/client/locales.js'
const task = (extra = {}) => ({
  id: 'task-1',
  workspaceId: 'ws',
  title: '任务',
  description: '实现功能',
  criteria: ['结果可验证'],
  checked: [false],
  evidence: '',
  images: [],
  inputImages: [],
  language: 'zh',
  priority: 1,
  assignee: null,
  sessionId: null,
  status: 'triage',
  version: 1,
  archived: false,
  createdAt: 1,
  updatedAt: 1,
  intake: true,
  needsManual: false,
  analysisSessionId: null,
  analysis: null,
  reviewSessionId: null,
  reviewPromptHash: null,
  review: null,
  completionPolicy: { mode: 'manual', instructions: '', checks: [] },
  completion: null,
  automationNote: '',
  ...extra,
})
const ownerRequest = (extra = {}) => ({
  requestId: crypto.randomUUID(),
  workspaceId: 'ws',
  title: 'Task',
  description: 'Implement',
  criteria: ['Verified'],
  priority: 1,
  assignee: null,
  ...extra,
})
function fixture() {
  let data = initialBoard(),
    id = 0
  const env = {
    workspaces: () => [{ id: 'ws', path: '/tmp', sessionIds: ['a', 'b'] }],
    now: () => 100,
    id: () => `task-${++id}`,
  }
  const controller = new BoardController(
    {
      get: () => data,
      set: async (v) => {
        data = structuredClone(v)
      },
    },
    env,
  )
  return { controller, env }
}
test('language inference is deterministic for zh, en, mixed and empty content', () => {
  assert.equal(detectTaskLanguage({ title: '修复登录问题' }), 'zh')
  assert.equal(detectTaskLanguage({ title: 'Fix login flow' }), 'en')
  assert.equal(
    detectTaskLanguage({
      title: 'Fix login 修复登录流程',
      description: '补充错误提示并验证',
    }),
    'zh',
  )
  assert.equal(
    detectTaskLanguage({
      title: 'Update dashboard',
      description: 'Align English UI copy with the current locale',
    }),
    'en',
  )
  assert.equal(detectTaskLanguage({ title: '', description: '', criteria: [] }), 'en')
  assert.equal(detectTaskLanguage({}), 'en')
  // Generated English criteria do not override owner-authored Chinese text.
  assert.equal(
    detectTaskLanguage({
      title: '任务说明和验收标准不支持贴图片',
      description: '请支持图片内容',
      criteria: [
        'Create and edit forms accept pasted images in both fields.',
        'Task snapshots carry metadata only, never base64.',
      ],
    }),
    'zh',
  )
})
test('task language priority is persisted value, then content inference, then fallback', () => {
  assert.equal(
    resolveTaskLanguage({
      language: 'en',
      title: '这是一个中文标题',
      description: '中文说明',
    }),
    'en',
  )
  assert.equal(
    resolveTaskLanguage({ language: 'zh', title: 'English title' }),
    'zh',
  )
  assert.equal(resolveTaskLanguage({ title: '中文标题' }), 'zh')
  assert.equal(resolveTaskLanguage({ language: null, title: 'English title' }), 'en')
  assert.equal(resolveTaskLanguage({ language: null, title: '' }), 'en')
})
test('legacy English intake marker renders in Chinese without rewriting the task', () => {
  const description = `任务背景\n\n${OWNER_EXPECTATIONS_EN}\n登录失败时应提示原因。`
  const legacy = task({ language: null, description, version: 7 })
  const before = structuredClone(legacy)
  assert.match(taskDescription(legacy), /所有者补充的验收期望：/)
  assert.ok(!taskDescription(legacy).includes('Acceptance expectations'))
  assert.deepEqual(legacy, before)
  assert.equal(legacy.version, 7)
  assert.equal(normalizeDescription(description, 'en'), description)
  assert.equal(normalizeDescription(description, 'zh'), taskDescription(legacy))
})
test('create persists the active language and infers when an older client omits it', async () => {
  const { controller } = fixture()
  const explicit = await controller.create(
    ownerRequest({ language: 'zh', title: 'English title', description: 'English' }),
  )
  assert.equal(explicit.language, 'zh')
  const inferredZh = await controller.create(
    ownerRequest({ title: '实现中文任务', description: '补充说明' }),
  )
  assert.equal(inferredZh.language, 'zh')
  const inferredEn = await controller.create(ownerRequest())
  assert.equal(inferredEn.language, 'en')
  const edited = await controller.update({
    requestId: crypto.randomUUID(),
    id: explicit.id,
    expectedVersion: explicit.version,
    action: 'edit',
    title: 'Changed title',
  })
  assert.equal(edited.language, 'zh')
})
test('five legacy tasks without language still load, open and analyze', async () => {
  const legacyDescriptions = [
    `任务一\n\n${OWNER_EXPECTATIONS_EN}\n标准一`,
    `任务二\n\n${OWNER_EXPECTATIONS_EN}\n标准二`,
    `任务三\n\n${OWNER_EXPECTATIONS_EN}\n标准三`,
    `任务四\n\n${OWNER_EXPECTATIONS_EN}\n标准四`,
    `任务五\n\n${OWNER_EXPECTATIONS_EN}\n标准五`,
  ]
  const raw = {
    revision: 5,
    tasks: legacyDescriptions.map((description, index) => {
      const row = task({
        id: `legacy-${index + 1}`,
        title: `历史任务 ${index + 1}`,
        description,
      })
      delete row.language
      return row
    }),
    ledger: [],
    receipts: [],
  }
  const parsed = boardSchema.parse(raw)
  assert.equal(parsed.tasks.length, 5)
  for (const row of parsed.tasks) {
    assert.equal(row.language, null)
    assert.equal(resolveTaskLanguage(row), 'zh')
    assert.match(taskDescription(row), /所有者补充的验收期望：/)
    assert.ok(!taskDescription(row).includes('Acceptance expectations'))
    const prompt = analysisPrompt(row)
    const facts = JSON.parse(prompt.split('TASK_DATA=')[1].split('\n')[0])
    assert.equal(facts.language, 'zh')
    assert.match(facts.description, /所有者补充的验收期望：/)
    assert.match(prompt, /分析看板议题/)
  }
})
test('zh and en prompts keep machine contracts while localizing owner-facing text', () => {
  const zhTask = task({ description: `中文说明\n\n${OWNER_EXPECTATIONS_EN}\n标准` })
  const enTask = task({ language: 'en', title: 'Fix login', description: 'Implement' })
  const zhAnalysis = analysisPrompt(zhTask),
    zhExecution = taskPrompt(zhTask),
    zhReview = reviewPrompt(zhTask)
  assert.match(zhAnalysis, /分析看板议题/)
  assert.match(zhAnalysis, /dashboard_triage/)
  assert.match(zhAnalysis, /taskId/)
  assert.match(zhAnalysis, /expectedVersion/)
  assert.match(zhAnalysis, /analysis \{summary,plan,risk,route,questions\}/)
  assert.match(zhAnalysis, /criteria/)
  assert.match(zhAnalysis, /PERSE_PHASE=analysis/)
  assert.ok(!zhAnalysis.includes('Analyze dashboard issue'))
  assert.ok(!zhAnalysis.includes(OWNER_EXPECTATIONS_EN))
  assert.match(zhExecution, /处理看板任务/)
  assert.match(zhExecution, /dashboard_report/)
  assert.match(zhExecution, /outcome=review/)
  assert.match(zhExecution, /PERSE_PHASE=execution/)
  assert.ok(!zhExecution.includes('Work on dashboard task'))
  assert.match(zhReview, /复核看板任务/)
  assert.match(zhReview, /dashboard_review/)
  assert.match(zhReview, /EXECUTOR_EVIDENCE=/)
  assert.match(zhReview, /PERSE_PHASE=review/)
  assert.ok(!zhReview.includes('Review dashboard task'))
  for (const prompt of [zhAnalysis, zhExecution, zhReview]) {
    assert.match(prompt, /TASK_DATA=/)
    const facts = JSON.parse(prompt.split('TASK_DATA=')[1].split('\n')[0])
    for (const key of [
      'taskId',
      'version',
      'title',
      'description',
      'criteria',
      'analysis',
      'completionPolicy',
      'needsManual',
      'inputImages',
    ])
      assert.ok(key in facts, key)
  }
  const enAnalysis = analysisPrompt(enTask)
  assert.match(enAnalysis, /Analyze dashboard issue/)
  assert.match(enAnalysis, /dashboard_triage/)
  assert.match(enAnalysis, /PERSE_PHASE=analysis/)
  assert.ok(!enAnalysis.includes('分析看板议题'))
  assert.match(taskPrompt(enTask), /Work on dashboard task/)
  assert.match(reviewPrompt(enTask), /Review dashboard task/)
})
test('report reminders are Chinese for zh tasks and English for en tasks', () => {
  const zhReminder = reportReminder(task(), 'execution', 3)
  assert.match(zhReminder, /^REPORT_REMINDER: /)
  assert.match(zhReminder, /不要重复实施/)
  assert.doesNotMatch(zhReminder, /Do not repeat implementation/)
  const zhAnalysis = reportReminder(task(), 'analysis', 4)
  assert.match(zhAnalysis, /REPORT_REMINDER: /)
  assert.match(zhAnalysis, /dashboard_triage/)
  const enReminder = reportReminder(task({ language: 'en' }), 'execution', 3)
  assert.match(enReminder, /^REPORT_REMINDER: /)
  assert.match(enReminder, /Do not repeat implementation/)
})
test('phase runner sends the localized reminder through the official prompt API', async () => {
  for (const language of ['zh', 'en']) {
    const phases = []
    const current = task({ language, analysisSessionId: 'analyst', status: 'triage' })
    const board = { snapshot: () => ({ tasks: [current] }) }
    const runtime = {
      readImage: async () => new Uint8Array(),
      prompt: async (_session, content) => phases.push(content),
      idle: async () => {},
    }
    await runPhase(
      board,
      runtime,
      current,
      'analyst',
      'analysis',
      language === 'zh' ? '分析提示' : 'Analysis prompt',
    )
    assert.equal(phases.length, 2)
    const reminder = phases[1][0].text
    assert.match(reminder, /REPORT_REMINDER: /)
    if (language === 'zh') {
      assert.match(reminder, /上一轮结束时没有提交/)
      assert.doesNotMatch(reminder, /The previous turn ended/)
    } else {
      assert.match(reminder, /The previous turn ended/)
    }
  }
})
test('automation machine notes render in Chinese while stored tokens stay untouched', () => {
  const t = (key) => zh[key],
    tr = (key) => en[key]
  assert.equal(
    automationNoteText('human-acceptance-required', t),
    zh.humanGateNote,
  )
  assert.equal(
    automationNoteText('Human implementation required', t),
    zh.machineHumanImplementation,
  )
  assert.ok(
    automationNoteText('Machine verification failed: missing.txt', t).startsWith(
      zh.machineVerificationFailed,
    ),
  )
  assert.ok(
    automationNoteText(
      'Automatic verification unavailable: network down',
      t,
    ).startsWith(zh.machineVerificationUnavailable),
  )
  assert.equal(
    automationNoteText(
      'A linked Agent resumed during verification. Completion remains pending.',
      t,
    ),
    zh.machineAgentResumed,
  )
  assert.equal(
    automationNoteText('Where should the result go?', t),
    'Where should the result go?',
  )
  assert.equal(automationNoteText('review-failed', t), zh.reviewFailedNote)
  assert.equal(
    automationNoteText('Human implementation required', tr),
    en.machineHumanImplementation,
  )
  for (const key of [
    'ownerExpectations',
    'handoffPrompt',
    'machineHumanImplementation',
    'machineVerificationFailed',
    'machineVerificationUnavailable',
    'machineAgentResumed',
  ]) {
    assert.equal(typeof zh[key], 'string', `zh.${key}`)
    assert.equal(typeof en[key], 'string', `en.${key}`)
  }
})
test('prepared drafts use the active locale and keep the tool contract', () => {
  const zhDraft = handoffPrompt('zh', 'task-9')
  assert.match(zhDraft, /dashboard_claim_next/)
  assert.match(zhDraft, /dashboard_report/)
  assert.match(zhDraft, /task-9/)
  assert.match(zhDraft, /使用/)
  assert.ok(!/^Use dashboard_claim_next/.test(zhDraft))
  const enDraft = handoffPrompt('en', 'task-9')
  assert.match(enDraft, /^Use dashboard_claim_next/)
  assert.match(enDraft, /task-9/)
  assert.ok(!enDraft.includes('使用 '))
})
test('language display helpers never alter accepted evidence or its completion hash', async () => {
  const { controller } = fixture()
  let row = await controller.create(
    ownerRequest({
      description: `保留证据\n\n${OWNER_EXPECTATIONS_EN}\n标准`,
    }),
  )
  row = await controller.claim('a', { requestId: 'claim' })
  row = await controller.report('a', {
    requestId: 'report',
    taskId: row.id,
    expectedVersion: row.version,
    evidence: '原生测试通过，证据不得翻译。',
  })
  row = await controller.update({
    requestId: 'check',
    id: row.id,
    expectedVersion: row.version,
    action: 'edit',
    checked: [true],
  })
  row = await controller.update({
    requestId: 'accept',
    id: row.id,
    expectedVersion: row.version,
    action: 'accept',
  })
  const before = structuredClone(row)
  assert.match(taskDescription(row), /所有者补充的验收期望：/)
  automationNoteText('Machine verification failed: x', (key) => zh[key])
  const after = controller.snapshot().tasks.find((t) => t.id === row.id)
  assert.equal(after.evidence, before.evidence)
  assert.equal(after.completion.evidenceHash, before.completion.evidenceHash)
  assert.deepEqual(after, before)
  await assert.rejects(
    controller.update({
      requestId: 'tamper',
      id: row.id,
      expectedVersion: row.version,
      action: 'edit',
      description: 'changed',
    }),
    /Reopen/,
  )
})

test('opening a legacy task does not rewrite it; the next owner edit persists Chinese', async () => {
  const legacyRow = task({
    id: 'legacy-edit',
    language: null,
    description: `历史说明\n\n${OWNER_EXPECTATIONS_EN}\n历史标准`,
    version: 4,
  })
  delete legacyRow.language
  let state = {
    revision: 1,
    tasks: [boardSchema.parse({ ...initialBoard(), tasks: [legacyRow] }).tasks[0]],
    ledger: [],
    receipts: [],
  }
  const controller = new BoardController(
    {
      get: () => state,
      set: async (value) => {
        state = structuredClone(value)
      },
    },
    {
      workspaces: () => [{ id: 'ws', path: '/tmp', sessionIds: ['a'] }],
      now: () => 200,
      id: () => 'unused',
    },
  )
  const before = controller.snapshot().tasks[0]
  assert.equal(before.version, 4)
  assert.equal(before.description, legacyRow.description)
  assert.equal(before.language, null)
  assert.match(taskDescription(before), /所有者补充的验收期望：/)
  const saved = await controller.update({
    requestId: 'save-normalized',
    id: before.id,
    expectedVersion: before.version,
    action: 'edit',
    title: '已编辑标题',
    description: taskDescription(before),
  })
  assert.equal(saved.version, 5)
  assert.match(saved.description, /所有者补充的验收期望：/)
  assert.ok(!saved.description.includes(OWNER_EXPECTATIONS_EN))
  assert.equal(saved.language, null)
  assert.match(analysisPrompt(saved), /分析看板议题/)
})
