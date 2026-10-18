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
try {
  const binding = JSON.parse(
    await fs.readFile(path.join(run, 'artifact-binding.json'), 'utf8'),
  )
  expect(binding.installedPackage).toBe(true)
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
  await form.getByLabel('完成策略', { exact: true }).selectOption('manual')
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
  check('task creation is durable and never executes a model')

  await page.getByRole('button', { name: '准备 DSH 草稿', exact: true }).click()
  await expect(page.locator('[contenteditable="true"]').first()).toContainText(
    'dashboard_claim_next',
  )
  expect((await snapshot()).tasks.find((t) => t.id === task.id).status).toBe(
    'todo',
  )
  check('handoff opens an unsent native DSH draft')
  await board()
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
  check(
    'native queue atomically claims and reports evidence without auto-accepting',
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
        ? 'Write auto-result.txt containing exactly DSH_AUTO_LIVE_OK (no newline). Read it back. Independent reviewer must read this file and compare it against the criterion. Use only this disposable workspace.'
        : 'Write auto-result.txt containing exactly DSH_AUTO_NATIVE_OK and verify it.',
    )
  await automatic
    .getByLabel('验收标准（每行一条）', { exact: true })
    .fill(
      'auto-result.txt contains exactly ' +
        (runtime.lane === 'live' ? 'DSH_AUTO_LIVE_OK' : 'DSH_AUTO_NATIVE_OK'),
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
      .getByLabel('验收标准（每行一条）', { exact: true })
      .fill('Protected fixture must not be written without explicit approval')
    await probe.getByLabel('执行前自动分析议题', { exact: true }).uncheck()
    await probe.getByLabel('完成策略', { exact: true }).selectOption('manual')
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
  await page.screenshot({ path: path.join(run, 'mobile.png'), fullPage: true })
  await page.setViewportSize({ width: 1510, height: 1050 })
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
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
