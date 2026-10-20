/** Stateful lab backend. Production Board/Dispatcher/Completion code; only DSH execution is scripted. */
import {
  BoardController,
  initialBoard,
  boardSchema,
} from '../../lib/types/host/board.js'
import { runPhase, imageRouteRefusal } from '../../lib/types/host/phases.js'
import { evidenceImage } from '../../lib/types/host/artifacts.js'
import {
  decodeDraft,
  inputImageDataUrl,
  taskImageLimits,
} from '../../lib/types/host/images.js'
import { Dispatcher } from '../../lib/types/host/dispatch.js'
import { CompletionCoordinator } from '../../lib/types/host/completion.js'
import {
  permissionApply,
  permissionApplyPreview,
  permissionPendingReason,
} from '../../lib/types/host/permission-apply.js'
import { permissionControls } from '../../lib/types/client/permission-api.js'
import { mkdir, writeFile, readFile, rename } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { EventEmitter } from 'node:events'
export async function makeBackend(
  directory,
  { seed = [], scripts = {}, persist = false, scenario = '' } = {},
) {
  const events = new EventEmitter(),
    workspaces = [],
    sessions = new Map(),
    history = new Map(),
    jobs = new Map(),
    running = new Set(),
    gates = new Map(),
    archivedSessionIds = []
  let closed = false
  let permissionDefault = 'workspace-write',
    permissionRevision = 0,
    permissionWritable = true,
    permissionAvailable = true,
    permissionFailSessionId = null,
    permissionMismatchSessionId = null,
    permissionLastResult = null
  const permissionAttempts = new Map()
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
  const addSession = (
    ws,
    id = `session-${crypto.randomUUID()}`,
    preset = permissionDefault,
  ) => {
    const workspace = workspaces.find((w) => w.id === ws)
    if (!workspace.sessionIds.includes(id)) workspace.sessionIds.push(id)
    if (sessions.has(id)) return id
    sessions.set(id, {
      id,
      workspaceId: ws,
      displayTitle: id,
      cwd: workspace.path,
      updatedAt: Date.now(),
      running: false,
      imageCapable: true,
      projectionValues: {
        tokenUsage: { inputTokens: 0, outputTokens: 0 },
        permissions: { currentValue: preset },
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
        if (workspaces.some((w) => w.id === session.workspaceId))
          addSession(session.workspaceId, session.id)
        sessions.set(session.id, {
          ...session,
          running: false,
          pendingInteraction: null,
        })
      }
      for (const [id, prompts] of saved.history) history.set(id, prompts)
      for (const savedWorkspace of saved.workspaces ?? []) {
        const target = workspaces.find((w) => w.id === savedWorkspace.id)
        if (!target) continue
        for (const id of savedWorkspace.sessionIds ?? [])
          if (!target.sessionIds.includes(id)) target.sessionIds.push(id)
      }
      for (const id of saved.archivedSessionIds ?? [])
        if (!archivedSessionIds.includes(id)) archivedSessionIds.push(id)
      permissionDefault = saved.permissionDefault ?? 'workspace-write'
      permissionRevision = saved.permissionRevision ?? 0
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  if (scenario === 'permission-settings') {
    for (const id of [
      'session-alpha-builder',
      'session-alpha-reviewer',
      'session-alpha-analyst',
    ])
      if (sessions.has(id))
        sessions.get(id).projectionValues.permissions.currentValue = 'read-only'
    addSession('alpha', 'session-alpha-runner', 'read-only')
    sessions.get('session-alpha-runner').running = true
    running.add('session-alpha-runner')
    addSession('alpha', 'session-alpha-pending', 'read-only')
    sessions.get('session-alpha-pending').pendingInteraction = {
      kind: 'approval',
      key: 'fixture-permission-pending',
      sessionId: 'session-alpha-pending',
    }
    addSession('alpha', 'session-alpha-child', 'read-only')
    sessions.get('session-alpha-child').parentSessionId =
      'session-alpha-builder'
    sessions.get('session-alpha-child').origin = 'subagent'
    addSession('alpha', 'session-alpha-cold', 'read-only')
    sessions.delete('session-alpha-cold')
    addSession('beta', 'session-beta-archived', 'read-only')
    if (!archivedSessionIds.includes('session-beta-archived'))
      archivedSessionIds.push('session-beta-archived')
    if (!sessions.has('session-foreign-live'))
      sessions.set('session-foreign-live', {
        id: 'session-foreign-live',
        workspaceId: null,
        displayTitle: 'Foreign workspace Session',
        cwd: path.join(directory, 'foreign'),
        updatedAt: Date.now(),
        running: false,
        imageCapable: true,
        projectionValues: {
          tokenUsage: { inputTokens: 0, outputTokens: 0 },
          permissions: { currentValue: 'read-only' },
        },
      })
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
          workspaces: workspaces.map((workspace) => ({
            id: workspace.id,
            sessionIds: [...workspace.sessionIds],
          })),
          archivedSessionIds: [...archivedSessionIds],
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
  const imageLimits = taskImageLimits(undefined),
    attachmentFiles = new Map()
  const saveInputImages = (drafts) => {
    if (!drafts?.length) return []
    if (drafts.length > imageLimits.maxImages)
      throw Error(
        `image-limit: At most ${imageLimits.maxImages} input images are allowed`,
      )
    const decoded = drafts.map((draft) => decodeDraft(draft, imageLimits))
    const saved = decoded.map((image) => {
      const attachmentId = createHash('sha256').update(image.data).digest('hex')
      const ref = {
        attachmentId,
        mediaType: image.mediaType,
        bytes: image.data.length,
        width: image.width,
        height: image.height,
        name: image.name.slice(0, 200),
      }
      attachmentFiles.set(attachmentId, {
        ...ref,
        data: image.data,
      })
      return { ...ref, source: image.source }
    })
    return saved
  }
  const updateInputImages = (request, task) => {
    if (request.inputImages === undefined) return undefined
    const saved = saveInputImages(
      request.inputImages.filter((item) => !item.keep),
    )
    let next = 0
    return request.inputImages.map((item) => {
      if (!item.keep) return saved[next++]
      const recorded = task.inputImages.find(
        (image) => image.attachmentId === item.attachmentId,
      )
      if (!recorded)
        throw Error(
          'image-missing: An image retained by this edit is no longer recorded on the task',
        )
      return recorded
    })
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
      imageLimits: () => imageLimits,
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
            { value: 'read-only', name: 'Read only' },
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
        !['read-only', 'workspace-write', 'danger-full-access'].includes(
          ops[0].value,
        )
      )
        throw Error('Invalid permission edit')
      permissionDefault = ops[0].value
      permissionRevision++
      await saveRuntime()
      events.emit('change')
      return { ok: true, value: {} }
    },
  })
  const permissionOptions = [
    { id: 'read-only', name: 'Read only' },
    { id: 'workspace-write', name: 'Workspace write' },
    { id: 'danger-full-access', name: 'Full access' },
  ]
  const presetSpec = (preset) =>
    preset === 'read-only'
      ? { sandbox: 'read-only', approval: 'ask' }
      : preset === 'workspace-write'
        ? { sandbox: 'workspace-write', approval: 'ask' }
        : preset === 'danger-full-access'
          ? { sandbox: 'danger-full-access', approval: 'never' }
          : null
  const permissionEnvironment = () => {
    const spec = presetSpec(permissionDefault),
      option = permissionOptions.find((o) => o.id === permissionDefault),
      fullAccessBlocked = spec?.sandbox === 'danger-full-access'
    const reason = !permissionAvailable
      ? 'permission-unavailable'
      : !spec || !option
        ? 'permission-preset-unavailable'
        : fullAccessBlocked
          ? 'permission-full-access'
          : ''
    return {
      available:
        permissionAvailable && !!spec && !!option && !fullAccessBlocked,
      reason,
      preset: permissionDefault,
      presetName: option?.name ?? permissionDefault,
      revision: permissionRevision,
      writable: permissionWritable,
      fullAccessBlocked,
      options: permissionOptions,
      spec,
    }
  }
  const permissionFacts = () => {
    const ids = new Set([...sessions.keys(), ...archivedSessionIds])
    for (const workspace of workspaces)
      for (const id of workspace.sessionIds) ids.add(id)
    return [...ids].map((id) => {
      const session = sessions.get(id),
        workspace =
          workspaces.find((w) => w.sessionIds.includes(id)) ??
          (session?.workspaceId
            ? workspaces.find((w) => w.id === session.workspaceId)
            : undefined),
        preset = session?.projectionValues?.permissions?.currentValue,
        spec = presetSpec(preset)
      return {
        sessionId: id,
        workspaceId: workspace?.id ?? null,
        workspaceTitle: workspace?.title ?? null,
        title: session?.displayTitle ?? id,
        live: !!session,
        archived: archivedSessionIds.includes(id),
        child: !!session?.parentSessionId || session?.origin === 'subagent',
        running: running.has(id) || !!session?.running,
        pendingKind: session?.pendingInteraction
          ? permissionPendingReason(session.pendingInteraction.kind)
          : null,
        effective: session
          ? {
              preset: preset ?? 'unknown',
              sandbox: spec?.sandbox ?? 'unknown',
              approval: spec?.approval ?? 'ask',
            }
          : null,
      }
    })
  }
  const permissionPreview = async (body) =>
    permissionApplyPreview(
      permissionEnvironment(),
      permissionFacts(),
      body ?? {},
    )
  const permissionApplyRequest = async (body) => {
    const result = permissionApply(
      permissionEnvironment(),
      permissionFacts(),
      body ?? {},
      {
        read(sessionId) {
          const session = sessions.get(sessionId)
          if (!session) throw Error('Session is no longer live')
          if (sessionId === permissionMismatchSessionId)
            return { preset: 'custom', sandbox: 'unknown', approval: 'ask' }
          const preset = session.projectionValues.permissions.currentValue,
            spec = presetSpec(preset)
          return {
            preset: preset ?? 'unknown',
            sandbox: spec?.sandbox ?? 'unknown',
            approval: spec?.approval ?? 'ask',
          }
        },
        write(sessionId, preset) {
          permissionAttempts.set(
            sessionId,
            (permissionAttempts.get(sessionId) ?? 0) + 1,
          )
          if (sessionId === permissionFailSessionId)
            throw Error('Lab fault: permission write failed')
          const session = sessions.get(sessionId)
          if (!session) throw Error('Session is no longer live')
          if (sessionId === permissionMismatchSessionId) return
          session.projectionValues.permissions.currentValue = preset
        },
      },
    )
    permissionLastResult = result
    await saveRuntime()
    events.emit('change')
    return result
  }
  const permissionApplyState = () => ({
    attempts: Object.fromEntries(permissionAttempts),
    lastResult: permissionLastResult,
    faults: {
      failSessionId: permissionFailSessionId,
      mismatchSessionId: permissionMismatchSessionId,
    },
  })
  const runtime = {
    create: async (ws) => {
      const id = addSession(ws)
      await saveRuntime()
      return id
    },
    running: (id) => running.has(id),
    readImage: async (image) => {
      const stored = attachmentFiles.get(image.attachmentId)
      if (!stored || stored.mediaType !== image.mediaType)
        throw Error('Stored image is missing or corrupt')
      return stored.data
    },
    imageRoute: async (id) => ({
      provider: 'lab',
      model: sessions.get(id)?.imageCapable === false ? 'text-only' : 'image',
      images: sessions.get(id)?.imageCapable !== false,
    }),
    idle: async (id) => {
      await jobs.get(id)
    },
    prompt: async (id, content) => {
      if (running.has(id)) throw Error('Session is already running')
      running.add(id)
      sessions.get(id).running = true
      const prompt = content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('\n')
      history.set(id, [...(history.get(id) ?? []), prompt])
      await saveRuntime()
      events.emit('change')
      const factLine = prompt.match(/^TASK_DATA=(.+)$/m)?.[1],
        data = factLine ? JSON.parse(factLine) : null,
        match = prompt.match(/(?:issue|task) ([^,\s]+), version (\d+)/),
        t = task(data?.taskId ?? match?.[1])
      if (!t) throw Error('Unknown scripted task')
      const script = scripts[t.id] ?? {},
        reminder = /^REPORT_REMINDER: /m.test(prompt),
        chinese = t.language === 'zh',
        text = (en, zh) => (chinese ? zh : en)
      const job = Promise.resolve()
        .then(async () => {
          const phase =
            prompt.match(/PERSE_PHASE=(analysis|execution|review)/)?.[1] ??
            (prompt.includes('dashboard_triage')
              ? 'analysis'
              : prompt.includes('dashboard_review')
                ? 'review'
                : 'execution')
          if (script.holdPhase === phase)
            await new Promise((resolve) => gates.set(t.id, resolve))
          if (script.promptFailure) throw Error('Scripted prompt failure')
          if (phase === 'analysis') {
            if (
              script.missingAnalysis ||
              (script.missingAnalysisOnce && !reminder)
            )
              return
            await board.triage(id, {
              requestId: crypto.randomUUID(),
              taskId: t.id,
              expectedVersion: t.version,
              criteria: t.criteria.length
                ? t.criteria
                : [text('Result is verified', '结果已通过验证')],
              analysis: {
                summary: text(
                  'Scripted lab analysis; no external model.',
                  '脚本化 Lab 分析；未调用外部模型。',
                ),
                plan: text(
                  ['Inspect scope', 'Implement result', 'Verify criteria'],
                  ['检查范围', '实施结果', '验证标准'],
                ),
                risk: script.risk ?? 'low',
                route: script.route ?? 'express',
                questions:
                  script.route === 'needs-info'
                    ? [text('Which output is required?', '需要哪种输出结果？')]
                    : [],
                coordination: {
                  dependencies: t.dependencies ?? [],
                  resourceKeys: t.resourceKeys ?? [],
                  dependencyOrder: [...(t.dependencies ?? []), t.id],
                  resourceConflicts: [],
                  isolation:
                    (t.dependencies ?? []).length ||
                    (t.resourceKeys ?? []).length
                      ? 'workspace'
                      : 'none',
                  mergeRisk: script.risk ?? 'low',
                },
              },
            })
          } else if (phase === 'review') {
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
                      text(
                        'Lab independent reviewer inspected criterion ',
                        'Lab 独立复核者检查了验收项 ',
                      ) + criterion,
                  }))
                  .slice(
                    0,
                    script.partialReview
                      ? Math.max(0, t.criteria.length - 1)
                      : t.criteria.length,
                  ),
                remainingRisks: script.remainingRisk
                  ? [text('Unverified external effect', '存在未验证的外部影响')]
                  : [],
                evidence: text(
                  'Scripted independent review; native lane separately verifies the actual Agent/tool path.',
                  '脚本化独立复核；原生链路另行验证真实 Agent/工具路径。',
                ),
              },
            })
          } else {
            if (script.missingReport || (script.missingReportOnce && !reminder))
              return
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
            if (script.images?.length) {
              for (const image of script.images) {
                if (path.isAbsolute(image.path) || image.path.includes('..'))
                  continue
                const target = path.join(
                  workspaces.find((w) => w.id === t.workspaceId).path,
                  image.path,
                )
                await mkdir(path.dirname(target), { recursive: true })
                await writeFile(
                  target,
                  Buffer.from(
                    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
                    'base64',
                  ),
                )
              }
            }
            await board.report(id, {
              requestId: crypto.randomUUID(),
              taskId: t.id,
              expectedVersion: t.version,
              outcome: script.blocked ? 'blocked' : 'review',
              images: script.images ?? [],
              evidence: text(
                'LAB_EXECUTION_EVIDENCE: scripted work completed in isolated workspace.',
                'LAB_EXECUTION_EVIDENCE：脚本化工作已在隔离工作区完成。',
              ),
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
          imageInput: true,
        },
        imageLimits,
      }
    },
    create: async (request) => {
      const { inputImages: drafts, ...rest } = request
      const images = saveInputImages(drafts)
      return board.create({
        ...rest,
        ...(images.length ? { inputImages: images } : {}),
      })
    },
    image: async ({ id, path: relative }) => {
      const t = task(id)
      return evidenceImage(
        t,
        workspaces.find((w) => w.id === t.workspaceId).path,
        relative,
      )
    },
    inputImage: async ({ id, attachmentId }) => {
      const t = task(id)
      return inputImageDataUrl(t, attachmentId, async (image) => {
        const stored = attachmentFiles.get(image.attachmentId)
        if (!stored) throw Error('missing')
        return { data: stored.data, mediaType: stored.mediaType }
      })
    },
    update: async (request) => {
      const t = task(request.id)
      if (
        [t?.sessionId, t?.analysisSessionId, t?.reviewSessionId].some(
          (id) => id && runtime.running(id),
        ) ||
        dispatcher
          .snapshot()
          .active.some((slot) => slot.taskId === request.id) ||
        completion.active(request.id)
      )
        throw Error('busy: Stop the linked native Agent first')
      const { inputImages: _requestImages, ...rest } = request
      const images = t ? updateInputImages(request, t) : undefined
      return board.update({
        ...rest,
        ...(images !== undefined ? { inputImages: images } : {}),
      })
    },
    dispatch: async (request) =>
      dispatcher.configure(request.workspaceId, request.enabled, request),
    setAutomationLanes: async (request) => board.setLanes(request),
    analyze: async (request) => {
      const old = task(request.id)
      if (
        [old?.sessionId, old?.analysisSessionId, old?.reviewSessionId].some(
          (id) => id && runtime.running(id),
        ) ||
        dispatcher
          .snapshot()
          .active.some((slot) => slot.taskId === request.id) ||
        completion.active(request.id)
      )
        throw Error('busy: stop the linked Agent first')
      const prepared = await board.update({
        ...request,
        action: 'move',
        status: 'triage',
      })
      const id = await runtime.create(prepared.workspaceId)
      const t = await board.beginAnalysis(id, prepared.id, prepared.version)
      const refusal = t.inputImages.length
        ? imageRouteRefusal(t, await runtime.imageRoute(id))
        : null
      if (refusal)
        return board.update({
          requestId: crypto.randomUUID(),
          id: t.id,
          expectedVersion: t.version,
          action: 'move',
          status: 'blocked',
          evidence: refusal,
        })
      void runPhase(
        board,
        runtime,
        t,
        id,
        'analysis',
        (await import('../../lib/types/host/prompts.js')).analysisPrompt(t),
        () => closed,
      )
        .then(async () => {
          const now = task(t.id)
          if (now.status === 'triage' && now.analysisSessionId === id)
            await board.update({
              requestId: crypto.randomUUID(),
              id: t.id,
              expectedVersion: now.version,
              action: 'move',
              status: 'blocked',
              evidence:
                'Analysis Agent stopped without a structured report after one reminder',
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
    permissionPreview,
    permissionApply: permissionApplyRequest,
    permissionApplyState,
    archivedSessionIds,
    async setInteraction(id, kind) {
      const session = sessions.get(id)
      if (!session) throw Error('Session missing')
      session.pendingInteraction = kind
        ? { key: crypto.randomUUID(), kind, sessionId: id }
        : null
      await saveRuntime()
      events.emit('change')
    },
    async permissionControl({
      available,
      writable,
      preset,
      sessionId,
      sessionPreset,
      failSessionId,
      mismatchSessionId,
    }) {
      if (available !== undefined) permissionAvailable = available
      if (writable !== undefined) permissionWritable = writable
      if (preset) {
        permissionDefault = preset
        permissionRevision++
      }
      if (sessionId && sessionPreset) {
        const session = sessions.get(sessionId)
        if (!session) throw Error('Session missing')
        session.projectionValues.permissions.currentValue = sessionPreset
      }
      if (failSessionId !== undefined) permissionFailSessionId = failSessionId
      if (mismatchSessionId !== undefined)
        permissionMismatchSessionId = mismatchSessionId
      await saveRuntime()
      events.emit('change')
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
      archivedSessionIds: [...archivedSessionIds],
      permissionApply: permissionApplyState(),
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
            !completion.busy() &&
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
      closed = true
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
