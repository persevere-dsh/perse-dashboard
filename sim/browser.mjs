/** Browser-to-real-DSH journeys; setup uses the documented Gateway, product actions use visible UI. */
import { chromium, expect } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
const run = process.env.PERSEVERE_DSH_SIM
if (!run) throw Error('Use scripts/sim')
const runtime = JSON.parse(
  await fs.readFile(path.join(run, 'runtime.json'), 'utf8'),
)
const browser = await chromium.launch({
    headless: true,
    ...(process.env.PERSEVERE_DSH_BROWSER
      ? { channel: process.env.PERSEVERE_DSH_BROWSER }
      : {}),
  }),
  context = await browser.newContext({
    viewport: { width: 1510, height: 1050 },
    locale: 'zh-CN',
  }),
  page = await context.newPage(),
  results = [],
  errors = []
const logs = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => logs.push({ type: m.type(), text: m.text() }))
const diagnostics = new AbortController()
let graphLog
const check = (name) => {
  results.push({ check: name, passed: true })
  console.log('PASS ' + name)
}
async function rpc(endpoint, payload = {}, target = page) {
  return target.evaluate(
    async ({ endpoint, payload }) => {
      const response = await fetch(`api/${endpoint}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'client-request',
          rpcId: crypto.randomUUID(),
          method: endpoint,
          payload: { args: payload },
        }),
      })
      if (!response.ok) throw Error(`HTTP ${response.status}`)
      const body = await response.json()
      if (!body.result.ok) throw Error(JSON.stringify(body.result.error))
      return body.result.value
    },
    { endpoint, payload },
  )
}
const snapshot = () => rpc('perseDashboard/snapshot')
const HAN = /[\u4e00-\u9fff]/
const hasHan = (value) => HAN.test(String(value ?? ''))
const traceFile = path.join(runtime.home, 'sim-model-trace.jsonl')
const readTrace = async () =>
  (await fs.readFile(traceFile, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
const inputFixture = async (name) => ({
  name,
  base64: (
    await fs.readFile(new URL(`./fixtures/input-images/${name}`, import.meta.url))
  ).toString('base64'),
})
async function pasteImage(textarea, name, type) {
  const file = await inputFixture(name)
  await textarea.evaluate(
    (element, image) => {
      const bytes = Uint8Array.from(atob(image.base64), (c) => c.charCodeAt(0))
      const transfer = new DataTransfer()
      transfer.items.add(new File([bytes], image.name, { type: image.type }))
      element.dispatchEvent(
        new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: transfer,
        }),
      )
    },
    { ...file, type },
  )
}
async function expectImageCards(control, count) {
  await expect(control.locator('.pd-input-image')).toHaveCount(count)
  await expect
    .poll(() =>
      control
        .locator('.pd-input-image-preview img')
        .evaluateAll((images) => images.map((img) => img.naturalWidth)),
    )
    .toEqual(Array(count).fill(12))
}
const IMAGE_FIXTURES = {
  png: ['fixture-description.png', 'image/png'],
  jpg: ['fixture-criteria.jpg', 'image/jpeg'],
  webp: ['fixture-extra.webp', 'image/webp'],
  gif: ['fixture-fourth.gif', 'image/gif'],
}
async function closeDetail(target = page) {
  const close = target.getByRole('button', { name: '关闭详情', exact: true })
  if (await close.isVisible()) await close.click()
}
async function board(target = page) {
  await closeDetail(target)
  await target.getByText('工作看板', { exact: true }).first().click()
  await expect(
    target.getByRole('heading', { name: '工作看板', exact: true }),
  ).toBeVisible()
}
async function until(fn, expected, timeout = 60000) {
  await expect
    .poll(fn, { timeout, intervals: [100, 300, 700] })
    .toEqual(expected)
}
// DSH business-blue: light deepseek-500; dark resolves from the active DSH theme.
const LIGHT_BLUE = 'rgb(65, 118, 230)'
const DARK_BLUE = 'rgb(122, 170, 255)'
const RETIRED_ORANGE = 'rgb(240, 176, 58)'
const computed = (locator, property, pseudo = null) =>
  locator.evaluate(
    (el, { property, pseudo }) => getComputedStyle(el, pseudo)[property],
    { property, pseudo },
  )
function rgbParts(value) {
  const match = value.match(
    /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+[\d.]+)?\s*\)$/,
  )
  if (!match) throw Error(`Unsupported CSS color: ${value}`)
  return match.slice(1, 4).map(Number)
}
function contrastRatio(foreground, background) {
  const luminance = (value) =>
    rgbParts(value)
      .map((channel) => channel / 255)
      .map((channel) =>
        channel <= 0.04045
          ? channel / 12.92
          : ((channel + 0.055) / 1.055) ** 2.4,
      )
      .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0)
  const [a, b] = [luminance(foreground), luminance(background)].sort(
    (x, y) => y - x,
  )
  return (a + 0.05) / (b + 0.05)
}
async function expectBusinessBlue(target, blue, label) {
  const primary = target.getByRole('button', {
    name: '新建任务',
    exact: true,
  })
  // Dark mode is applied asynchronously after emulateMedia; wait for the token.
  await expect
    .poll(() => computed(primary, 'backgroundColor'), {
      timeout: 10000,
      intervals: [100, 250, 500],
    })
    .toBe(blue)
  const background = await computed(primary, 'backgroundColor')
  expect(background).toBe(blue)
  expect(background).not.toBe(RETIRED_ORANGE)
  expect(await computed(primary, 'borderTopColor')).toBe(blue)
  const icons = target.locator('.pd-stat-icon')
  await expect(icons).toHaveCount(5)
  for (let index = 0; index < 5; index++)
    expect(await computed(icons.nth(index), 'color')).toBe(blue)
  const foreground = await computed(primary, 'color')
  const contrast = contrastRatio(foreground, background)
  expect(contrast).toBeGreaterThanOrEqual(3)
  check(
    `primary button, stat icons and readable label use DSH business-blue (${label}, contrast ${contrast.toFixed(2)}:1)`,
  )
}
async function expectFocusRing(target, blue, label) {
  const primary = target.getByRole('button', {
    name: '新建任务',
    exact: true,
  })
  await expect(primary).toBeVisible()
  await expect(primary).toBeEnabled()
  // Focus the preceding focusable element, then reach the button with Tab.
  // The keyboard step (not .focus()) is what activates :focus-visible.
  const index = await primary.evaluate((button) => {
    const focusable = [
      ...document.querySelectorAll(
        'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])',
      ),
    ].filter((element) => {
      const style = getComputedStyle(element)
      return (
        style.visibility !== 'hidden' &&
        style.display !== 'none' &&
        element.getClientRects().length > 0
      )
    })
    const at = focusable.indexOf(button)
    if (at > 0) focusable[at - 1].focus()
    return at
  })
  expect(index).toBeGreaterThan(0)
  let reached = false
  for (let step = 0; step < 12 && !reached; step++) {
    await target.keyboard.press('Tab')
    reached = await primary.evaluate((el) => el === document.activeElement)
  }
  expect(reached).toBe(true)
  expect(await primary.evaluate((el) => el.matches(':focus-visible'))).toBe(
    true,
  )
  const ring = await primary.evaluate((el) => {
    const style = getComputedStyle(el)
    return {
      color: style.outlineColor,
      style: style.outlineStyle,
      width: style.outlineWidth,
    }
  })
  expect(ring.style).toBe('solid')
  expect(ring.width).toBe('2px')
  expect(ring.color).toBe(blue)
  check(`keyboard focus ring uses DSH business-blue (${label})`)
}
// Assumes the task detail dialog is already open; leaves it open on Overview.
async function expectOpenDetailAccent(target, blue, screenshot) {
  const selected = target.locator(
    '.pd-detail-tabs button[aria-selected=true]',
  )
  await expect(selected).toBeVisible()
  expect(await computed(selected, 'borderBottomColor')).toBe(blue)
  await target.locator('.pd-detail-tabs button').last().click()
  // The 150ms border-color transition must finish before visual evidence.
  await target.waitForTimeout(250)
  expect(await computed(selected, 'borderBottomColor')).toBe(blue)
  const audit = target.locator('.pd-audit').first()
  await expect(audit).toBeVisible()
  expect(await computed(audit, 'backgroundColor', '::before')).toBe(blue)
  if (screenshot)
    await target.screenshot({ path: path.join(run, screenshot) })
  // Restore the Overview tab so later task acceptance still sees its checklist.
  await target.locator('.pd-detail-tabs button').first().click()
}
async function expectDetailAccent(target, blue, title, screenshot) {
  await target.locator('.pd-card').filter({ hasText: title }).first().click()
  await expectOpenDetailAccent(target, blue, screenshot)
  await closeDetail(target)
  check(
    `selected tab underline and audit node use DSH business-blue (${title})`,
  )
}
try {
  const binding = JSON.parse(
    await fs.readFile(path.join(run, 'artifact-binding.json'), 'utf8'),
  )
  expect(binding.installedPackage).toBe(true)
  expect(binding.clientPath).toBe(binding.expectedPath)
  expect(binding.clientPath).toMatch(
    /[\\/]profiles[\\/]web[\\/]node_modules[\\/]perse-dashboard[\\/]lib[\\/]client\.js$/,
  )
  check('DSH resolves the installed tarball artifact outside the checkout')
  await page.goto(runtime.authUrl)
  const cookies = (await context.cookies())
    .map((c) => `${c.name}=${c.value}`)
    .join('; ')
  graphLog = (async () => {
    const response = await fetch(runtime.url + '/plugins/events', {
      headers: { cookie: cookies },
      signal: diagnostics.signal,
    })
    const reader = response.body.getReader(),
      decoder = new TextDecoder()
    let pending = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      pending += decoder.decode(value, { stream: true })
      let i
      while ((i = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, i)
        pending = pending.slice(i + 1)
        if (line.startsWith('data:'))
          await fs.appendFile(
            path.join(run, 'client-graph.jsonl'),
            line.slice(5).trim() + '\n',
          )
      }
    }
  })().catch((e) => {
    if (!diagnostics.signal.aborted)
      logs.push({ type: 'graph-diagnostic', text: String(e) })
  })
  const cont = page.getByRole('button', { name: '继续', exact: true })
  await page
    .getByText('工作看板', { exact: true })
    .first()
    .waitFor({ timeout: 15000 })
  try {
    await cont.waitFor({ timeout: 5000 })
    await cont.click()
  } catch (e) {
    if (!String(e).includes('Timeout')) throw e
  }
  await board()
  await expect(page.getByText('正在连接 DSH…')).toHaveCount(0)
  check('native slot loads without DOM injection')
  await expect(page.locator('.pd-next-steps,.pd-next-grid')).toHaveCount(0)
  check('board has no duplicate next-step task grid')
  const created = await rpc('workspace/create', {
      request: { path: runtime.workspace, title: 'Dashboard simulation' },
    }),
    ws = created.workspace.workspaceId
  await page
    .getByRole('combobox', { name: '全部工作区', exact: true })
    .selectOption(ws)
  await page.getByRole('button', { name: '新建任务', exact: true }).click()
  const form = page.locator('form.pd-create')
  const title =
    runtime.lane === 'live'
      ? 'Live DSH isolated verification'
      : 'Native DSH contract verification'
  await form.getByLabel('标题', { exact: true }).fill(title)
  await form
    .getByLabel('任务说明', { exact: true })
    .fill(
      runtime.lane === 'live'
        ? 'In this disposable workspace, write sim-result.txt containing exactly DSH_DASHBOARD_LIVE_OK (no newline). Read it back and report evidence through dashboard_report. Do not access any other directory.'
        : 'Exercise the native task tool contract and submit deterministic evidence. No external model inference is used in this lane.',
    )
  await form.getByLabel('执行前自动分析议题', { exact: true }).uncheck()
  await expect(
    form
      .getByRole('radiogroup', { name: '完成策略', exact: true })
      .getByRole('radio', { name: '独立复核通过后自动完成', exact: true }),
  ).toBeChecked()
  await form
    .getByRole('radiogroup', { name: '完成策略', exact: true })
    .getByRole('radio', { name: '人工验收', exact: true })
    .check()
  await expect(
    form
      .getByRole('radiogroup', { name: '完成策略', exact: true })
      .getByRole('radio', { name: '人工验收', exact: true }),
  ).toBeChecked()
  await form
    .getByRole('radiogroup', { name: '优先级', exact: true })
    .getByRole('radio', { name: '高', exact: true })
    .check()
  await expect(
    form
      .getByRole('radiogroup', { name: '分配到会话', exact: true })
      .getByRole('radio', { name: '工作区队列', exact: true }),
  ).toBeChecked()
  const criterion =
    runtime.lane === 'live'
      ? 'sim-result.txt contains exactly DSH_DASHBOARD_LIVE_OK with no newline'
      : 'Native DSH tools return a verified evidence report'
  await form.getByLabel('验收标准（每行一条）', { exact: true }).fill(criterion)
  await form.getByRole('button', { name: '创建任务', exact: true }).click()
  await expect(
    page.locator('.pd-card').filter({ hasText: title }),
  ).toBeVisible()
  let task = (await snapshot()).tasks.find((t) => t.title === title)
  expect(task.status).toBe('todo')
  expect(task.priority).toBe(2)
  expect(task.assignee).toBe(null)
  expect(task.language).toBe('zh')
  check('task creation is durable, persists the active zh language and never executes a model')
  await expectBusinessBlue(page, LIGHT_BLUE, 'light')
  // Creation opens the detail dialog, so inspect its accent before dismissing it.
  await expectOpenDetailAccent(
    page,
    LIGHT_BLUE,
    'theme-detail-light.png',
  )
  check('selected tab underline and audit node use DSH business-blue (light)')

  await page.getByRole('button', { name: '准备 DSH 草稿', exact: true }).click()
  await expect(page.locator('[contenteditable="true"]').first()).toContainText(
    '使用 dashboard_claim_next',
  )
  await expect(page.locator('[contenteditable="true"]').first()).toContainText(
    'dashboard_report',
  )
  expect((await snapshot()).tasks.find((t) => t.id === task.id).status).toBe(
    'todo',
  )
  check('handoff opens an unsent native DSH draft in the active Chinese locale')
  await board()
  await expectFocusRing(page, LIGHT_BLUE, 'light')
  await page
    .getByRole('combobox', { name: '全部工作区', exact: true })
    .selectOption(ws)
  // The native queue uses SessionController and official Agent tools, not a fake HTTP task executor.
  await page.getByRole('button', { name: '启动队列', exact: true }).click()
  await until(
    async () => {
      const s = await snapshot()
      const t = s.tasks.find((t) => t.id === task.id)
      if (t?.status === 'blocked' || s.dispatch.error)
        throw Error(JSON.stringify({ task: t, dispatch: s.dispatch }))
      return t?.status
    },
    'in-review',
    runtime.lane === 'live' ? 120000 : 30000,
  )
  await until(async () => (await snapshot()).dispatch.enabled, false)

  task = (await snapshot()).tasks.find((t) => t.id === task.id)
  expect(task.sessionId).toBeTruthy()
  expect(task.evidence.length).toBeGreaterThan(5)
  expect(task.checked).toEqual([false])
  if (runtime.lane === 'native') {
    const executionTrace = (await readTrace()).find(
      (entry) =>
        entry.taskId === task.id &&
        entry.phase === 'execution' &&
        !entry.reminder,
    )
    expect(executionTrace).toBeTruthy()
    expect(executionTrace.language).toBe('zh')
    expect(executionTrace.user).toContain('处理看板任务')
    expect(executionTrace.user).toContain('PERSE_PHASE=execution')
    expect(executionTrace.user).not.toContain('Work on dashboard task')
    expect(hasHan(executionTrace.user)).toBe(true)
  }
  check(
    'native queue atomically claims and reports evidence without auto-accepting; zh tasks use the Chinese phase prompt',
  )
  if (runtime.lane === 'native') {
    expect(
      await fs.readFile(path.join(runtime.workspace, 'sim-shell.txt'), 'utf8'),
    ).toBe('DSH_SIM_SHELL_OK')
    check('deterministic provider invokes the real workspace shell tool')
  }
  if (runtime.lane === 'live') {
    expect(
      await fs.readFile(path.join(runtime.workspace, 'sim-result.txt'), 'utf8'),
    ).toBe('DSH_DASHBOARD_LIVE_OK')
    check('real model wrote and read the exact isolated artifact')
  }
  await page.locator('.pd-card').filter({ hasText: title }).click()
  await expect(
    page.getByRole('button', { name: '确认验收并完成' }),
  ).toBeDisabled()
  await page.getByLabel(criterion, { exact: true }).click()
  await expect(page.getByLabel(criterion, { exact: true })).toBeChecked()
  await expect(
    page.getByRole('button', { name: '确认验收并完成' }),
  ).toBeEnabled()
  await page.getByRole('button', { name: '确认验收并完成' }).click()
  await until(
    async () => (await snapshot()).tasks.find((t) => t.id === task.id).status,
    'done',
  )
  check('only explicit human acceptance completes the task')
  if (runtime.lane === 'native') {
    const pull = await rpc('perseDashboard/create', {
      request: {
        requestId: crypto.randomUUID(),
        workspaceId: ws,
        title: 'Agent pull contract',
        description: 'Claim through actual DSH tool',
        criteria: ['Actual agent claim and report'],
        priority: 2,
        assignee: null,
      },
    })
    const session = await rpc('session/create', {
      request: { workspaceId: ws, sessionId: `session-${crypto.randomUUID()}` },
    })
    await rpc('session/prompt', {
      request: {
        sessionId: session.sessionId,
        requestId: crypto.randomUUID(),
        mode: 'queue',
        content: [
          {
            type: 'text',
            text: `Use dashboard_claim_next with taskId "${pull.id}". Then report concrete evidence with dashboard_report.`,
          },
        ],
      },
    })
    await until(
      async () => (await snapshot()).tasks.find((t) => t.id === pull.id).status,
      'in-review',
      30000,
    )
    const after = await snapshot()
    expect(after.tasks.find((t) => t.id === pull.id).sessionId).toBe(
      session.sessionId,
    )
    expect(
      after.ledger.filter((a) => a.taskId === pull.id).map((a) => a.action),
    ).toEqual(['create', 'claim', 'report'])
    check('agent autonomously claims through the real DSH tool then reports')
  }
  // Automatic intake and completion are exercised through the visible production UI.
  await closeDetail()
  await page.getByRole('button', { name: '新建任务', exact: true }).click()
  const automatic = page.locator('form.pd-create')
  const autoTitle = 'Automatic native intake and independent review'
  await automatic.getByLabel('标题', { exact: true }).fill(autoTitle)
  await automatic
    .getByLabel('任务说明', { exact: true })
    .fill(
      runtime.lane === 'live'
        ? 'Write auto-result.txt containing exactly DSH_AUTO_LIVE_OK: 16 ASCII bytes, no BOM and no trailing newline or whitespace. Read it back. Independent reviewer must read this file and compare it byte-for-byte against the criterion. Leave existing files unchanged and use only this disposable workspace.'
        : 'Write auto-result.txt containing exactly DSH_AUTO_NATIVE_OK and verify it.',
    )
  await automatic
    .getByLabel('验收标准（可选）', { exact: true })
    .fill(
      'auto-result.txt contains exactly ' +
        (runtime.lane === 'live'
          ? 'DSH_AUTO_LIVE_OK (16 ASCII bytes, no BOM, no trailing newline or whitespace)'
          : 'DSH_AUTO_NATIVE_OK'),
    )
  await automatic.getByText('高级完成规则', { exact: true }).click()
  await automatic
    .getByLabel('完成规则提示词', { exact: true })
    .fill(
      'Inspect the actual file using a native workspace tool. Only pass if its exact content matches the approved expected value; unavailable checks must fail.',
    )
  await automatic
    .getByRole('button', { name: '添加机器规则', exact: true })
    .click()
  await automatic
    .getByLabel('工作区文件路径', { exact: true })
    .fill('auto-result.txt')
  await automatic
    .getByLabel('期望内容或哈希', { exact: true })
    .fill(runtime.lane === 'live' ? 'DSH_AUTO_LIVE_OK' : 'DSH_AUTO_NATIVE_OK')
  await automatic.getByRole('button', { name: '创建任务', exact: true }).click()
  await expect(
    page.locator('.pd-card').filter({ hasText: autoTitle }),
  ).toBeVisible()
  const intake = (await snapshot()).tasks.find((t) => t.title === autoTitle)
  expect(intake.status).toBe('triage')
  await closeDetail()
  await page
    .getByRole('button', { name: '持续分析与处理', exact: true })
    .click()
  await until(
    async () => {
      const s = await snapshot(),
        t = s.tasks.find((t) => t.id === intake.id)
      if (t.status === 'blocked' || s.dispatch.error)
        throw Error(JSON.stringify({ t, dispatch: s.dispatch }))
      return t.status
    },
    'done',
    runtime.lane === 'live' ? 180000 : 60000,
  )
  const completed = (await snapshot()).tasks.find((t) => t.id === intake.id)
  expect(completed.completion.kind).toBe('reviewed')
  expect(
    new Set([
      completed.sessionId,
      completed.analysisSessionId,
      completed.reviewSessionId,
    ]).size,
  ).toBe(3)
  expect(completed.review.results.every((r) => r.passed)).toBe(true)
  expect(completed.language).toBe('zh')
  expect(hasHan(completed.analysis.summary)).toBe(true)
  expect(completed.analysis.plan.length).toBeGreaterThan(0)
  expect(completed.analysis.plan.every(hasHan)).toBe(true)
  expect(completed.analysis.questions.every(hasHan)).toBe(true)
  expect(hasHan(completed.evidence)).toBe(true)
  expect(hasHan(completed.review.evidence)).toBe(true)
  expect(completed.review.results.every((r) => hasHan(r.evidence))).toBe(true)
  expect(completed.review.remainingRisks.every(hasHan)).toBe(true)
  if (runtime.lane === 'native') {
    const autoTrace = (await readTrace()).filter(
      (entry) => entry.taskId === intake.id,
    )
    for (const phase of ['analysis', 'execution', 'review']) {
      const request = autoTrace.find(
        (entry) => entry.phase === phase && !entry.reminder,
      )
      expect(request, `missing ${phase} zh request`).toBeTruthy()
      expect(request.language).toBe('zh')
      expect(hasHan(request.user)).toBe(true)
      expect(request.user).toContain(`PERSE_PHASE=${phase}`)
    }
    expect(
      autoTrace.find((entry) => entry.phase === 'analysis' && !entry.reminder)
        .user,
    ).toContain('分析看板议题')
    expect(
      autoTrace.find((entry) => entry.phase === 'review' && !entry.reminder)
        .user,
    ).toContain('复核看板任务')
  }
  check(
    runtime.lane === 'native'
      ? 'zh task analysis summary/plan/questions, execution evidence and review results/remainingRisks are Chinese with Chinese phase prompts'
      : 'live zh task analysis summary/plan, execution evidence and review results/remainingRisks are Chinese',
  )
  await fs.writeFile(
    path.join(run, 'language-evidence.json'),
    JSON.stringify(
      {
        taskId: intake.id,
        language: completed.language,
        title: completed.title,
        analysis: completed.analysis,
        evidence: completed.evidence,
        review: completed.review,
      },
      null,
      2,
    ),
  )
  expect(
    await fs.readFile(path.join(runtime.workspace, 'auto-result.txt'), 'utf8'),
  ).toBe(runtime.lane === 'live' ? 'DSH_AUTO_LIVE_OK' : 'DSH_AUTO_NATIVE_OK')
  expect(
    (await snapshot()).ledger
      .filter((a) => a.taskId === intake.id)
      .map((a) => a.action),
  ).toEqual([
    'create',
    'analysis-start',
    'analysis-report',
    'claim',
    'report',
    'review-start',
    'review-report',
    'auto-complete',
  ])
  check(
    'visible intake → native analysis → atomic claim → execution → separate reviewer → file checks → automatic completion',
  )
  await page.locator('.pd-card').filter({ hasText: autoTitle }).click()
  await expect(page.locator('.pd-detail')).toContainText('自动完成')
  await page
    .locator('.pd-detail')
    .screenshot({ path: path.join(run, 'automatic-evidence.png') })
  await closeDetail()
  await page.getByRole('button', { name: '暂停后续议题', exact: true }).click()
  check('watcher stays armed between issues and can be paused from the UI')
  if (runtime.lane === 'native') {
    const broken = await rpc('perseDashboard/create', {
      request: {
        requestId: crypto.randomUUID(),
        workspaceId: ws,
        title: 'Native missing phase report',
        description: 'PERSE_MISSING_ANALYSIS',
        criteria: [],
        priority: 1,
        assignee: null,
        intake: true,
        completionPolicy: { mode: 'reviewed', instructions: '', checks: [] },
      },
    })
    const repaired = await rpc('perseDashboard/create', {
      request: {
        requestId: crypto.randomUUID(),
        workspaceId: ws,
        title: 'Native bounded report repair',
        description: 'PERSE_MISSING_ONCE PERSE_IMAGE_EVIDENCE',
        criteria: [],
        priority: 1,
        assignee: null,
        intake: true,
        completionPolicy: { mode: 'reviewed', instructions: '', checks: [] },
      },
    })
    await page.getByRole('button', { name: '启动队列', exact: true }).click()
    await until(
      async () =>
        (await snapshot()).tasks.find((t) => t.id === repaired.id)?.status,
      'done',
      60000,
    )
    const state = await snapshot()
    const repairedTask = state.tasks.find((t) => t.id === repaired.id)
    expect(repairedTask.images).toHaveLength(1)
    expect(repairedTask.language).toBe('en')
    const repairedTrace = (await readTrace()).find(
      (entry) =>
        entry.taskId === repaired.id &&
        entry.phase === 'analysis' &&
        !entry.reminder,
    )
    expect(repairedTrace).toBeTruthy()
    expect(repairedTrace.language).toBe('en')
    expect(repairedTrace.user).toContain('Analyze dashboard issue')
    expect(repairedTrace.user).not.toContain('分析看板议题')
    check(
      'an English task without a persisted language is inferred as en and keeps the English phase prompt',
    )
    await page
      .locator('.pd-card')
      .filter({ hasText: 'Native bounded report repair' })
      .click()
    const evidenceImage = page.locator('.pd-image-evidence img')
    await expect(evidenceImage).toBeVisible()
    await expect
      .poll(() => evidenceImage.evaluate((img) => img.naturalWidth))
      .toBe(1)
    await page
      .getByRole('button', {
        name: '预览证据图片: Native image readback',
        exact: true,
      })
      .click()
    await expect(page.locator('.pd-image-preview')).toBeVisible()
    await page.getByRole('button', { name: '关闭图片', exact: true }).click()
    await page.screenshot({
      path: path.join(run, 'native-recovered-image-evidence.png'),
      fullPage: true,
    })
    await closeDetail()
    check(
      'recorded image evidence is loaded through real owner Remote and previews within native DSH CSP',
    )
    expect(state.tasks.find((t) => t.id === broken.id).status).toBe('blocked')
    expect(state.dispatch.error).toBeNull()
    await page
      .locator('.pd-card')
      .filter({ hasText: 'Native missing phase report' })
      .click()
    await expect(page.locator('.pd-next-detail')).toContainText('一次补报提醒')
    await page.getByRole('button', { name: '恢复任务', exact: true }).click()
    await until(
      async () =>
        (await snapshot()).tasks.find((t) => t.id === broken.id)?.status,
      'triage',
    )
    await closeDetail()
    const deferred = (await snapshot()).tasks.find((t) => t.id === broken.id)
    await rpc('perseDashboard/update', {
      request: {
        requestId: crypto.randomUUID(),
        id: deferred.id,
        expectedVersion: deferred.version,
        action: 'archive',
      },
    })
    check(
      'real DSH reasoning-only stops receive one report reminder; task failure is isolated; later issue auto-completes and owner recovery works',
    )
    await page.getByRole('button', { name: '权限设置', exact: true }).click()
    const permissionDialog = page.getByRole('dialog', {
      name: 'DSH 默认执行权限',
      exact: true,
    })
    await expect(
      permissionDialog.getByRole('radio', {
        name: '工作区内修改',
        exact: true,
      }),
    ).toBeChecked()
    await expect(permissionDialog).toContainText(
      '已有会话和指定会话保留各自权限',
    )
    const catalog = await rpc('permissionPresets/catalog')
    expect(catalog.defaultPreset).toBe('workspace-write')
    await page
      .getByRole('button', { name: '关闭权限设置', exact: true })
      .click()
    check(
      'permission default is read from the real DSH catalog and Settings; reads do not change it',
    )
    await page.getByRole('button', { name: '新建任务', exact: true }).click()
    const probe = page.locator('form.pd-create'),
      probeTitle = 'Native pending approval visibility'
    await probe.getByLabel('标题', { exact: true }).fill(probeTitle)
    await probe
      .getByLabel('任务说明', { exact: true })
      .fill(
        'PERSE_APPROVAL_PROBE: request a protected write, never fabricate authorization.',
      )
    await probe
      .getByLabel('验收标准（可选）', { exact: true })
      .fill('Protected fixture must not be written without explicit approval')
    await probe.getByLabel('执行前自动分析议题', { exact: true }).uncheck()
    await probe
      .getByRole('radiogroup', { name: '完成策略', exact: true })
      .getByRole('radio', { name: '人工验收', exact: true })
      .check()
    await probe.getByRole('button', { name: '创建任务', exact: true }).click()
    await expect(
      page.getByRole('dialog', { name: probeTitle, exact: true }),
    ).toBeVisible()
    const pendingTask = (await snapshot()).tasks.find(
      (t) => t.title === probeTitle,
    )
    await closeDetail()
    await page.getByRole('button', { name: '启动队列', exact: true }).click()
    const attention = page.getByRole('alert', {
      name: '需要你处理',
      exact: true,
    })
    await expect(attention).toContainText('等待审批', { timeout: 15000 })
    await expect(
      page.locator('.pd-card').filter({ hasText: probeTitle }),
    ).toContainText('等待审批')
    await expect(
      page.getByRole('region', { name: '自动化处理', exact: true }),
    ).toContainText('等待审批')
    expect(await computed(attention, 'borderTopColor')).toBe(LIGHT_BLUE)
    const attentionStat = page.locator('.pd-stat.is-attention')
    await expect(attentionStat).toHaveCount(1)
    expect(await computed(attentionStat, 'borderTopColor')).toBe(LIGHT_BLUE)
    const attentionIcon = page.locator('.pd-status-icon.is-attention')
    await expect(attentionIcon).toHaveCount(1)
    expect(await computed(attentionIcon.first(), 'backgroundColor')).toBe(
      LIGHT_BLUE,
    )
    check(
      'attention alert, attention stat and automation attention icon use business-blue',
    )
    const beforeApproval = (await snapshot()).tasks.find(
      (t) => t.id === pendingTask.id,
    )
    expect(beforeApproval.status).toBe('in-progress')
    expect(beforeApproval.completion).toBe(null)
    await expect(
      fs.stat(path.join(runtime.workspace, 'sim-approval-granted.txt')),
    ).rejects.toThrow(/ENOENT/)
    await page.screenshot({
      path: path.join(run, 'pending-approval-board.png'),
      fullPage: true,
    })
    await page.locator('.pd-card').filter({ hasText: probeTitle }).click()
    await page
      .getByRole('button', { name: '在 DSH 中查看请求 ↗', exact: true })
      .click()
    await expect(
      page.getByRole('button', { name: '拒绝', exact: true }),
    ).toBeVisible()
    // Only this disposable simulated request is rejected. No real Desktop request is touched.
    await page.getByRole('button', { name: '拒绝', exact: true }).click()
    await until(
      async () =>
        (await snapshot()).tasks.find((t) => t.id === pendingTask.id)?.status,
      'blocked',
    )
    await board()
    await expect(attention).toHaveCount(0)
    await expect(
      fs.stat(path.join(runtime.workspace, 'sim-approval-granted.txt')),
    ).rejects.toThrow(/ENOENT/)
    check(
      'actual DSH approval remains pending while the board warns; explicit isolated rejection clears it without granting a write or marking done',
    )
  }
  if (runtime.lane === 'native') {
    await closeDetail()
    await board()
    await page.getByRole('button', { name: '新建任务', exact: true }).click()
    const imageForm = page.locator('form.pd-create'),
      descriptionField = imageForm.getByLabel('任务说明', { exact: true }),
      criteriaField = imageForm.getByLabel('验收标准（可选）', {
        exact: true,
      }),
      descriptionControl = imageForm.locator(
        '.pd-input-images[data-source=description]',
      ),
      criteriaControl = imageForm.locator(
        '.pd-input-images[data-source=criteria]',
      )
    await imageForm.getByLabel('标题', { exact: true }).fill('Image input journey')
    await descriptionField.fill(
      'Native image input journey. PERSE_MISSING_ONCE Exercise the pasted images through analysis, execution and review.',
    )
    await criteriaField.fill(
      'Every phase receives the ordered input images and the recorded attachment matches the uploaded fixture',
    )
    await pasteImage(descriptionField, ...IMAGE_FIXTURES.png)
    await pasteImage(criteriaField, ...IMAGE_FIXTURES.jpg)
    await expectImageCards(descriptionControl, 1)
    await expectImageCards(criteriaControl, 1)
    await expect(descriptionControl).toContainText('任务说明')
    await expect(descriptionControl).toContainText('87 B')
    await expect(criteriaControl).toContainText('验收标准')
    await expect(criteriaControl).toContainText('650 B')
    await expect(descriptionControl.getByRole('button', { name: '移除图片: fixture-description.png', exact: true })).toHaveCount(1)
    await pasteImage(descriptionField, ...IMAGE_FIXTURES.webp)
    await pasteImage(criteriaField, ...IMAGE_FIXTURES.gif)
    await expectImageCards(descriptionControl, 2)
    await expectImageCards(criteriaControl, 2)
    await expect(page.locator('form.pd-create .pd-input-image')).toHaveCount(4)
    await expect(descriptionControl).toContainText('88 B')
    await expect(criteriaControl).toContainText('60 B')
    await expect(
      descriptionControl.getByRole('button', { name: /移除图片/ }),
    ).toHaveCount(2)
    await expect(
      criteriaControl.getByRole('button', { name: /移除图片/ }),
    ).toHaveCount(2)
    await imageForm.screenshot({
      path: path.join(run, 'input-images-form.png'),
    })
    await criteriaControl
      .getByRole('button', { name: '移除图片: fixture-fourth.gif', exact: true })
      .click()
    await expectImageCards(criteriaControl, 1)
    await expect(page.locator('form.pd-create .pd-input-image')).toHaveCount(3)
    await criteriaControl.locator('input[type=file]').setInputFiles({
      name: 'fixture-fourth.gif',
      mimeType: 'image/gif',
      buffer: await fs.readFile(
        new URL('./fixtures/input-images/fixture-fourth.gif', import.meta.url),
      ),
    })
    await expectImageCards(criteriaControl, 2)
    await expect(page.locator('form.pd-create .pd-input-image')).toHaveCount(4)
    check(
      'create form accepts pasted and attached PNG/JPEG/WebP/GIF with source labels, byte sizes, thumbnails and remove controls',
    )
    await pasteImage(descriptionField, 'fixture-description.png', 'image/svg+xml')
    await expect(descriptionControl.getByRole('alert')).toContainText(
      '不支持的图片格式',
    )
    await descriptionField.evaluate((element, max) => {
      const transfer = new DataTransfer()
      transfer.items.add(
        new File([new Uint8Array(max + 1)], 'huge.png', { type: 'image/png' }),
      )
      element.dispatchEvent(
        new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: transfer,
        }),
      )
    }, (await snapshot()).imageLimits.maxImageBytes)
    await expect(descriptionControl.getByRole('alert')).toContainText('上限')
    await criteriaControl
      .getByRole('button', { name: '移除图片: fixture-fourth.gif', exact: true })
      .click()
    await expectImageCards(criteriaControl, 1)
    await descriptionField.evaluate((element) => {
      const transfer = new DataTransfer()
      transfer.items.add(
        new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], 'broken.png', {
          type: 'image/png',
        }),
      )
      element.dispatchEvent(
        new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: transfer,
        }),
      )
    })
    await expect(descriptionControl.getByRole('alert')).toContainText(
      '无法解码',
    )
    await criteriaControl.locator('input[type=file]').setInputFiles({
      name: 'fixture-fourth.gif',
      mimeType: 'image/gif',
      buffer: await fs.readFile(
        new URL('./fixtures/input-images/fixture-fourth.gif', import.meta.url),
      ),
    })
    await expectImageCards(criteriaControl, 2)
    await pasteImage(descriptionField, ...IMAGE_FIXTURES.png)
    await expect(descriptionControl.getByRole('alert')).toContainText('最多 4 张')
    await expect(page.locator('form.pd-create .pd-input-image')).toHaveCount(4)
    check(
      'unsupported, oversized, corrupt and over-count pastes fail visibly before submit and add no image',
    )
    // GIF admission and preview are proven above. DSH normalizes GIF bytes, so
    // the hash-equality journey keeps the byte-stable PNG/JPEG/WebP fixtures.
    await criteriaControl
      .getByRole('button', { name: '移除图片: fixture-fourth.gif', exact: true })
      .click()
    await expectImageCards(criteriaControl, 1)
    await expect(page.locator('form.pd-create .pd-input-image')).toHaveCount(3)
    await imageForm.getByRole('button', { name: '创建任务', exact: true }).click()
    await expect(
      page.getByRole('dialog', { name: 'Image input journey', exact: true }),
    ).toBeVisible()
    const imageTask = (await snapshot()).tasks.find(
      (t) => t.title === 'Image input journey',
    )
    expect(imageTask.inputImages).toHaveLength(3)
    expect(
      imageTask.inputImages.map((image) => [image.source, image.mediaType]),
    ).toEqual([
      ['description', 'image/png'],
      ['criteria', 'image/jpeg'],
      ['description', 'image/webp'],
    ])
    expect(
      imageTask.inputImages.every(
        (image) => image.bytes > 0 && image.width === 12 && image.height === 8,
      ),
    ).toBe(true)
    expect(JSON.stringify(imageTask)).not.toContain('base64')
    expect(JSON.stringify(imageTask)).not.toContain('"data"')
    const gallery = page.locator('.pd-input-image-gallery')
    await expect(gallery.locator('.pd-input-image')).toHaveCount(3)
    await expect
      .poll(() =>
        gallery
          .locator('img')
          .evaluateAll((images) => images.map((img) => img.naturalWidth)),
      )
      .toEqual([12, 12, 12])
    await page
      .locator('.pd-detail')
      .screenshot({ path: path.join(run, 'input-images-detail.png') })
    check(
      'created task persists image metadata only and restores Remote-loaded previews',
    )
    await page
      .getByRole('tab', { name: '属性与规则', exact: true })
      .click()
    await page.getByText('编辑任务', { exact: true }).click()
    const editor = page.locator('.pd-detail details').filter({
      hasText: '编辑任务',
    })
    const editorDescription = editor.locator(
        '.pd-input-images[data-source=description]',
      ),
      editorCriteria = editor.locator(
        '.pd-input-images[data-source=criteria]',
      )
    await expectImageCards(editorDescription, 2)
    // The editor's acceptance-criteria field accepts pasted images too.
    await editor.getByRole('button', { name: '添加标准', exact: true }).click()
    await pasteImage(
      editor.locator('.pd-criterion-input input').first(),
      ...IMAGE_FIXTURES.jpg,
    )
    await expectImageCards(editorCriteria, 2)
    await editorCriteria
      .getByRole('button', { name: '移除图片: fixture-criteria.jpg', exact: true })
      .last()
      .click()
    await expectImageCards(editorCriteria, 1)
    await editor
      .getByRole('button', { name: '移除标准 1', exact: true })
      .click()
    check('edit form accepts pasted images in the acceptance-criteria field')
    await editorDescription
      .getByRole('button', { name: '移除图片: fixture-extra.webp', exact: true })
      .click()
    await pasteImage(
      editor.locator('.pd-field textarea').first(),
      ...IMAGE_FIXTURES.png,
    )
    await expectImageCards(editorDescription, 2)
    await editor.locator('button.pd-primary').click()
    await until(
      async () =>
        (await snapshot()).tasks
          .find((t) => t.id === imageTask.id)
          ?.inputImages.map((image) => image.name),
      ['fixture-description.png', 'fixture-criteria.jpg', 'fixture-description.png'],
    )
    const editedTask = (await snapshot()).tasks.find(
      (t) => t.id === imageTask.id,
    )
    expect(
      editedTask.inputImages.map((image) => [image.source, image.name]),
    ).toEqual([
      ['description', 'fixture-description.png'],
      ['criteria', 'fixture-criteria.jpg'],
      ['description', 'fixture-description.png'],
    ])
    check('edit form pastes, removes and saves image references additively')
    await page.reload()
    await board()
    await page
      .locator('.pd-card')
      .filter({ hasText: 'Image input journey' })
      .click()
    await expect(page.locator('.pd-input-image-gallery .pd-input-image')).toHaveCount(3)
    await expect
      .poll(() =>
        page
          .locator('.pd-input-image-gallery img')
          .evaluateAll((images) => images.map((img) => img.naturalWidth)),
      )
      .toEqual([12, 12, 12])
    check('reload restores persisted input-image previews through the owner Remote')
    await closeDetail()
    await page
      .getByRole('combobox', { name: '全部工作区', exact: true })
      .selectOption(ws)
    await page.getByRole('button', { name: '启动队列', exact: true }).click()
    await until(
      async () => (await snapshot()).tasks.find((t) => t.id === imageTask.id)?.status,
      'done',
      120000,
    )
    const finished = (await snapshot()).tasks.find((t) => t.id === imageTask.id)
    expect(finished.completion.kind).toBe('reviewed')
    expect(
      new Set([
        finished.sessionId,
        finished.analysisSessionId,
        finished.reviewSessionId,
      ]).size,
    ).toBe(3)
    check(
      'image task completes analysis → execution → independent review with automatic completion',
    )
    const trace = (await fs.readFile(
      path.join(runtime.home, 'sim-model-trace.jsonl'),
      'utf8',
    ))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
      .filter((entry) => entry.taskId === imageTask.id)
    const expectedHashes = await Promise.all(
      ['fixture-description.png', 'fixture-criteria.jpg', 'fixture-description.png'].map(
        async (name) => {
          const { createHash } = await import('node:crypto')
          return createHash('sha256')
            .update(
              await fs.readFile(
                new URL(`./fixtures/input-images/${name}`, import.meta.url),
              ),
            )
            .digest('hex')
        },
      ),
    )
    for (const phase of ['analysis', 'execution', 'review']) {
      const request = trace.find(
        (entry) => entry.phase === phase && !entry.reminder,
      )
      expect(request, `missing ${phase} request trace`).toBeTruthy()
      expect(request.language).toBe('zh')
      expect(hasHan(request.user)).toBe(true)
      expect(request.user).toContain(`PERSE_PHASE=${phase}`)
      expect(request.imageBlocks).toBe(3)
      expect(request.images.map((image) => image.sha256)).toEqual(expectedHashes)
      expect(request.labels).toHaveLength(3)
      expect(
        request.labels.map((label, index) => {
          expect(label).toContain(`INPUT_IMAGE ${index + 1}/3`)
          return label.match(/source=(description|criteria)/)?.[1]
        }),
      ).toEqual(['description', 'criteria', 'description'])
      expect(request.user).toContain('"inputImages"')
      expect(request.user).not.toContain('base64')
    }
    const reminder = trace.find(
      (entry) => entry.phase === 'analysis' && entry.reminder,
    )
    expect(reminder).toBeTruthy()
    expect(reminder.language).toBe('zh')
    expect(reminder.user).toContain('上一轮结束时没有提交')
    expect(reminder.user).toContain('REPORT_REMINDER: ')
    expect(reminder.user).not.toContain('The previous turn ended')
    expect(reminder.imageBlocks).toBe(0)
    expect(reminder.labels).toHaveLength(0)
    check(
      'analysis, execution and review requests carry 3 image blocks whose SHA-256 equals the uploaded PNG/JPEG/WebP fixtures; the zh repair reminder body is Chinese and carries no images',
    )
    const textSession = await rpc('session/create', {
      request: { workspaceId: ws, sessionId: `session-${crypto.randomUUID()}` },
    })
    await rpc('session/selectModel', {
      request: {
        sessionId: textSession.sessionId,
        provider: 'dashboard-sim',
        model: 'sim-text',
      },
    })
    const textOnly = await rpc('perseDashboard/create', {
      request: {
        requestId: crypto.randomUUID(),
        workspaceId: ws,
        title: 'Text-only route image guard',
        description: 'This task needs image perception.',
        criteria: ['The route declares image input'],
        priority: 1,
        assignee: null,
        intake: false,
        completionPolicy: { mode: 'reviewed', instructions: '', checks: [] },
        inputImages: [
          {
            mediaType: 'image/png',
            data: (await inputFixture('fixture-description.png')).base64,
            name: 'fixture-description.png',
            source: 'description',
          },
        ],
      },
    })
    await rpc('perseDashboard/update', {
      request: {
        requestId: crypto.randomUUID(),
        id: textOnly.id,
        expectedVersion: textOnly.version,
        action: 'assign',
        assignee: textSession.sessionId,
      },
    })
    await page.getByRole('button', { name: '启动队列', exact: true }).click()
    await until(
      async () => (await snapshot()).tasks.find((t) => t.id === textOnly.id)?.status,
      'blocked',
      30000,
    )
    const guarded = (await snapshot()).tasks.find((t) => t.id === textOnly.id)
    expect(guarded.evidence).toContain(
      'Image input is unsupported by dashboard-sim/sim-text',
    )
    expect(guarded.evidence).toContain('not silently dropped')
    await page
      .locator('.pd-card')
      .filter({ hasText: 'Text-only route image guard' })
      .click()
    await expect(page.locator('.pd-next-detail')).toContainText(
      'Image input is unsupported',
    )
    await page.screenshot({
      path: path.join(run, 'input-images.png'),
      fullPage: true,
    })
    await closeDetail()
    check(
      'a text-only model route blocks image work with a visible capability message instead of dropping images',
    )
  }
  if (runtime.lane === 'live') {
    await closeDetail()
    await board()
    await page
      .getByRole('combobox', { name: '全部工作区', exact: true })
      .selectOption(ws)
    await page.getByRole('button', { name: '新建任务', exact: true }).click()
    const liveForm = page.locator('form.pd-create'),
      liveDescription = liveForm.getByLabel('任务说明', { exact: true }),
      liveControl = liveForm.locator(
        '.pd-input-images[data-source=description]',
      )
    await liveForm
      .getByLabel('标题', { exact: true })
      .fill('Live image perception')
    await liveDescription.fill(
      'The pasted input image is a solid colored square. Look at the actual image and determine whether it is red, green or blue. In this disposable workspace, write live-image.txt containing exactly the matching uppercase color name (RED, GREEN or BLUE) and no newline. Read it back and report evidence through dashboard_report. Do not access any other directory.',
    )
    await liveForm
      .getByLabel('执行前自动分析议题', { exact: true })
      .uncheck()
    await liveForm
      .getByRole('radiogroup', { name: '完成策略', exact: true })
      .getByRole('radio', { name: '人工验收', exact: true })
      .check()
    await pasteImage(liveDescription, ...IMAGE_FIXTURES.png)
    await expectImageCards(liveControl, 1)
    const liveCriterion =
      'live-image.txt contains exactly RED with no newline'
    await liveForm
      .getByLabel('验收标准（每行一条）', { exact: true })
      .fill(liveCriterion)
    await liveForm.getByRole('button', { name: '创建任务', exact: true }).click()
    await expect(
      page.getByRole('dialog', { name: 'Live image perception', exact: true }),
    ).toBeVisible()
    const liveTask = (await snapshot()).tasks.find(
      (t) => t.title === 'Live image perception',
    )
    expect(liveTask.inputImages).toHaveLength(1)
    await closeDetail()
    await page.getByRole('button', { name: '启动队列', exact: true }).click()
    await until(
      async () => (await snapshot()).tasks.find((t) => t.id === liveTask.id)?.status,
      'in-review',
      180000,
    )
    expect(
      await fs.readFile(path.join(runtime.workspace, 'live-image.txt'), 'utf8'),
    ).toBe('RED')
    check(
      'real image-capable model perceived the pasted fixture and wrote its exact color',
    )
    await page
      .locator('.pd-card')
      .filter({ hasText: 'Live image perception' })
      .click()
    await page.getByLabel(liveCriterion, { exact: true }).click()
    await page.getByRole('button', { name: '确认验收并完成' }).click()
    await until(
      async () => (await snapshot()).tasks.find((t) => t.id === liveTask.id)?.status,
      'done',
    )
    await page.screenshot({
      path: path.join(run, 'live-image.png'),
      fullPage: true,
    })
    await closeDetail()
    check('live image task records explicit owner acceptance after real perception')
  }
  await fs.writeFile(
    path.join(run, 'protocol-fixture.json'),
    JSON.stringify(
      {
        runtimeVersion: runtime.runtimeVersion,
        synthetic: runtime.lane === 'native',
        snapshot: await snapshot(),
      },
      null,
      2,
    ),
  )
  await closeDetail()
  await page.locator('.pd-card').filter({ hasText: title }).click()
  await page
    .locator('.pd-detail')
    .screenshot({ path: path.join(run, 'task-evidence.png') })
  await closeDetail()
  await page.screenshot({
    path: path.join(run, 'dashboard.png'),
    fullPage: true,
  })
  await page.locator('.pd-card').filter({ hasText: title }).click()
  const second = await context.newPage()
  await second.goto(runtime.url)
  await board(second)
  await expect(
    second.locator('.pd-card').filter({ hasText: title }),
  ).toBeVisible()
  check('second client receives the authoritative task baseline')
  await page.getByRole('button', { name: '归档', exact: true }).click()
  await until(
    async () => (await snapshot()).tasks.find((t) => t.id === task.id).archived,
    true,
  )
  await expect(
    second.locator('.pd-card').filter({ hasText: title }),
  ).toHaveCount(0)
  check('task changes stream to another client')
  await closeDetail()
  await page.getByLabel('显示归档', { exact: true }).check()
  await page.locator('.pd-card').filter({ hasText: title }).click()
  await page.getByRole('button', { name: '恢复', exact: true }).click()
  await expect(
    second.locator('.pd-card').filter({ hasText: title }),
  ).toBeVisible()
  check('archive has a visible restore path')
  const before = await snapshot()
  const stale = {
    requestId: crypto.randomUUID(),
    id: task.id,
    expectedVersion: 1,
    action: 'edit',
    title: 'stale',
  }
  await expect(
    rpc('perseDashboard/update', { request: stale }),
  ).rejects.toThrow(/conflict/)
  expect((await snapshot()).revision).toBe(before.revision)
  check('stale writes fail without changing durable state')
  await page.reload()
  await board()
  await expect(
    page.locator('.pd-card').filter({ hasText: title }),
  ).toBeVisible()
  check('reload rebuilds state from the Host')
  await page.locator('.pd-card').filter({ hasText: title }).click()
  await page.getByRole('button', { name: '打开 DSH 会话', exact: true }).click()
  await expect(page.locator('body')).toContainText(
    /SIM_NATIVE_OK|DSH_DASHBOARD_LIVE_OK/,
  )
  check('linked task opens the real native conversation')
  await board()
  await page.setViewportSize({ width: 430, height: 900 })
  await expectBusinessBlue(page, LIGHT_BLUE, 'mobile light')
  await page.screenshot({ path: path.join(run, 'mobile.png'), fullPage: true })
  await page.setViewportSize({ width: 1510, height: 1050 })
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
  await expectBusinessBlue(page, DARK_BLUE, 'dark')
  await expectFocusRing(page, DARK_BLUE, 'dark')
  await expectDetailAccent(
    page,
    DARK_BLUE,
    title,
    'theme-detail-dark.png',
  )
  await page.screenshot({ path: path.join(run, 'dark.png'), fullPage: true })
  expect(errors).toEqual([])
  check('no browser runtime errors')
  await fs.writeFile(
    path.join(run, 'browser-results.json'),
    JSON.stringify(results, null, 2),
  )
  console.log(JSON.stringify(results))
} catch (error) {
  results.push({ check: 'journey', passed: false, error: String(error) })
  await fs.writeFile(
    path.join(run, 'browser-results.json'),
    JSON.stringify(results, null, 2),
  )
  await page.screenshot({
    path: path.join(run, 'failure.png'),
    fullPage: true,
  })
  await fs.writeFile(
    path.join(run, 'failure.txt'),
    await page.locator('body').innerText(),
  )
  await fs.writeFile(
    path.join(run, 'console.json'),
    JSON.stringify({ errors, logs }, null, 2),
  )
  try {
    await page
      .getByRole('button', { name: '插件', exact: true })
      .click({ timeout: 2000 })
    await new Promise((resolve) => setTimeout(resolve, 2500))
    await fs.writeFile(
      path.join(run, 'plugin-diagnostics.txt'),
      await page.locator('body').innerText(),
    )
  } catch {}
  throw error
} finally {
  diagnostics.abort()
  await graphLog
  await browser.close()
}
