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
    .getByLabel('Acceptance criteria (one per line)', { exact: true })
    .fill('The isolated result is correct')
  await f
    .getByLabel('Analyze issue before execution', { exact: true })
    .setChecked(intake)
  await f
    .getByLabel('Needs manual validation', { exact: true })
    .setChecked(manual)
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
      await page
        .getByRole('button', { name: 'Permission settings', exact: true })
        .click()
      await expect(settings).toBeVisible()
      await page
        .getByRole('radio', { name: 'Full access', exact: true })
        .check()
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
      await confirm.getByRole('button', { name: 'Cancel', exact: true }).last().click()
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
        (await data()).sessions.every(
          (s) =>
            s.projectionValues.permissions.currentValue === 'workspace-write',
        ),
      ).toBe(true)
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
          'No permission write on read/cancel; explicit scope confirmation and acknowledgement; revision conflict refuses stale edits; existing Sessions unchanged; provider read-only/unavailable recovery; default persists through restart',
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
        .getByLabel('Acceptance criteria (one per line)', { exact: true })
        .fill('Chip selections persist')
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
