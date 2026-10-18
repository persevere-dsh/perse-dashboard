/** Stateful lab backend. Production Board/Dispatcher/Completion code; only DSH execution is scripted. */
import {
  BoardController,
  initialBoard,
  boardSchema,
} from '../../lib/types/host/board.js'
import { Dispatcher } from '../../lib/types/host/dispatch.js'
import { CompletionCoordinator } from '../../lib/types/host/completion.js'
import { permissionControls } from '../../lib/types/client/permission-api.js'
import { mkdir, writeFile, readFile, rename } from 'node:fs/promises'
import path from 'node:path'
import { EventEmitter } from 'node:events'
export async function makeBackend(
  directory,
  { seed = [], scripts = {}, persist = false } = {},
) {
  const events = new EventEmitter(),
    workspaces = [],
    sessions = new Map(),
    history = new Map(),
    jobs = new Map(),
    running = new Set(),
    gates = new Map()
  let permissionDefault = 'workspace-write',
    permissionRevision = 0,
    permissionWritable = true,
    permissionAvailable = true
  for (const id of ['alpha', 'beta']) {
    const folder = path.join(directory, id)
    await mkdir(folder, { recursive: true })
    workspaces.push({
      id,
      path: folder,
      title: id === 'alpha' ? 'Application' : 'Operations',
      sessionIds: [],
    })
  }
  const addSession = (ws, id = `session-${crypto.randomUUID()}`) => {
    workspaces.find((w) => w.id === ws).sessionIds.push(id)
    sessions.set(id, {
      id,
      workspaceId: ws,
      displayTitle: id,
      cwd: workspaces.find((w) => w.id === ws).path,
      updatedAt: Date.now(),
      running: false,
      projectionValues: {
        tokenUsage: { inputTokens: 0, outputTokens: 0 },
        permissions: { currentValue: permissionDefault },
      },
    })
    return id
  }
  for (const ws of workspaces)
    for (const role of ['builder', 'reviewer', 'analyst'])
      addSession(ws.id, `session-${ws.id}-${role}`)
  if (seed.length) {
    const active = sessions.get('session-alpha-builder')
    active.running = true
    running.add(active.id)
    sessions.get('session-alpha-reviewer').pendingInteraction = {
      kind: 'approval',
      key: 'fixture-approval',
      sessionId: 'session-alpha-reviewer',
    }
    for (const session of sessions.values())
      session.projectionValues.tokenUsage = {
        inputTokens: 120,
        outputTokens: 30,
      }
  }
  if (persist) {
    try {
      const saved = JSON.parse(
        await readFile(path.join(directory, 'lab-runtime.json'), 'utf8'),
      )
      sessions.clear()
      for (const ws of workspaces) ws.sessionIds = []
      running.clear()
      for (const session of saved.sessions) {
        addSession(session.workspaceId, session.id)
        sessions.set(session.id, {
          ...session,
          running: false,
          pendingInteraction: null,
        })
      }
      for (const [id, prompts] of saved.history) history.set(id, prompts)
      permissionDefault = saved.permissionDefault ?? 'workspace-write'
      permissionRevision = saved.permissionRevision ?? 0
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  let saving = Promise.resolve()
  const saveRuntime = () => {
    if (!persist) return Promise.resolve()
    saving = saving.then(async () => {
      const file = path.join(directory, 'lab-runtime.json'),
        temporary = file + '.tmp'
      await writeFile(
        temporary,
        JSON.stringify({
          sessions: [...sessions.values()],
          history: [...history],
          permissionDefault,
          permissionRevision,
        }),
      )
      await rename(temporary, file)
    })
    return saving
  }
  let state = initialBoard()
  if (persist) {
    try {
      state = boardSchema.parse(
        JSON.parse(await readFile(path.join(directory, 'board.json'), 'utf8')),
      )
    } catch (e) {
      if (e.code !== 'ENOENT') throw e
    }
  }
  if (!state.tasks.length && seed.length) {
    state.tasks = boardSchema.parse({
      revision: 0,
      ledger: [],
      receipts: [],
      tasks: seed,
    }).tasks
    state.revision = seed.length
  }
  const board = new BoardController(
    {
      get: () => state,
      set: async (b) => {
        if (persist)
          await writeFile(path.join(directory, 'board.json'), JSON.stringify(b))
        state = b
      },
    },
    {
      workspaces: () => workspaces,
      now: Date.now,
      id: () => crypto.randomUUID(),
    },
  )
  const task = (id) => board.snapshot().tasks.find((t) => t.id === id)
  const permissions = permissionControls({
    async catalog() {
      if (!permissionAvailable) throw Error('Permission provider unavailable')
      return {
        ok: true,
        value: {
          defaultPreset: permissionDefault,
          defaultOptions: [
            { value: 'workspace-write', name: 'Workspace write' },
            { value: 'danger-full-access', name: 'Full access' },
          ],
        },
      }
    },
    async describe() {
      return {
        ok: true,
        value: {
          writable: permissionWritable,
          namespaces: [{ ns: 'permission', revision: permissionRevision }],
        },
      }
    },
    async mutate(ns, ops, revision) {
      if (
        ns !== 'permission' ||
        revision !== permissionRevision ||
        !permissionWritable
      )
        throw Error('Permission settings conflict or read-only')
      if (
        ops.length !== 1 ||
        ops[0].op !== 'set' ||
        ops[0].path.join('.') !== 'defaultPreset' ||
        !['workspace-write', 'danger-full-access'].includes(ops[0].value)
      )
        throw Error('Invalid permission edit')
      permissionDefault = ops[0].value
      permissionRevision++
      await saveRuntime()
      events.emit('change')
      return { ok: true, value: {} }
    },
  })
  const runtime = {
    create: async (ws) => {
      const id = addSession(ws)
      await saveRuntime()
      return id
    },
    running: (id) => running.has(id),
    idle: async (id) => {
      await jobs.get(id)
    },
    prompt: async (id, prompt) => {
      if (running.has(id)) throw Error('Session is already running')
      running.add(id)
      sessions.get(id).running = true
      history.set(id, [...(history.get(id) ?? []), prompt])
      await saveRuntime()
      events.emit('change')
      const match = prompt.match(/(?:issue|task) ([^,\s]+), version (\d+)/),
        t = task(match?.[1])
      if (!t) throw Error('Unknown scripted task')
      const script = scripts[t.id] ?? {}
      const job = Promise.resolve()
        .then(async () => {
          const phase = prompt.startsWith('Analyze dashboard issue')
            ? 'analysis'
            : prompt.startsWith('Review dashboard task')
              ? 'review'
              : 'execution'
          if (script.holdPhase === phase)
            await new Promise((resolve) => gates.set(t.id, resolve))
          if (script.promptFailure) throw Error('Scripted prompt failure')
          if (prompt.startsWith('Analyze dashboard issue')) {
            if (script.missingAnalysis) return
            await board.triage(id, {
              requestId: crypto.randomUUID(),
              taskId: t.id,
              expectedVersion: t.version,
              criteria: t.criteria.length ? t.criteria : ['Result is verified'],
              analysis: {
                summary: 'Scripted lab analysis; no external model.',
                plan: ['Inspect scope', 'Implement result', 'Verify criteria'],
                risk: script.risk ?? 'low',
                route: script.route ?? 'express',
                questions:
                  script.route === 'needs-info'
                    ? ['Which output is required?']
                    : [],
              },
            })
          } else if (prompt.startsWith('Review dashboard task')) {
            if (script.missingReview) return
            await board.submitReview(id, {
              requestId: crypto.randomUUID(),
              taskId: t.id,
              expectedVersion: t.version,
              review: {
                verdict: script.reviewVerdict ?? 'pass',
                risk: script.reviewRisk ?? 'low',
                results: t.criteria
                  .map((_c, criterion) => ({
                    criterion,
                    passed: !script.failedReview,
                    evidence:
                      'Lab independent reviewer inspected criterion ' +
                      criterion,
                  }))
                  .slice(
                    0,
                    script.partialReview
                      ? Math.max(0, t.criteria.length - 1)
                      : t.criteria.length,
                  ),
                remainingRisks: script.remainingRisk
                  ? ['Unverified external effect']
                  : [],
                evidence:
                  'Scripted independent review; native lane separately verifies the actual Agent/tool path.',
              },
            })
          } else {
            if (script.missingReport) return
            for (const check of t.completionPolicy.checks) {
              if (
                check.kind === 'text-equals' &&
                !path.isAbsolute(check.path) &&
                !check.path.split(/[\\/]/).includes('..')
              ) {
                const target = path.join(
                  workspaces.find((w) => w.id === t.workspaceId).path,
                  check.path,
                )
                await mkdir(path.dirname(target), { recursive: true })
                await writeFile(
                  target,
                  script.wrongFile ? 'WRONG_RESULT' : check.expected,
                )
              }
            }
            await board.report(id, {
              requestId: crypto.randomUUID(),
              taskId: t.id,
              expectedVersion: t.version,
              outcome: script.blocked ? 'blocked' : 'review',
              evidence:
                'LAB_EXECUTION_EVIDENCE: scripted work completed in isolated workspace.',
            })
          }
        })
        .finally(async () => {
          running.delete(id)
          sessions.get(id).running = false
          await saveRuntime()
          events.emit('change')
          dispatcher.wake()
        })
      jobs.set(id, job)
      job.catch(() => {})
    },
  }
  const completion = new CompletionCoordinator(
    board,
    runtime,
    (id) => workspaces.find((w) => w.id === id).path,
  )
  const dispatcher = new Dispatcher(
    board,
    runtime,
    () => events.emit('change'),
    (id) => completion.finish(id),
  )
  board.subscribe(() => events.emit('change'))
  const owner = {
    snapshot: async () => {
      const { receipts, ...s } = board.snapshot()
      return {
        ...s,
        dispatch: dispatcher.snapshot(),
        capabilities: {
          create: true,
          update: true,
          dispatch: true,
          analyze: true,
          verify: true,
        },
      }
    },
    create: async (request) => board.create(request),
    update: async (request) => {
      const t = task(request.id)
      if (
        [t?.sessionId, t?.analysisSessionId, t?.reviewSessionId].some(
          (id) => id && runtime.running(id),
        )
      )
        throw Error('busy: Stop the linked native Agent first')
      return board.update(request)
    },
    dispatch: async (request) =>
      dispatcher.configure(request.workspaceId, request.enabled, request),
    analyze: async (request) => {
      const old = task(request.id)
      if (
        [old?.sessionId, old?.analysisSessionId, old?.reviewSessionId].some(
          (id) => id && runtime.running(id),
        )
      )
        throw Error('busy: stop the linked Agent first')
      const prepared = await board.update({
        ...request,
        action: 'move',
        status: 'triage',
      })
      const id = await runtime.create(prepared.workspaceId)
      const t = await board.beginAnalysis(id, prepared.id, prepared.version)
      await runtime.prompt(
        id,
        (await import('../../lib/types/host/prompts.js')).analysisPrompt(t),
      )
      void runtime
        .idle(id)
        .then(async () => {
          const now = task(t.id)
          if (now.status === 'triage' && now.analysisSessionId === id)
            await board.update({
              requestId: crypto.randomUUID(),
              id: t.id,
              expectedVersion: now.version,
              action: 'move',
              status: 'blocked',
              evidence: 'Analysis Agent stopped without a structured report',
            })
        })
        .catch(async (error) => {
          const now = task(t.id)
          if (now.status === 'triage' && now.analysisSessionId === id)
            await board.update({
              requestId: crypto.randomUUID(),
              id: t.id,
              expectedVersion: now.version,
              action: 'move',
              status: 'blocked',
              evidence: String(error),
            })
        })
      return t
    },
    verify: async (request) => {
      const t = task(request.id)
      if (t?.version !== request.expectedVersion) throw Error('conflict')
      return completion.finish(t.id)
    },
  }
  if (persist) {
    await saveRuntime()
    await writeFile(path.join(directory, 'board.json'), JSON.stringify(state))
  }
  return {
    board,
    owner,
    runtime,
    dispatcher,
    completion,
    events,
    workspaces,
    sessions,
    history,
    addSession,
    task,
    scripts,
    permissions,
    async setInteraction(id, kind) {
      const session = sessions.get(id)
      if (!session) throw Error('Session missing')
      session.pendingInteraction = kind
        ? { key: crypto.randomUUID(), kind, sessionId: id }
        : null
      await saveRuntime()
      events.emit('change')
    },
    async permissionControl({ available, writable, preset }) {
      if (available !== undefined) permissionAvailable = available
      if (writable !== undefined) permissionWritable = writable
      if (preset) {
        permissionDefault = preset
        permissionRevision++
      }
      await saveRuntime()
    },
    release: (id) => {
      gates.get(id)?.()
      gates.delete(id)
    },
    data: () => ({
      workspaces: workspaces.map((w) => ({
        workspaceId: w.id,
        title: w.title,
        path: w.path,
        sessionIds: w.sessionIds,
      })),
      sessions: [...sessions.values()],
    }),
    async idle() {
      for (;;) {
        let wake, timer
        const change = new Promise((resolve) => {
          wake = resolve
        })
        events.once('change', wake)
        try {
          await Promise.allSettled([...jobs.values()])
          await new Promise((resolve) => setImmediate(resolve))
          const state = dispatcher.snapshot()
          if (
            !state.activeTaskId &&
            (!state.enabled ||
              (state.watch &&
                !board.analysisEligible(state.workspaceId).length &&
                !board.eligible(state.workspaceId).length))
          )
            return
          await Promise.race([
            change,
            new Promise((_, reject) => {
              timer = setTimeout(
                () =>
                  reject(
                    Error(
                      'Lab failed to settle: no state change within 10 seconds',
                    ),
                  ),
                10000,
              )
            }),
          ])
        } finally {
          events.off('change', wake)
          clearTimeout(timer)
        }
      }
    },
    async close() {
      for (const resolve of gates.values()) resolve()
      gates.clear()
      await dispatcher.close()
      completion.close()
      await Promise.allSettled([...jobs.values()])
      await saveRuntime()
      events.removeAllListeners()
    },
  }
}
