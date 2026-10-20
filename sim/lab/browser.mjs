import { chromium, expect } from '@playwright/test'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
const run = process.env.PERSEVERE_DSH_SIM,
  runtime = JSON.parse(await readFile(path.join(run, 'runtime.json'), 'utf8'))
const fixture = JSON.parse(
    await readFile(
      new URL('../fixtures/scenarios.json', import.meta.url),
      'utf8',
    ),
  ),
  selected = process.env.PERSE_LAB_SCENARIO ?? 'all'
const browser = await chromium.launch({
    headless: true,
    ...(process.env.PERSEVERE_DSH_BROWSER
      ? { channel: process.env.PERSEVERE_DSH_BROWSER }
      : {}),
  }),
  page = await browser.newPage({ viewport: { width: 1500, height: 1000 } }),
  errors = [],
  results = []
page.on('pageerror', (e) => errors.push(e.message))
const api = async (name, body) => {
  const r = await fetch(
    runtime.url + name,
    body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
  )
  const value = await r.json()
  if (!r.ok) throw Error(JSON.stringify(value))
  return value
}
const data = () => api('/data')
const task = async (id) =>
  (await data()).snapshot.tasks.find((t) => t.id === id)
async function closeDetail() {
  const close = page.getByRole('button', { name: 'Close details', exact: true })
  if (await close.isVisible()) await close.click()
}
async function outside(name) {
  await closeDetail()
  await page.getByRole('button', { name, exact: true }).click()
}
async function openTask(id) {
  await page
    .locator('.pd-card')
    .filter({ hasText: (await task(id)).title })
    .click()
}
const labImage = async (name) =>
  (
    await readFile(new URL(`../fixtures/input-images/${name}`, import.meta.url))
  ).toString('base64')
async function pasteLabImage(locator, name, type) {
  await locator.evaluate(
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
    { name, type, base64: await labImage(name) },
  )
}
async function choose(id) {
  await closeDetail()
  await page.getByLabel('Lab scenario', { exact: true }).selectOption(id)
  await expect
    .poll(async () => {
      try {
        return (await api('/control', {})).value.scenario
      } catch {
        return ''
      }
    })
    .toBe(id)
}
async function recover() {
  await page
    .getByRole('button', { name: 'Recover / release gate', exact: true })
    .click()
  await expect(
    page.getByText('Connection unavailable; showing last confirmed data', {
      exact: true,
    }),
  ).toHaveCount(0)
}
async function create(
  title,
  {
    mode = 'reviewed',
    manual = false,
    intake = true,
    checks = false,
    dependencies = [],
    resourceKeys = [],
  } = {},
) {
  const modeLabels = {
    manual: 'Owner acceptance',
    verified: 'Automatic after machine checks',
    reviewed: 'Automatic after independent review',
  }
  await closeDetail()
  await page
    .getByRole('combobox', { name: 'All workspaces', exact: true })
    .selectOption('alpha')
  await page.getByRole('button', { name: 'New task', exact: true }).click()
  const f = page.locator('form.pd-create')
  await f.getByLabel('Title', { exact: true }).fill(title)
  await f
    .getByLabel('Description', { exact: true })
    .fill('Produce an isolated verified result')
  await f
    .getByLabel('Acceptance criteria (optional)', { exact: true })
    .fill('The isolated result is correct')
  await f
    .getByLabel('Analyze issue before execution', { exact: true })
    .setChecked(intake)
  await f
    .getByLabel('Needs manual validation', { exact: true })
    .setChecked(manual)
  for (const dependency of dependencies) {
    const row = f
      .locator('.pd-dependency-editor label')
      .filter({ hasText: dependency })
    await row.locator('input[type=checkbox]').check()
  }
  for (const key of resourceKeys) {
    await f.locator('.pd-resource-editor input').fill(key)
    await f
      .locator('.pd-resource-editor')
      .getByRole('button', { name: 'Add resource key', exact: true })
      .click()
    await expect(
      f.locator('.pd-resource-editor .pd-badge').filter({ hasText: key }),
    ).toBeVisible()
  }
  const policy = f
    .getByRole('radiogroup', { name: 'Completion policy', exact: true })
    .getByRole('radio', { name: modeLabels[mode], exact: true })
  await policy.check()
  await expect(policy).toBeChecked()
  if (checks) {
    await f.getByText('Advanced completion rules', { exact: true }).click()
    await f
      .getByRole('button', { name: 'Add machine check', exact: true })
      .click()
    await f
      .getByLabel('Workspace file path', { exact: true })
      .fill('result.txt')
    await f
      .getByLabel('Expected content or hash', { exact: true })
      .fill('APPROVED_RESULT')
  }
  await f.getByRole('button', { name: 'Create task', exact: true }).click()
  await expect(
    page.locator('.pd-card').filter({ hasText: title }),
  ).toBeVisible()
  return (await data()).snapshot.tasks.find((t) => t.title === title)
}
async function setLanes(value) {
  await closeDetail()
  await page
    .getByRole('combobox', { name: 'All workspaces', exact: true })
    .selectOption('alpha')
  await page.getByLabel('Execution lanes', { exact: true }).fill(String(value))
  const save = page.getByRole('button', { name: 'Save lanes', exact: true })
  if (await save.isEnabled()) await save.click()
  await expect
    .poll(
      async () =>
        (await data()).snapshot.settings.workspaces.alpha?.lanes ?? 2,
    )
    .toBe(value)
}
async function startWatch() {
  await closeDetail()
  await page
    .getByRole('combobox', { name: 'All workspaces', exact: true })
    .selectOption('alpha')
  await page
    .getByRole('button', { name: 'Watch and process issues', exact: true })
    .click()
}
async function script(id, value) {
  await api('/control', { action: 'script', id, script: value })
}
async function release(id) {
  await api('/control', { action: 'release', id })
}
async function waitForSnapshot(predicate, label, timeout = 15000) {
  await expect
    .poll(async () => predicate((await data()).snapshot), {
      timeout,
      intervals: [100, 200, 400],
    })
    .toBe(true)
  return label
}
async function acceptThroughApi(id) {
  await waitForSnapshot(
    (snapshot) => snapshot.tasks.find((t) => t.id === id)?.status === 'in-review',
    'in-review before acceptance',
  )
  const current = await task(id)
  await api('/command/update', {
    requestId: crypto.randomUUID(),
    id,
    expectedVersion: current.version,
    action: 'edit',
    checked: current.criteria.map(() => true),
  })
  const checked = await task(id)
  await api('/command/update', {
    requestId: crypto.randomUUID(),
    id,
    expectedVersion: checked.version,
    action: 'accept',
  })
}
async function queue(id, status) {
  await outside('Start queue')
  await expect
    .poll(async () => (await task(id)).status, { timeout: 10000 })
    .toBe(status)
  await expect
    .poll(async () => (await data()).snapshot.dispatch.enabled)
    .toBe(false)
  await openTask(id)
}
async function check(name, fn) {
  await fn()
  results.at(-1).assertions.push(name)
}
try {
  await page.goto(runtime.url)
  await expect(
    page.getByRole('heading', { name: 'Dashboard', exact: true }),
  ).toBeVisible()
  for (const scenario of fixture.scenarios.filter(
    (s) => selected === 'all' || selected === s.id,
  )) {
    const id = scenario.id
    results.push({ scenario: id, passed: false, assertions: [] })
    await choose(id)
    const cards = page.locator('.pd-card'),
      alert = page.locator('.pd-banner[role=alert]')
    if (id === 'first-load') {
      await expect(
        page.getByText('Connecting to DSH…', { exact: true }),
      ).toBeVisible()
      await recover()
      await expect(cards).toHaveCount(7)
      results
        .at(-1)
        .assertions.push('Initial request remains gated until explicit release')
    } else if (
      ['authentication', 'network', 'server-unavailable'].includes(id)
    ) {
      await expect(alert).toContainText('Connection unavailable')
      await recover()
      await expect(cards).toHaveCount(7)
      results
        .at(-1)
        .assertions.push(
          'Transport failure stays visible and recovers to authoritative baseline',
        )
    } else if (id === 'empty') {
      await expect(
        page.getByText('No tasks here', { exact: true }),
      ).toBeVisible()
      await create('Created from empty', { mode: 'manual', intake: false })
      results
        .at(-1)
        .assertions.push(
          'Empty board supports real create and subsequent detail',
        )
    } else if (id === 'language') {
      const english = await create('English intake expectation', {
        mode: 'manual',
        intake: true,
      })
      expect(english.language).toBe('en')
      expect(english.description).toContain(
        'Acceptance expectations supplied by owner:',
      )
      await closeDetail()
      await page.getByLabel('Language', { exact: true }).selectOption('zh')
      await expect(
        page.getByRole('button', { name: '新建任务', exact: true }),
      ).toBeVisible()
      await page.getByRole('button', { name: '新建任务', exact: true }).click()
      const chineseForm = page.locator('form.pd-create')
      await chineseForm.getByLabel('标题', { exact: true }).fill('中文语言任务')
      await chineseForm
        .getByLabel('任务说明', { exact: true })
        .fill('验证中文界面与任务语言')
      await chineseForm
        .getByLabel('验收标准（可选）', { exact: true })
        .fill('中文验收期望标记已追加')
      await chineseForm
        .getByRole('button', { name: '创建任务', exact: true })
        .click()
      const chinese = (await data()).snapshot.tasks.find(
        (t) => t.title === '中文语言任务',
      )
      expect(chinese.language).toBe('zh')
      expect(chinese.description).toContain('所有者补充的验收期望：')
      expect(chinese.description).not.toContain(
        'Acceptance expectations supplied by owner:',
      )
      await expect(
        page.getByRole('dialog', { name: '中文语言任务', exact: true }),
      ).toContainText('所有者补充的验收期望：')
      await page.screenshot({
        path: path.join(run, 'language-zh-intake.png'),
        fullPage: true,
      })
      await closeDetail()
      await page.getByLabel('Language', { exact: true }).selectOption('en')
      await expect(
        page.getByRole('button', { name: 'New task', exact: true }),
      ).toBeVisible()
      results
        .at(-1)
        .assertions.push(
          'English UI keeps the English intake marker while zh UI persists zh with a Chinese marker; the English interface does not regress',
        )
    } else if (id === 'filtered-empty') {
      await page.getByRole('searchbox').fill('absent-fixture')
      await expect(cards).toHaveCount(0)
      await expect(
        page.getByText('No matching tasks', { exact: true }),
      ).toBeVisible()
      await page.getByRole('searchbox').fill('')
      await expect(cards).toHaveCount(7)
      results
        .at(-1)
        .assertions.push(
          'Filter empty and clearing filters preserve backend records',
        )
    } else if (id === 'partial') {
      await expect(cards).toHaveCount(7)
      await expect(
        page.getByRole('button', { name: 'New task', exact: true }),
      ).toBeDisabled()
      await expect(
        page.getByText(
          'Some commands are unavailable; task data remains readable.',
          { exact: true },
        ),
      ).toBeVisible()
      results
        .at(-1)
        .assertions.push(
          'Capability loss disables mutation while showing complete data',
        )
    } else if (id === 'incompatible') {
      await expect(alert).toContainText('incompatible')
      await expect(
        page.getByRole('button', { name: 'New task', exact: true }),
      ).toBeDisabled()
      await recover()
      await expect(cards).toHaveCount(7)
      results
        .at(-1)
        .assertions.push(
          'Invalid status rejected at the client boundary; valid generation recovers',
        )
    } else if (['offline', 'live-delayed'].includes(id)) {
      if (id === 'offline') await recover()
      await expect(cards).toHaveCount(7)
      await page
        .getByRole('button', { name: 'Disconnect stream', exact: true })
        .click()
      await expect(alert).toContainText('Connection unavailable')
      await expect(cards).toHaveCount(7)
      await expect(
        page.getByRole('button', { name: 'New task', exact: true }),
      ).toBeDisabled()
      await recover()
      await expect(
        page.getByRole('button', { name: 'New task', exact: true }),
      ).toBeEnabled()
      results
        .at(-1)
        .assertions.push(
          'Disconnect retains last snapshot, disables writes, reconnects without duplicate cards',
        )
    } else if (id === 'detail-empty') {
      await expect(cards).toHaveCount(7)
      await cards.filter({ hasText: 'Clarify result' }).click()
      await expect(
        page.getByLabel('Verification evidence', { exact: true }),
      ).toHaveValue('')
      await expect(
        page.getByRole('button', { name: 'Close details', exact: true }),
      ).toBeEnabled()
      results
        .at(-1)
        .assertions.push(
          'Absent optional analysis, evidence and review render usable detail',
        )
    } else if (id === 'detail-error') {
      await expect(cards).toHaveCount(7)
      await cards.filter({ hasText: 'Implement accepted scope' }).click()
      const before = (await data()).snapshot.revision
      await page.getByRole('button', { name: 'Archive', exact: true }).click()
      await expect(alert).toContainText('no commit')
      expect((await data()).snapshot.revision).toBe(before)
      results
        .at(-1)
        .assertions.push(
          'Failed detail mutation shows error and cannot publish phantom commit',
        )
    } else if (id === 'detail-long') {
      await expect(cards).toHaveCount(7)
      await cards.filter({ hasText: 'Clarify result' }).click()
      await expect(
        page.getByLabel('Verification evidence', { exact: true }),
      ).toHaveValue(/VERIFIED_LONG_EVIDENCE/)
      await page.setViewportSize({ width: 430, height: 900 })
      await expect(
        page.getByRole('button', { name: 'Close details', exact: true }),
      ).toBeVisible()
      await page.setViewportSize({ width: 1500, height: 1000 })
      results
        .at(-1)
        .assertions.push(
          'Long legal detail and narrow viewport preserve controls',
        )
    } else if (id === 'dense') {
      await expect(cards).toHaveCount(7)
      await page.getByLabel('Show archived', { exact: true }).check()
      await expect(cards).toHaveCount(8)
      await cards.filter({ hasText: 'Archived experiment' }).click()
      await page.getByRole('button', { name: 'Restore', exact: true }).click()
      await expect
        .poll(async () => (await task('fixture-archived')).archived)
        .toBe(false)
      await page
        .getByRole('button', { name: 'Return to queue', exact: true })
        .click()
      await expect
        .poll(async () => (await task('fixture-archived')).status)
        .toBe('todo')
      await page
        .getByRole('button', { name: 'Close details', exact: true })
        .click()
      await page.getByRole('button', { name: 'Sessions', exact: true }).click()
      await expect(page.locator('tbody tr')).toHaveCount(6)
      await expect(page.locator('tbody')).toContainText('Running')
      await expect(page.locator('tbody')).toContainText('Waiting for approval')
      await page
        .getByRole('button', { name: 'Task board', exact: true })
        .click()
      await page
        .getByRole('combobox', { name: 'All workspaces', exact: true })
        .selectOption('alpha')
      await expect(cards).toHaveCount(5)
      await cards.filter({ hasText: 'Implement accepted scope' }).click()
      await page
        .getByRole('tab', { name: 'Properties & rules', exact: true })
        .click()
      await page.getByText('Edit task', { exact: true }).click()
      await page.getByLabel('Title', { exact: true }).fill('Edited scope')
      await page
        .getByRole('button', { name: 'Save', exact: true })
        .first()
        .click()
      await expect(cards.filter({ hasText: 'Edited scope' })).toBeVisible()
      await page
        .getByRole('combobox', { name: 'Assigned session', exact: true })
        .selectOption('session-alpha-reviewer')
      await expect
        .poll(async () => (await task('fixture-todo')).assignee)
        .toBe('session-alpha-reviewer')
      results
        .at(-1)
        .assertions.push(
          'All states, workspace filter, sessions, archive, restore, reopen, edit and assignment mutate authoritative data',
        )
    } else if (id === 'automation') {
      let t = await create('Reviewed automation')
      await queue(t.id, 'done')
      t = await task(t.id)
      expect(t.completion.kind).toBe('reviewed')
      expect(
        new Set([t.sessionId, t.analysisSessionId, t.reviewSessionId]).size,
      ).toBe(3)
      await expect(
        page.getByText('Automatically completed', { exact: false }),
      ).toBeVisible()
      await page
        .getByRole('tab', { name: 'Analysis & review', exact: true })
        .click()
      await expect(
        page.getByText('Coordination suggestions', { exact: true }),
      ).toBeVisible()
      await expect(page.getByText('Isolation', { exact: true })).toBeVisible()
      await expect(
        page.getByText('Merge risk', { exact: true }),
      ).toBeVisible()
      const verified = await create('File verified automation', {
        mode: 'verified',
        intake: false,
        checks: true,
      })
      await page
        .getByRole('button', { name: 'Analyze this issue', exact: true })
        .click()
      await expect
        .poll(async () => (await task(verified.id)).analysis?.route)
        .toBe('express')
      await expect
        .poll(async () => (await task(verified.id)).status)
        .toBe('todo')
      expect((await task(verified.id)).analysis?.risk).toBe('low')
      await queue(verified.id, 'done')
      expect((await task(verified.id)).completion.kind).toBe('verified')
      await outside('Watch and process issues')
      const watched = await create('New issue while watching')
      await expect
        .poll(async () => (await task(watched.id)).status)
        .toBe('done')
      await outside('Pause subsequent issues')
      expect((await data()).snapshot.dispatch.enabled).toBe(false)
      results
        .at(-1)
        .assertions.push(
          'UI create → analysis → actual claim → execution → distinct review → done; machine checks; watcher handles new issues and pause',
        )
      const paused = await create('Controlled active issue')
      await api('/control', {
        action: 'script',
        id: paused.id,
        script: { holdPhase: 'execution' },
      })
      await outside('Watch and process issues')
      await expect
        .poll(async () => (await task(paused.id)).status)
        .toBe('in-progress')
      await openTask(paused.id)
      await expect(
        page.getByLabel('Assigned session', { exact: true }),
      ).toBeDisabled()
      await expect(page.getByText('Edit task', { exact: true })).toHaveCount(0)
      await outside('Pause subsequent issues')
      const later = await create('Remains queued after pause')
      await outside('Release active phase')
      await expect.poll(async () => (await task(paused.id)).status).toBe('done')
      expect((await task(later.id)).status).toBe('triage')
      await api('/command/update', {
        requestId: crypto.randomUUID(),
        id: later.id,
        expectedVersion: (await task(later.id)).version,
        action: 'archive',
      })
      results
        .at(-1)
        .assertions.push(
          'Stepped execution gate proves pause preserves active work and never starts a later issue',
        )
      const manualTask = await create('Manual acceptance gate', {
        mode: 'manual',
        intake: false,
      })
      await queue(manualTask.id, 'in-review')
      await expect(
        page.getByRole('button', { name: 'Accept and finish', exact: true }),
      ).toBeDisabled()
      await page
        .getByLabel('The isolated result is correct', { exact: true })
        .click()
      await expect(
        page.getByLabel('The isolated result is correct', { exact: true }),
      ).toBeChecked()
      await page
        .getByRole('button', { name: 'Accept and finish', exact: true })
        .click()
      await expect
        .poll(async () => (await task(manualTask.id)).status)
        .toBe('done')
      expect((await task(manualTask.id)).completion.kind).toBe('human')
      results
        .at(-1)
        .assertions.push(
          'Manual policy requires explicit criterion checks and owner acceptance',
        )
    } else if (id === 'analysis-decisions') {
      const one = await create('Single issue analysis')
      await page
        .getByRole('button', { name: 'Analyze this issue', exact: true })
        .click()
      await expect.poll(async () => (await task(one.id)).status).toBe('todo')
      await queue(one.id, 'done')
      results
        .at(-1)
        .assertions.push(
          'Single-issue Analyze command creates a bound analysis Session and freezes criteria',
        )
      for (const route of ['needs-info', 'human', 'staged']) {
        const t = await create('Route ' + route)
        await api('/control', {
          action: 'script',
          id: t.id,
          script: { route },
        })
        await queue(
          t.id,
          route === 'needs-info'
            ? 'needs-info'
            : route === 'human'
              ? 'blocked'
              : 'in-review',
        )
        expect((await task(t.id)).completion).toBeNull()
      }
      const m = await create('Manual marked task', { manual: true })
      await queue(m.id, 'in-review')
      expect((await task(m.id)).analysis.route).toBe('staged')
      results
        .at(-1)
        .assertions.push(
          'Needs-info asks questions, human blocks, staged and manual-marked execute but never auto-complete',
        )
    } else if (id === 'execution-failure') {
      for (const script of [
        { blocked: true },
        { missingReport: true },
        { missingAnalysis: true },
        { promptFailure: true },
      ]) {
        const t = await create('Failure ' + JSON.stringify(script))
        await api('/control', { action: 'script', id: t.id, script })
        await queue(t.id, 'blocked')
        expect((await task(t.id)).completion).toBeNull()
        await api('/command/update', {
          requestId: crypto.randomUUID(),
          id: t.id,
          expectedVersion: (await task(t.id)).version,
          action: 'archive',
        })
      }
      results
        .at(-1)
        .assertions.push(
          'Blocked execution, missing report, missing analysis and prompt failure retain evidence and pause safely',
        )
    } else if (id === 'verification-failure') {
      for (const script of [
        { partialReview: true },
        { reviewVerdict: 'needs-human' },
        { reviewRisk: 'high' },
        { failedReview: true },
        { remainingRisk: true },
        { missingReview: true },
        { wrongFile: true },
      ]) {
        const file = !!script.wrongFile,
          t = await create('Held ' + JSON.stringify(script), {
            mode: file ? 'verified' : 'reviewed',
            intake: file ? false : true,
            checks: file,
          })
        if (file) {
          await page
            .getByRole('button', { name: 'Analyze this issue', exact: true })
            .click()
          await expect
            .poll(async () => (await task(t.id)).analysis?.route)
            .toBe('express')
          await expect.poll(async () => (await task(t.id)).status).toBe('todo')
        }
        await api('/control', { action: 'script', id: t.id, script })
        await queue(t.id, 'in-review')
        const held = await task(t.id)
        expect(held.completion).toBeNull()
        expect(held.automationNote.length).toBeGreaterThan(5)
        if (script.partialReview) {
          await api('/control', { action: 'script', id: t.id, script: {} })
          await page
            .getByRole('button', {
              name: 'Retry automatic verification',
              exact: true,
            })
            .click()
          await expect.poll(async () => (await task(t.id)).status).toBe('done')
          results
            .at(-1)
            .assertions.push(
              'Explicit retry reruns independent review and records automatic completion only after correction',
            )
        }
        await page
          .getByRole('button', { name: 'Close details', exact: true })
          .click()
      }
      results
        .at(-1)
        .assertions.push(
          'Partial, refused, high-risk, failed, risky and absent reviewer plus wrong file cannot reach done',
        )
    } else if (id === 'attention') {
      const issue = await create('Approval wait stays visible', {
        mode: 'manual',
        intake: false,
      })
      await closeDetail()
      await api('/control', {
        action: 'script',
        id: issue.id,
        script: { holdPhase: 'execution' },
      })
      await page
        .getByRole('button', { name: 'Start queue', exact: true })
        .click()
      await expect
        .poll(async () => (await task(issue.id)).status)
        .toBe('in-progress')
      const active = await task(issue.id),
        nativeId = active.sessionId
      const wait = async (kind) =>
        api('/control', { action: 'interaction', id: nativeId, kind })
      await wait('approval')
      const banner = page.getByRole('alert', {
        name: 'Needs attention',
        exact: true,
      })
      await expect(banner).toContainText('Waiting for approval')
      await expect(cards.filter({ hasText: issue.title })).toContainText(
        'Waiting for approval',
      )
      await expect(
        page.getByRole('region', { name: 'Automation', exact: true }),
      ).toContainText('Waiting for approval')
      expect((await task(issue.id)).version).toBe(active.version)
      expect(
        (await data()).sessions.find((s) => s.id === nativeId).running,
      ).toBe(true)
      await page.screenshot({ path: path.join(run, 'approval-board.png') })
      await openTask(issue.id)
      await expect(page.getByRole('dialog')).toContainText(
        'Waiting for approval',
      )
      await page
        .getByRole('button', { name: 'Open request in DSH ↗', exact: true })
        .click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(
        page
          .getByRole('status')
          .filter({ hasText: 'Opened synthetic Session' }),
      ).toContainText(nativeId)
      expect(
        (await data()).sessions.find((s) => s.id === nativeId)
          .pendingInteraction.kind,
      ).toBe('approval')
      await page
        .getByLabel('All workspaces', { exact: true })
        .selectOption('beta')
      await expect(banner).toHaveCount(0)
      await page
        .getByLabel('All workspaces', { exact: true })
        .selectOption('alpha')
      await expect(banner).toBeVisible()
      for (const [kind, label] of [
        ['question', 'Waiting for answer'],
        ['plan-review', 'Waiting for plan review'],
        ['future-kind', 'Waiting for interaction'],
      ]) {
        await wait(kind)
        await expect(cards.filter({ hasText: issue.title })).toContainText(
          label,
        )
      }
      await wait(null)
      await expect(banner).toHaveCount(0)
      await expect(cards.filter({ hasText: issue.title })).toContainText(
        'Executing',
      )
      expect((await task(issue.id)).status).toBe('in-progress')
      await api('/control', { action: 'release', id: issue.id })
      await expect
        .poll(async () => (await task(issue.id)).status)
        .toBe('in-review')
      await expect
        .poll(async () => (await data()).snapshot.dispatch.enabled)
        .toBe(false)
      const phased = await create('Analysis and review approval waits')
      await closeDetail()
      await api('/control', {
        action: 'script',
        id: phased.id,
        script: { holdPhase: 'analysis' },
      })
      await page
        .getByRole('button', { name: 'Start queue', exact: true })
        .click()
      await expect
        .poll(async () => (await task(phased.id)).analysisSessionId)
        .toBeTruthy()
      const analyst = (await task(phased.id)).analysisSessionId
      await api('/control', {
        action: 'interaction',
        id: analyst,
        kind: 'approval',
      })
      await expect(cards.filter({ hasText: phased.title })).toContainText(
        'Waiting for approval',
      )
      await api('/control', {
        action: 'script',
        id: phased.id,
        script: { holdPhase: 'review' },
      })
      await api('/control', { action: 'interaction', id: analyst, kind: null })
      await api('/control', { action: 'release', id: phased.id })
      await expect
        .poll(async () => (await task(phased.id)).reviewSessionId)
        .toBeTruthy()
      const reviewer = (await task(phased.id)).reviewSessionId
      await api('/control', {
        action: 'interaction',
        id: reviewer,
        kind: 'approval',
      })
      await expect(cards.filter({ hasText: phased.title })).toContainText(
        'Waiting for approval',
      )
      expect((await task(phased.id)).status).toBe('in-review')
      expect((await task(phased.id)).completion).toBe(null)
      await api('/control', { action: 'interaction', id: reviewer, kind: null })
      await api('/control', { action: 'release', id: phased.id })
      await expect.poll(async () => (await task(phased.id)).status).toBe('done')
      results
        .at(-1)
        .assertions.push(
          'Native status facts remain independent; current analysis/execution/review approval waits take precedence; queue warning, scoped attention and links; questions/plan/unknown kinds; resolution never fabricates completion',
        )
    } else if (id === 'permission-settings') {
      const settings = page.getByRole('dialog', {
        name: 'DSH default permissions',
        exact: true,
      })
      const current = async () => (await api('/permissions')).value
      const confirm = page.getByRole('alertdialog', {
        name: 'Change the DSH permission default?',
        exact: true,
      })
      await expect(
        page.getByRole('region', {
          name: 'DSH default permissions',
          exact: true,
        }),
      ).toContainText('Workspace write')
      const applyButton = page.getByRole('button', {
          name: 'Apply to existing Sessions',
          exact: true,
        }),
        applyDialog = page.getByRole('dialog', {
          name: 'Apply the default permission to existing Sessions?',
          exact: true,
        }),
        applyFooter = applyDialog.locator('.pd-dialog-footer'),
        applyState = async () => (await data()).permissionApply,
        presetOf = async (id) =>
          (await data()).sessions.find((s) => s.id === id)?.projectionValues
            .permissions.currentValue,
        resetApplyTargets = async () => {
          for (const sessionId of [
            'session-alpha-builder',
            'session-alpha-reviewer',
            'session-alpha-analyst',
          ])
            await api('/control', {
              action: 'permissions',
              sessionId,
              sessionPreset: 'read-only',
            })
        }
      // Preview is read-only, lists every exclusion category, and cancel writes nothing.
      await applyButton.click()
      await expect(applyDialog).toBeVisible()
      await expect(
        applyDialog.getByRole('region', { name: 'Targets' }),
      ).toContainText('session-alpha-builder')
      await expect(
        applyDialog.getByRole('region', { name: 'Targets' }),
      ).toContainText('Application')
      await expect(
        applyDialog.getByRole('region', { name: 'Excluded' }),
      ).toContainText('Pending approval')
      await expect(
        applyDialog.getByRole('region', { name: 'Excluded' }),
      ).toContainText('Agent is running')
      await expect(
        applyDialog.getByRole('region', { name: 'Excluded' }),
      ).toContainText('Already at target')
      await expect(
        applyDialog.getByRole('region', { name: 'Unsupported' }),
      ).toContainText('Archived Session')
      await expect(
        applyDialog.getByRole('region', { name: 'Unsupported' }),
      ).toContainText('Cold Session (not live)')
      await expect(
        applyDialog.getByRole('region', { name: 'Unsupported' }),
      ).toContainText('Child Session')
      await expect(
        applyDialog.getByRole('region', { name: 'Unsupported' }),
      ).toContainText('Other/unregistered workspace')
      await expect(
        applyFooter.getByRole('button', {
          name: 'Confirm and apply',
          exact: true,
        }),
      ).toBeDisabled()
      expect(await applyState()).toMatchObject({ attempts: {} })
      await applyFooter
        .getByRole('button', { name: 'Cancel', exact: true })
        .click()
      await expect(applyDialog).toBeHidden()
      expect(await applyState()).toMatchObject({ attempts: {} })
      expect(await presetOf('session-alpha-builder')).toBe('read-only')
      // Explicit acknowledgement applies exactly the preview targets once.
      await applyButton.click()
      await applyDialog.getByRole('checkbox').check()
      await applyFooter
        .getByRole('button', { name: 'Confirm and apply', exact: true })
        .click()
      await expect(
        applyDialog.getByRole('region', { name: 'Apply result' }),
      ).toContainText('Applied: 3')
      expect((await applyState()).attempts).toMatchObject({
        'session-alpha-builder': 1,
        'session-alpha-reviewer': 1,
        'session-alpha-analyst': 1,
      })
      for (const sessionId of [
        'session-alpha-builder',
        'session-alpha-reviewer',
        'session-alpha-analyst',
      ])
        expect(await presetOf(sessionId)).toBe('workspace-write')
      for (const sessionId of [
        'session-alpha-runner',
        'session-alpha-pending',
        'session-alpha-child',
        'session-beta-archived',
        'session-foreign-live',
      ])
        expect(await presetOf(sessionId)).toBe('read-only')
      await applyDialog
        .getByRole('region', { name: 'Apply result' })
        .scrollIntoViewIfNeeded()
      await page.screenshot({ path: path.join(run, 'permission-apply.png') })
      await applyFooter
        .getByRole('button', { name: 'Done', exact: true })
        .click()
      // A changed Settings revision refuses the captured preview without retrying.
      await resetApplyTargets()
      await applyButton.click()
      await expect(applyDialog).toContainText('Eligible Sessions: 3')
      const staleAttempts = { ...(await applyState()).attempts }
      await api('/control', {
        action: 'permissions',
        preset: 'workspace-write',
      })
      await applyDialog.getByRole('checkbox').check()
      await applyFooter
        .getByRole('button', { name: 'Confirm and apply', exact: true })
        .click()
      await expect(applyDialog.getByRole('alert')).toContainText(
        'permission-stale',
      )
      await expect(applyDialog).toContainText(
        'Permissions changed after the preview',
      )
      expect((await applyState()).attempts).toEqual(staleAttempts)
      await applyFooter
        .getByRole('button', { name: 'Refresh preview', exact: true })
        .click()
      await expect(applyDialog).toContainText('Eligible Sessions: 3')
      await applyDialog.getByRole('checkbox').check()
      await applyFooter
        .getByRole('button', { name: 'Confirm and apply', exact: true })
        .click()
      await expect(
        applyDialog.getByRole('region', { name: 'Apply result' }),
      ).toContainText('Applied: 3')
      await applyFooter
        .getByRole('button', { name: 'Done', exact: true })
        .click()
      // Partial failure and read-back mismatch stay visible and are not retried.
      await resetApplyTargets()
      await api('/control', {
        action: 'permissions',
        failSessionId: 'session-alpha-builder',
        mismatchSessionId: 'session-alpha-reviewer',
      })
      const beforeFailure = { ...(await applyState()).attempts }
      await applyButton.click()
      await applyDialog.getByRole('checkbox').check()
      await applyFooter
        .getByRole('button', { name: 'Confirm and apply', exact: true })
        .click()
      const failureResult = applyDialog.getByRole('region', {
        name: 'Apply result',
      })
      await expect(failureResult).toContainText('Applied: 1')
      await expect(failureResult).toContainText('Failed: 2')
      await expect(failureResult).toContainText('Permission write failed')
      await expect(failureResult).toContainText('Read-back did not match')
      const afterFailure = { ...(await applyState()).attempts }
      for (const sessionId of [
        'session-alpha-builder',
        'session-alpha-reviewer',
        'session-alpha-analyst',
      ])
        expect(afterFailure[sessionId] ?? 0).toBe(
          (beforeFailure[sessionId] ?? 0) + 1,
        )
      await page.waitForTimeout(250)
      expect((await applyState()).attempts).toEqual(afterFailure)
      await failureResult.scrollIntoViewIfNeeded()
      await page.screenshot({
        path: path.join(run, 'permission-apply-failure.png'),
      })
      await applyFooter
        .getByRole('button', { name: 'Done', exact: true })
        .click()
      await api('/control', {
        action: 'permissions',
        failSessionId: null,
        mismatchSessionId: null,
      })
      await page
        .getByRole('button', { name: 'Permission settings', exact: true })
        .click()
      await expect(settings).toBeVisible()
      await page
        .getByRole('radio', { name: 'Full access', exact: true })
        .check()
      const sessionsBeforeDefaultSave = (await data()).sessions.map((s) => [
        s.id,
        s.projectionValues.permissions.currentValue,
      ])
      await page
        .getByRole('button', { name: 'Save default', exact: true })
        .click()
      await expect(confirm).toBeVisible()
      expect((await current()).currentValue).toBe('workspace-write')
      await expect(
        confirm.getByRole('button', {
          name: 'Confirm and save default',
          exact: true,
        }),
      ).toBeDisabled()
      await confirm
        .getByRole('button', { name: 'Cancel', exact: true })
        .last()
        .click()
      expect((await current()).currentValue).toBe('workspace-write')
      await page
        .getByRole('button', { name: 'Save default', exact: true })
        .click()
      await confirm.getByRole('checkbox').check()
      await confirm
        .getByRole('button', { name: 'Confirm and save default', exact: true })
        .click()
      await expect(settings).toContainText('saved and read back')
      expect((await current()).currentValue).toBe('danger-full-access')
      expect(
        (await data()).sessions.map((s) => [
          s.id,
          s.projectionValues.permissions.currentValue,
        ]),
      ).toEqual(sessionsBeforeDefaultSave)
      // v1 refuses to bulk-apply Full access; the preview stays visible.
      await page
        .getByRole('button', {
          name: 'Close permission settings',
          exact: true,
        })
        .click()
      await applyButton.click()
      await expect(applyDialog.getByRole('alert')).toContainText(
        'v1 cannot bulk-apply Full access',
      )
      await expect(
        applyFooter.getByRole('button', {
          name: 'Confirm and apply',
          exact: true,
        }),
      ).toBeDisabled()
      await applyFooter
        .getByRole('button', { name: 'Cancel', exact: true })
        .click()
      await page
        .getByRole('button', { name: 'Permission settings', exact: true })
        .click()
      await expect(settings).toBeVisible()
      await page
        .getByRole('radio', { name: 'Workspace write', exact: true })
        .check()
      await api('/control', {
        action: 'permissions',
        preset: 'workspace-write',
      })
      await page
        .getByRole('button', { name: 'Save default', exact: true })
        .click()
      await confirm.getByRole('checkbox').check()
      await confirm
        .getByRole('button', { name: 'Confirm and save default', exact: true })
        .click()
      await expect(settings.getByRole('alert')).toContainText(
        'changed; refresh and retry',
      )
      await page
        .getByRole('button', { name: 'Refresh permissions', exact: true })
        .click()
      await expect(
        page.getByRole('radio', { name: 'Workspace write', exact: true }),
      ).toBeChecked()
      await api('/control', { action: 'permissions', writable: false })
      await page
        .getByRole('button', { name: 'Refresh permissions', exact: true })
        .click()
      await expect(settings).toContainText('provider is read-only')
      await expect(
        page.getByRole('radio', { name: 'Full access', exact: true }),
      ).toBeDisabled()
      await api('/control', { action: 'permissions', available: false })
      await page
        .getByRole('button', { name: 'Refresh permissions', exact: true })
        .click()
      await expect(settings.getByRole('alert')).toContainText('unavailable')
      await api('/control', {
        action: 'permissions',
        available: true,
        writable: true,
      })
      await page
        .getByRole('button', { name: 'Refresh permissions', exact: true })
        .click()
      await expect(
        page.getByRole('radio', { name: 'Workspace write', exact: true }),
      ).toBeEnabled()
      await page.screenshot({ path: path.join(run, 'permission-settings.png') })
      await page
        .getByRole('button', { name: 'Close permission settings', exact: true })
        .click()
      await api('/control', { action: 'restart' })
      await page.reload()
      expect((await current()).currentValue).toBe('workspace-write')
      expect((await data()).snapshot.tasks).toHaveLength(0)
      results
        .at(-1)
        .assertions.push(
          'No permission write on read/cancel; explicit scope confirmation and acknowledgement; revision conflict refuses stale edits; existing Sessions unchanged after saving the default; default apply is a separate confirmed action with target count/scope; running, pending approval/question/plan-review and already-target Sessions excluded; archived/cold/child/other-workspace unsupported with reasons; applied effective permission read back; partial failure and read-back mismatch visible without retry; Full access bulk apply refused; provider read-only/unavailable recovery; default persists through restart',
        )
    } else if (id === 'ui-journeys') {
      await expect(cards).toHaveCount(7)
      const noPageOverflow = async () =>
        expect(
          await page.evaluate(
            () =>
              document.documentElement.scrollWidth <=
              document.documentElement.clientWidth + 1,
          ),
        ).toBe(true)
      await noPageOverflow()
      const originalWidth = await page
        .locator('.pd-columns')
        .evaluate((el) => el.getBoundingClientRect().width)
      const runningTask = await task('fixture-in-progress')
      const claimedSession = (await data()).sessions.find(
        (s) => s.id === runningTask.sessionId,
      )
      await expect(cards.filter({ hasText: runningTask.title })).toContainText(
        claimedSession.displayTitle,
      )
      const card = cards.filter({ hasText: 'Implement accepted scope' })
      await card.click()
      const dialog = page.getByRole('dialog', {
        name: 'Implement accepted scope',
        exact: true,
      })
      await expect(dialog).toBeVisible()
      expect(
        await page
          .locator('.pd-columns')
          .evaluate((el) => el.getBoundingClientRect().width),
      ).toBe(originalWidth)
      for (let n = 0; n < 18; n++) await page.keyboard.press('Tab')
      expect(
        await page.evaluate(() => !!document.activeElement.closest('dialog')),
      ).toBe(true)
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      await expect(card).toBeFocused()
      await card.click()
      await page.mouse.click(5, 450)
      await expect(dialog).toHaveCount(0)
      await expect(card).toBeFocused()
      await card.click()
      await page
        .getByRole('tab', { name: 'Properties & rules', exact: true })
        .click()
      await page.getByText('Edit task', { exact: true }).click()
      await page
        .getByLabel('Title', { exact: true })
        .fill('Unsaved local draft')
      await page.keyboard.press('Escape')
      await expect(
        page.getByRole('alertdialog', {
          name: 'Discard this draft?',
          exact: true,
        }),
      ).toBeVisible()
      await page
        .getByRole('button', { name: 'Keep editing', exact: true })
        .first()
        .click()
      await expect(page.getByLabel('Title', { exact: true })).toHaveValue(
        'Unsaved local draft',
      )
      await page
        .getByRole('button', { name: 'Open DSH session', exact: true })
        .click()
      await expect(page.getByRole('alertdialog')).toBeVisible()
      await page
        .getByRole('button', { name: 'Keep editing', exact: true })
        .first()
        .click()
      await expect(page.getByLabel('Title', { exact: true })).toHaveValue(
        'Unsaved local draft',
      )
      const previous = await task('fixture-todo')
      await api('/command/update', {
        requestId: crypto.randomUUID(),
        id: previous.id,
        expectedVersion: previous.version,
        action: 'edit',
        title: 'Changed remotely',
      })
      await expect(
        page.getByRole('button', {
          name: 'Reload latest version',
          exact: true,
        }),
      ).toBeVisible()
      await expect(page.getByLabel('Title', { exact: true })).toHaveValue(
        'Unsaved local draft',
      )
      await page
        .getByRole('button', { name: 'Reload latest version', exact: true })
        .click()
      await expect(page.getByLabel('Title', { exact: true })).toHaveValue(
        'Changed remotely',
      )
      await closeDetail()
      await page.getByRole('button', { name: 'New task', exact: true }).click()
      await page
        .getByLabel('Title', { exact: true })
        .fill('Protected creation draft')
      await page.keyboard.press('Escape')
      await expect(page.getByRole('alertdialog')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByLabel('Title', { exact: true })).toHaveValue(
        'Protected creation draft',
      )
      await page
        .getByRole('button', { name: 'Cancel', exact: true })
        .last()
        .click()
      await page
        .getByRole('button', { name: 'Discard draft', exact: true })
        .click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(
        page.getByRole('button', { name: 'New task', exact: true }),
      ).toBeFocused()
      expect(
        (await data()).snapshot.tasks.some(
          (t) => t.title === 'Protected creation draft',
        ),
      ).toBe(false)
      await page.getByRole('button', { name: 'Task list', exact: true }).click()
      await expect(page.locator('tbody tr')).toHaveCount(7)
      await page
        .getByRole('button', { name: 'Changed remotely', exact: true })
        .click()
      await expect(
        page.getByRole('dialog', { name: 'Changed remotely', exact: true }),
      ).toBeVisible()
      await page
        .getByRole('tab', { name: 'Activity ledger', exact: true })
        .click()
      await expect(page.locator('.pd-audit').first()).toContainText('edit')
      await closeDetail()
      await page
        .getByRole('button', { name: 'Task board', exact: true })
        .click()
      await page
        .getByLabel('All workspaces', { exact: true })
        .selectOption('alpha')
      await page.getByRole('button', { name: 'New task', exact: true }).click()
      const chipForm = page.locator('form.pd-create')
      await chipForm
        .getByLabel('Title', { exact: true })
        .fill('Chip selection controls')
      await chipForm
        .getByLabel('Description', { exact: true })
        .fill('Every chip group selection must reach the durable task payload')
      await chipForm
        .getByLabel('Acceptance criteria (optional)', { exact: true })
        .fill('Chip selections persist')
      await chipForm
        .getByLabel('Analyze issue before execution', { exact: true })
        .uncheck()
      const workspaceChips = chipForm.getByRole('radiogroup', {
        name: 'All workspaces',
        exact: true,
      })
      const assigneeChips = chipForm.getByRole('radiogroup', {
        name: 'Assigned session',
        exact: true,
      })
      await expect(
        workspaceChips.getByRole('radio', {
          name: 'Application',
          exact: true,
        }),
      ).toBeChecked()
      await expect(
        assigneeChips.getByRole('radio', {
          name: 'Workspace queue',
          exact: true,
        }),
      ).toBeChecked()
      await workspaceChips
        .getByRole('radio', { name: 'Operations', exact: true })
        .check()
      await expect(
        assigneeChips.getByRole('radio', {
          name: 'session-alpha-reviewer',
          exact: true,
        }),
      ).toHaveCount(0)
      await workspaceChips
        .getByRole('radio', { name: 'Application', exact: true })
        .check()
      await assigneeChips
        .getByRole('radio', { name: 'session-alpha-reviewer', exact: true })
        .check()
      await chipForm
        .getByRole('radiogroup', { name: 'Priority', exact: true })
        .getByRole('radio', { name: 'High', exact: true })
        .check()
      await chipForm
        .getByRole('radiogroup', { name: 'Completion policy', exact: true })
        .getByRole('radio', {
          name: 'Automatic after machine checks',
          exact: true,
        })
        .check()
      await chipForm
        .getByText('Advanced completion rules', { exact: true })
        .click()
      await chipForm
        .getByRole('button', { name: 'Add machine check', exact: true })
        .click()
      await chipForm
        .getByRole('radiogroup', { name: 'Check kind', exact: true })
        .getByRole('radio', { name: 'SHA256', exact: true })
        .check()
      await chipForm
        .getByLabel('Workspace file path', { exact: true })
        .fill('chip.txt')
      await chipForm
        .getByLabel('Expected content or hash', { exact: true })
        .fill('chip-result')
      await noPageOverflow()
      await chipForm
        .getByRole('radiogroup', { name: 'All workspaces', exact: true })
        .scrollIntoViewIfNeeded()
      await page.screenshot({
        path: path.join(run, 'ui-create-chips-light.png'),
      })
      await chipForm
        .getByRole('radiogroup', { name: 'Check kind', exact: true })
        .scrollIntoViewIfNeeded()
      await page.screenshot({
        path: path.join(run, 'ui-create-chips-policy-light.png'),
      })
      await chipForm
        .getByRole('button', { name: 'Create task', exact: true })
        .click()
      await expect(
        page.locator('.pd-card').filter({ hasText: 'Chip selection controls' }),
      ).toBeVisible()
      const chipTask = (await data()).snapshot.tasks.find(
        (t) => t.title === 'Chip selection controls',
      )
      expect(chipTask.workspaceId).toBe('alpha')
      expect(chipTask.priority).toBe(2)
      expect(chipTask.assignee).toBe('session-alpha-reviewer')
      expect(chipTask.completionPolicy.mode).toBe('verified')
      expect(chipTask.completionPolicy.checks).toEqual([
        {
          criterion: 0,
          path: 'chip.txt',
          kind: 'sha256',
          expected: 'chip-result',
        },
      ])
      results
        .at(-1)
        .assertions.push(
          'Chip radio groups select workspace, priority, assignee, completion policy and check kind into the durable task',
        )
      await closeDetail()
      await page.getByLabel('Issue budget', { exact: true }).fill('')
      await expect(
        page.getByRole('button', { name: 'Start queue', exact: true }),
      ).toBeDisabled()
      await page.getByLabel('Issue budget', { exact: true }).fill('2')
      await page.screenshot({ path: path.join(run, 'ui-desktop-light.png') })
      await page.getByLabel('Theme', { exact: true }).selectOption('dark')
      await expect(cards.first()).toHaveCSS(
        'background-color',
        'rgb(18, 21, 26)',
      )
      await expect(cards.first()).toHaveCSS('color', 'rgb(233, 236, 240)')
      await page.screenshot({ path: path.join(run, 'ui-desktop-dark.png') })
      await page.getByRole('button', { name: 'New task', exact: true }).click()
      await page.screenshot({
        path: path.join(run, 'ui-create-chips-dark.png'),
      })
      await page
        .locator('form.pd-create')
        .getByRole('radiogroup', { name: 'Completion policy', exact: true })
        .scrollIntoViewIfNeeded()
      await page.screenshot({
        path: path.join(run, 'ui-create-chips-policy-dark.png'),
      })
      await page
        .locator('form.pd-create')
        .getByRole('button', { name: 'Cancel', exact: true })
        .click()
      await expect(page.locator('form.pd-create')).toHaveCount(0)
      await cards.filter({ hasText: 'Changed remotely' }).click()
      await page
        .getByRole('tab', { name: 'Analysis & review', exact: true })
        .click()
      await page.keyboard.press('ArrowRight')
      await expect(
        page.getByRole('tab', { name: 'Properties & rules', exact: true }),
      ).toHaveAttribute('aria-selected', 'true')
      await page.setViewportSize({ width: 430, height: 850 })
      await expect(
        page.getByRole('button', { name: 'Close details', exact: true }),
      ).toBeInViewport()
      const box = await page.locator('.pd-detail').boundingBox()
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(431)
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.y + box.height).toBeLessThanOrEqual(851)
      await noPageOverflow()
      await page.screenshot({ path: path.join(run, 'ui-narrow-dialog.png') })
      await closeDetail()
      await page.getByLabel('Theme', { exact: true }).selectOption('light')
      await page.getByRole('button', { name: 'New task', exact: true }).click()
      await noPageOverflow()
      await page.screenshot({
        path: path.join(run, 'ui-create-chips-narrow.png'),
      })
      await page
        .locator('form.pd-create')
        .getByRole('radiogroup', { name: 'Assigned session', exact: true })
        .scrollIntoViewIfNeeded()
      await page.screenshot({
        path: path.join(run, 'ui-create-chips-assignee-narrow.png'),
      })
      await page
        .locator('form.pd-create')
        .getByRole('button', { name: 'Cancel', exact: true })
        .click()
      await expect(page.locator('form.pd-create')).toHaveCount(0)
      await page.setViewportSize({ width: 1500, height: 1000 })
      await page.getByLabel('Theme', { exact: true }).selectOption('light')
      await api('/command/dispatch', {
        workspaceId: 'beta',
        enabled: true,
        watch: true,
        maxTasks: 7,
      })
      await expect(
        page.getByRole('button', { name: 'Start queue', exact: true }),
      ).toBeDisabled()
      expect((await data()).snapshot.dispatch.workspaceId).toBe('beta')
      await page
        .getByLabel('All workspaces', { exact: true })
        .selectOption('beta')
      await expect(
        page.getByLabel('Issue budget', { exact: true }),
      ).toHaveValue('7')
      await page.reload()
      await page
        .getByLabel('All workspaces', { exact: true })
        .selectOption('beta')
      await expect(
        page.getByLabel('Issue budget', { exact: true }),
      ).toHaveValue('7')
      await page
        .getByRole('button', { name: 'Pause subsequent issues', exact: true })
        .click()
      results
        .at(-1)
        .assertions.push(
          'Native modal keeps board width; Escape/backdrop restore focus; nested draft protection covers close and Session navigation; stale edits retained; list/activity navigation; queue ownership and budget survive reload; both themes and narrow geometry',
        )
    } else if (id === 'workflow-recovery') {
      const bad = await create('Missing phase report')
      await api('/control', {
        action: 'script',
        id: bad.id,
        script: { missingAnalysis: true },
      })
      const good = await create('Reasoning-only recovery')
      await api('/control', {
        action: 'script',
        id: good.id,
        script: { missingAnalysisOnce: true },
      })
      await outside('Start queue')
      await expect.poll(async () => (await task(bad.id)).status).toBe('blocked')
      await expect.poll(async () => (await task(good.id)).status).toBe('done')
      expect((await data()).snapshot.dispatch.error).toBeNull()
      await expect(page.locator('.pd-next-steps,.pd-next-grid')).toHaveCount(0)
      await expect(
        page.locator('.pd-card').filter({ hasText: 'Missing phase report' }),
      ).toContainText('Blocked')
      await openTask(bad.id)
      await expect(page.locator('.pd-next-detail')).toContainText(
        'Other tasks may continue',
      )
      await page
        .getByRole('button', { name: 'Recover task', exact: true })
        .click()
      await expect.poll(async () => (await task(bad.id)).status).toBe('triage')
      await api('/control', { action: 'script', id: bad.id, script: {} })
      await queue(bad.id, 'done')
      const staged = await create('Staged evidence with screenshot')
      await api('/control', {
        action: 'script',
        id: staged.id,
        script: {
          route: 'staged',
          risk: 'medium',
          images: [
            {
              path: 'proof.png',
              caption: 'Verified visible result',
              criterion: 0,
            },
          ],
        },
      })
      await queue(staged.id, 'in-review')
      expect((await task(staged.id)).review.verdict).toBe('pass')
      expect((await task(staged.id)).completion).toBeNull()
      await expect(page.locator('.pd-next-detail')).toContainText(
        'medium or high',
      )
      await expect(page.locator('.pd-criterion-result')).toContainText(
        'Independent verification',
      )
      const img = page.locator('.pd-image-evidence img')
      await expect(img).toBeVisible()
      await expect.poll(() => img.evaluate((el) => el.naturalWidth)).toBe(1)
      await page
        .getByRole('button', {
          name: 'Preview evidence image: Verified visible result',
          exact: true,
        })
        .click()
      await expect(page.locator('.pd-image-preview')).toBeVisible()
      await page
        .getByRole('button', { name: 'Close image', exact: true })
        .click()
      const reviewer = (await task(staged.id)).reviewSessionId
      await page
        .getByRole('button', {
          name: 'Retry automatic verification',
          exact: true,
        })
        .click()
      await expect
        .poll(async () => (await task(staged.id)).automationNote)
        .toBe('human-acceptance-required')
      expect((await task(staged.id)).reviewSessionId).toBe(reviewer)
      await page.getByLabel('Language', { exact: true }).selectOption('zh')
      await expect(page.locator('.pd-next-detail')).toContainText(
        '独立核验已收集证据',
      )
      await expect(page.locator('.pd-next-detail')).not.toContainText(
        'Independent evidence is available',
      )
      await page.getByLabel('Language', { exact: true }).selectOption('en')
      await expect(
        page.getByRole('button', { name: 'Close details', exact: true }),
      ).toBeVisible()
      results
        .at(-1)
        .assertions.push(
          'Human acceptance machine note renders as Chinese in task detail without changing the stored token',
        )
      await page.screenshot({
        path: path.join(run, 'workflow-staged-evidence.png'),
        fullPage: true,
      })
      await closeDetail()
      const clarify = await create('Clarification and criteria editing')
      await api('/control', {
        action: 'script',
        id: clarify.id,
        script: { route: 'needs-info' },
      })
      await queue(clarify.id, 'needs-info')
      await page
        .getByRole('tab', { name: 'Properties & rules', exact: true })
        .click()
      await page.getByText('Edit task', { exact: true }).click()
      await page
        .getByLabel('Criterion 1', { exact: true })
        .fill('Owner clarified observable output')
      await page
        .locator('.pd-detail details')
        .filter({ has: page.getByLabel('Criterion 1', { exact: true }) })
        .getByRole('button', { name: 'Save', exact: true })
        .click()
      await expect
        .poll(async () => (await task(clarify.id)).status)
        .toBe('triage')
      expect((await task(clarify.id)).criteria).toEqual([
        'Owner clarified observable output',
      ])
      results
        .at(-1)
        .assertions.push(
          'Missing reports are bounded and isolated; owner recovery resumes; staged review collects image evidence without auto-acceptance; preview and criterion editing work',
        )
    } else if (id === 'input-images') {
      await closeDetail()
      await page
        .getByRole('combobox', { name: 'All workspaces', exact: true })
        .selectOption('alpha')
      await page.getByRole('button', { name: 'New task', exact: true }).click()
      const form = page.locator('form.pd-create'),
        description = form.getByLabel('Description', { exact: true }),
        criteria = form.getByLabel('Acceptance criteria (optional)', {
          exact: true,
        }),
        descriptionImages = form.locator(
          '.pd-input-images[data-source=description]',
        ),
        criteriaImages = form.locator('.pd-input-images[data-source=criteria]')
      await form
        .getByLabel('Title', { exact: true })
        .fill('Image input lab task')
      await description.fill('Lab image input across all phases')
      await criteria.fill('Every phase receives the ordered lab fixture')
      await pasteLabImage(description, 'fixture-description.png', 'image/png')
      await pasteLabImage(criteria, 'fixture-criteria.jpg', 'image/jpeg')
      await expect(descriptionImages.locator('.pd-input-image')).toHaveCount(1)
      await expect(criteriaImages.locator('.pd-input-image')).toHaveCount(1)
      await expect(descriptionImages).toContainText('Task description')
      await expect(descriptionImages).toContainText('87 B')
      await expect(criteriaImages).toContainText('Acceptance criteria')
      await expect(criteriaImages).toContainText('650 B')
      await expect(form.locator('.pd-input-image img')).toHaveCount(2)
      await form.screenshot({
        path: path.join(run, 'input-images-form.png'),
      })
      await form
        .getByRole('button', { name: 'Create task', exact: true })
        .click()
      await expect
        .poll(async () =>
          (await data()).snapshot.tasks.some(
            (t) => t.title === 'Image input lab task',
          ),
        )
        .toBe(true)
      const created = (await data()).snapshot.tasks.find(
        (t) => t.title === 'Image input lab task',
      )
      expect(created.inputImages).toHaveLength(2)
      expect(created.inputImages.map((i) => i.source)).toEqual([
        'description',
        'criteria',
      ])
      const gallery = page.locator('.pd-input-image-gallery')
      await expect(gallery.locator('.pd-input-image')).toHaveCount(2)
      await expect
        .poll(() =>
          gallery
            .locator('img')
            .evaluateAll((images) => images.map((img) => img.naturalWidth)),
        )
        .toEqual([12, 12])
      await page
        .getByRole('tab', { name: 'Properties & rules', exact: true })
        .click()
      await page.getByText('Edit task', { exact: true }).click()
      const editor = page.locator('.pd-detail details').filter({
        hasText: 'Edit task',
      })
      const editorDescription = editor.locator(
        '.pd-input-images[data-source=description]',
      )
      await expect(editorDescription.locator('.pd-input-image')).toHaveCount(1)
      await pasteLabImage(
        editor.locator('.pd-field textarea').first(),
        'fixture-extra.webp',
        'image/webp',
      )
      await expect(editorDescription.locator('.pd-input-image')).toHaveCount(2)
      await editor
        .locator('.pd-input-images[data-source=criteria]')
        .getByRole('button', {
          name: 'Remove image: fixture-criteria.jpg',
          exact: true,
        })
        .click()
      await editor.getByRole('button', { name: 'Save', exact: true }).click()
      await expect
        .poll(async () => (await task(created.id)).inputImages.length)
        .toBe(2)
      expect((await task(created.id)).inputImages.map((i) => i.name)).toEqual([
        'fixture-description.png',
        'fixture-extra.webp',
      ])
      await page.reload()
      await openTask(created.id)
      await expect(
        page.locator('.pd-input-image-gallery .pd-input-image'),
      ).toHaveCount(2)
      await closeDetail()
      await page
        .getByRole('combobox', { name: 'All workspaces', exact: true })
        .selectOption('alpha')
      await queue(created.id, 'done')
      expect((await task(created.id)).completion.kind).toBe('reviewed')
      results
        .at(-1)
        .assertions.push(
          'Create and edit accept pasted PNG/JPEG/WebP with source labels and byte sizes; saved previews survive reload; image task completes analysis, execution and review',
        )
    } else if (id === 'multi-lane-dependencies') {
      const dependency = await create('Dependency task', {
        mode: 'manual',
        intake: false,
      })
      const successor = await create('Dependent task', {
        mode: 'manual',
        intake: false,
        dependencies: ['Dependency task'],
      })
      await closeDetail()
      const successorCard = page
        .locator('.pd-card')
        .filter({ hasText: 'Dependent task' })
      await expect(
        successorCard.getByText('Waiting on dependencies', { exact: false }),
      ).toBeVisible()
      await successorCard.click()
      const dependencySection = page
        .locator('.pd-section')
        .filter({ hasText: 'Dependencies' })
      await expect(dependencySection).toContainText('Dependency task')
      await expect(dependencySection).toContainText('To do')
      await expect(dependencySection).toContainText('Not started')
      await page.screenshot({
        path: path.join(run, 'lane-dependency-waiting.png'),
      })
      await closeDetail()
      await script(dependency.id, { holdPhase: 'execution' })
      await script(successor.id, { holdPhase: 'execution' })
      await setLanes(2)
      await startWatch()
      await waitForSnapshot(
        (snapshot) =>
          snapshot.dispatch.active.some((slot) => slot.taskId === dependency.id),
        'dependency lane starts',
      )
      expect(
        (await data()).snapshot.dispatch.active.some(
          (slot) => slot.taskId === successor.id,
        ),
      ).toBe(false)
      expect((await task(successor.id)).status).toBe('todo')
      await release(dependency.id)
      await acceptThroughApi(dependency.id)
      await waitForSnapshot(
        (snapshot) =>
          snapshot.dispatch.active.some((slot) => slot.taskId === successor.id),
        'successor starts after the dependency is done',
      )
      expect((await task(dependency.id)).status).toBe('done')
      expect((await task(successor.id)).status).toBe('in-progress')
      await release(successor.id)
      await waitForSnapshot(
        (snapshot) =>
          snapshot.tasks.find((t) => t.id === successor.id)?.status ===
          'in-review',
        'successor reports without auto-acceptance',
      )
      expect((await task(successor.id)).completion).toBe(null)
      results
        .at(-1)
        .assertions.push(
          'owner-selected dependency is visible on card and detail, gates claim, and unlocks the successor only after the dependency is done',
        )
    } else if (id === 'resource-conflict') {
      const holder = await create('Resource holder', {
        mode: 'manual',
        intake: false,
        resourceKeys: ['port:3100'],
      })
      const waiter = await create('Resource waiter', {
        mode: 'manual',
        intake: false,
        resourceKeys: ['port:3100'],
      })
      await closeDetail()
      const waiterCard = page
        .locator('.pd-card')
        .filter({ hasText: 'Resource waiter' })
      await waiterCard.click()
      const resourceSection = page
        .locator('.pd-section')
        .filter({ hasText: 'Resource keys' })
      await expect(resourceSection).toContainText('port:3100')
      await expect(resourceSection).toContainText('Free')
      await closeDetail()
      await script(holder.id, { holdPhase: 'execution' })
      await script(waiter.id, { holdPhase: 'execution' })
      await setLanes(2)
      await startWatch()
      await waitForSnapshot(
        (snapshot) =>
          snapshot.dispatch.active.some((slot) => slot.taskId === holder.id),
        'resource holder starts',
      )
      expect(
        (await data()).snapshot.dispatch.active.some(
          (slot) => slot.taskId === waiter.id,
        ),
      ).toBe(false)
      await expect(
        waiterCard.getByText('In use', { exact: false }),
      ).toBeVisible()
      await waiterCard.click()
      await expect(resourceSection).toContainText('Resource holder')
      await expect(resourceSection).toContainText('Held by')
      await page.screenshot({
        path: path.join(run, 'lane-resource-holder.png'),
      })
      await closeDetail()
      await release(holder.id)
      await waitForSnapshot(
        (snapshot) =>
          snapshot.dispatch.active.some((slot) => slot.taskId === waiter.id),
        'waiter starts only after the holder leaves in-progress',
      )
      expect((await task(waiter.id)).status).toBe('in-progress')
      await release(waiter.id)
      await waitForSnapshot(
        (snapshot) =>
          snapshot.tasks.find((t) => t.id === waiter.id)?.status === 'in-review',
        'waiter reports',
      )
      results
        .at(-1)
        .assertions.push(
          'tasks sharing a resource key never overlap; the current holder is visible on the card and detail and is released when it leaves in-progress',
        )
    } else if (id === 'lane-cap') {
      const first = await create('Lane one', { mode: 'manual', intake: false })
      const second = await create('Lane two', { mode: 'manual', intake: false })
      const third = await create('Lane three', { mode: 'manual', intake: false })
      for (const task of [first, second, third])
        await script(task.id, { holdPhase: 'execution' })
      await setLanes(2)
      await startWatch()
      await waitForSnapshot(
        (snapshot) =>
          snapshot.dispatch.active.filter((slot) => slot.phase === 'execution')
            .length === 2,
        'two lanes active',
      )
      const active = (await data()).snapshot.dispatch.active.map(
        (slot) => slot.taskId,
      )
      expect(active).not.toContain(third.id)
      await page.screenshot({ path: path.join(run, 'lane-cap-active.png') })
      expect((await task(third.id)).status).toBe('todo')
      await release(active[0])
      await waitForSnapshot(
        (snapshot) =>
          snapshot.dispatch.active.some((slot) => slot.taskId === third.id),
        'third task reuses a freed lane',
      )
      expect(
        (await data()).snapshot.dispatch.active.filter(
          (slot) => slot.phase === 'execution',
        ).length,
      ).toBe(2)
      for (const id of (await data()).snapshot.dispatch.active.map(
        (slot) => slot.taskId,
      ))
        await release(id)
      await waitForSnapshot(
        (snapshot) =>
          [first.id, second.id, third.id].every(
            (id) =>
              snapshot.tasks.find((task) => task.id === id)?.status ===
              'in-review',
          ),
        'all three lanes report',
      )
      results
        .at(-1)
        .assertions.push(
          'persisted lanes=2 bound concurrent execution, the third task waits, and freed lanes are reused',
        )
    } else if (id === 'lane-failure-isolation') {
      const failing = await create('Failing lane', {
        mode: 'manual',
        intake: false,
      })
      const healthy = await create('Healthy lane', {
        mode: 'manual',
        intake: false,
      })
      await script(failing.id, { promptFailure: true })
      await script(healthy.id, { holdPhase: 'execution' })
      await setLanes(2)
      await startWatch()
      await waitForSnapshot(
        (snapshot) =>
          snapshot.tasks.find((task) => task.id === failing.id)?.status ===
          'blocked',
        'failing lane blocks only itself',
      )
      expect((await task(healthy.id)).status).toBe('in-progress')
      expect((await data()).snapshot.dispatch.error).toContain(
        'Scripted prompt failure',
      )
      await page.screenshot({
        path: path.join(run, 'lane-failure-paused.png'),
      })
      await expect(
        page.getByText('Queue paused', { exact: false }).first(),
      ).toBeVisible()
      await release(healthy.id)
      await waitForSnapshot(
        (snapshot) =>
          snapshot.tasks.find((task) => task.id === healthy.id)?.status ===
          'in-review',
        'healthy lane still reports',
      )
      expect((await task(failing.id)).evidence).toContain(
        'Scripted prompt failure',
      )
      results
        .at(-1)
        .assertions.push(
          'one lane failure blocks only that task and pauses new starts while another in-flight lane still reports evidence',
        )
    } else if (id === 'restart-stale-claim') {
      const stale = await create('Stale claim', {
        mode: 'manual',
        intake: false,
        resourceKeys: ['branch:main'],
      })
      const waiting = await create('Waiting on stale key', {
        mode: 'manual',
        intake: false,
        resourceKeys: ['branch:main'],
      })
      await api('/control', { action: 'claim', id: stale.id })
      await setLanes(3)
      await api('/control', { action: 'restart' })
      await page.reload()
      await waitForSnapshot(
        (snapshot) =>
          snapshot.tasks.find((task) => task.id === stale.id)?.status ===
          'in-progress',
        'stale claim survives restart',
      )
      const restarted = (await data()).snapshot
      expect(restarted.settings.workspaces.alpha.lanes).toBe(3)
      expect(restarted.dispatch.enabled).toBe(false)
      expect(restarted.dispatch.active).toEqual([])
      expect(restarted.tasks.find((task) => task.id === stale.id).version).toBe(2)
      expect(restarted.tasks.find((task) => task.id === waiting.id).status).toBe(
        'todo',
      )
      await page.screenshot({
        path: path.join(run, 'restart-stale-claim-state.png'),
      })
      await script(stale.id, { holdPhase: 'execution' })
      await startWatch()
      await page.waitForTimeout(400)
      expect((await task(stale.id)).status).toBe('in-progress')
      expect((await task(waiting.id)).status).toBe('todo')
      expect((await data()).snapshot.dispatch.active).toEqual([])
      const current = await task(stale.id)
      await api('/command/update', {
        requestId: crypto.randomUUID(),
        id: stale.id,
        expectedVersion: current.version,
        action: 'retry',
      })
      await waitForSnapshot(
        (snapshot) =>
          snapshot.tasks.find((task) => task.id === stale.id)?.status ===
          'in-progress',
        'owner retry reclaims the released key',
      )
      expect((await task(waiting.id)).status).toBe('todo')
      await release(stale.id)
      await waitForSnapshot(
        (snapshot) =>
          snapshot.tasks.find((task) => task.id === stale.id)?.status ===
          'in-review',
        'recovered task reports',
      )
      results
        .at(-1)
        .assertions.push(
          'persisted lanes survive restart, stale in-progress work keeps its key without replay, and the existing retry command releases it',
        )
    } else if (id === 'recovery') {
      const completed = await create('Sessions survive recovery')
      await queue(completed.id, 'done')
      const phaseIds = [
        (await task(completed.id)).analysisSessionId,
        (await task(completed.id)).sessionId,
        (await task(completed.id)).reviewSessionId,
      ]
      const t = await create('Durable recovery', {
        mode: 'manual',
        intake: false,
      })
      await api('/control', { action: 'claim', id: t.id })
      await api('/command/dispatch', {
        workspaceId: 'alpha',
        enabled: true,
        watch: true,
        maxTasks: 1,
      })
      await api('/control', { action: 'restart' })
      await page.reload()
      await expect
        .poll(async () => (await task(t.id)).status)
        .toBe('in-progress')
      expect((await data()).snapshot.dispatch.enabled).toBe(false)
      expect((await task(t.id)).version).toBe(2)
      await openTask(t.id)
      await expect(page.locator('.pd-next-detail')).toContainText(
        'Agent is idle',
      )
      await page
        .getByRole('button', { name: 'Recover task', exact: true })
        .click()
      await expect.poll(async () => (await task(t.id)).status).toBe('todo')
      expect((await task(t.id)).sessionId).toBeNull()
      const ids = new Set((await data()).sessions.map((s) => s.id))
      expect(phaseIds.every((id) => ids.has(id))).toBe(true)
      results
        .at(-1)
        .assertions.push(
          'Restart loads exact persisted claim, disarms watcher and never reruns in-progress work',
        )
    }
    await page.screenshot({
      path: path.join(run, id + '.png'),
      fullPage: true,
    })
    results.at(-1).passed = true
    console.log('PASS ' + id)
  }
  expect(errors).toEqual([])
  expect(results.length).toBe(selected === 'all' ? fixture.scenarios.length : 1)
  await writeFile(
    path.join(run, 'coverage.json'),
    JSON.stringify(
      {
        contract: fixture.contract,
        referenceHermexCommit: fixture.referenceHermexCommit,
        synthetic: true,
        results,
        browserErrors: errors,
      },
      null,
      2,
    ),
  )
} catch (e) {
  if (results.length) results.at(-1).error = String(e)
  await page.screenshot({
    path: path.join(run, 'failure.png'),
    fullPage: true,
  })
  await writeFile(
    path.join(run, 'failure.txt'),
    await page.locator('body').innerText(),
  )
  await writeFile(
    path.join(run, 'coverage.json'),
    JSON.stringify({ results, browserErrors: errors }, null, 2),
  )
  throw e
} finally {
  await browser.close()
}
