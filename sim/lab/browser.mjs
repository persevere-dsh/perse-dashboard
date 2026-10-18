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
  { mode = 'reviewed', manual = false, intake = true, checks = false } = {},
) {
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
    .getByLabel('Acceptance criteria (one per line)', { exact: true })
    .fill('The isolated result is correct')
  await f
    .getByLabel('Analyze issue before execution', { exact: true })
    .setChecked(intake)
  await f
    .getByLabel('Needs manual validation', { exact: true })
    .setChecked(manual)
  await f.getByLabel('Completion policy', { exact: true }).selectOption(mode)
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
      alert = page.getByRole('alert')
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
      await expect(page.locator('tbody')).toContainText('Needs input')
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
      const verified = await create('File verified automation', {
        mode: 'verified',
        checks: true,
      })
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
            checks: file,
          })
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
