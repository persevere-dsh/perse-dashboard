/** Host composition for Persevere with DSH. */
import { Service, type Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-typert-registry'
import {
  TypertRemoteService,
  Remote,
  RemoteError,
} from '@deepseek-ai/dsh-typert-protocol'
import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import {
  BoardController,
  boardSchema,
  initialBoard,
  defaultEnvironment,
  BoardError,
} from './host/board.ts'
import { Dispatcher, type DispatchRuntime } from './host/dispatch.ts'
import { CompletionCoordinator } from './host/completion.ts'
import { analysisPrompt } from './host/prompts.ts'
import { runPhase, imageRouteRefusal } from './host/phases.ts'
import { evidenceImage } from './host/artifacts.ts'
import {
  decodeDraft,
  inputImageDataUrl,
  taskImageLimits,
} from './host/images.ts'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import {
  createPermissionCapability,
  type PermissionCapability,
  type PermissionCapabilityHost,
} from './host/permission-capability.ts'
import type {
  CreateRequest,
  UpdateRequest,
  DashboardSnapshot,
  DispatchRequest,
  DispatchState,
  ImageInputLimits,
  InputImage,
  InputImageDraft,
  InputImageUpdate,
  LaneRequest,
  PermissionApplyPreview,
  PermissionApplyPreviewRequest,
  PermissionApplyRequest,
  PermissionApplyResult,
  RepairPolicyRequest,
  Task,
  TaskCommand,
} from './contract/types.ts'
import { completionPolicySchema } from './host/policy.ts'
declare module '@deepseek-ai/cordis' {
  interface Context {
    perseDashboard: DashboardService
  }
}
export const inject = [
  'typert',
  'storageDomain',
  'workspaceRegistry',
  'sessionController',
  'sessions',
  'agents',
  'tools',
]
const taskCommandSchema = z.strictObject({
  requestId: z.string().min(1).max(150),
  id: z.string(),
  expectedVersion: z.number().int().positive(),
})
const repairPolicySchema = taskCommandSchema.extend({
  completionPolicy: completionPolicySchema,
})
const spec = defineDomain({
  name: 'perse_dashboard',
  version: 1,
  global: { schema: boardSchema, initial: initialBoard() },
  tables: {},
})
export class DashboardService extends TypertRemoteService {
  private board!: BoardController
  private dispatcher!: Dispatcher
  private completion!: CompletionCoordinator
  private permissions!: PermissionCapability
  private runtime!: DispatchRuntime
  private stopped = false
  private listeners = new Set<() => void>()
  constructor(ctx: Context) {
    super(ctx, 'perseDashboard')
  }
  async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(spec)
    this.ctx.effect(() => () => domain.close(), 'perse-dashboard storage')
    this.board = new BoardController(domain.global, {
      ...defaultEnvironment,
      workspaces: () =>
        this.ctx.workspaceRegistry
          .list()
          .map((w) => ({ id: w.id, path: w.path, sessionIds: w.sessionIds })),
      imageLimits: () => this.imageInputLimits(),
    })
    const notify = () => {
      for (const fn of this.listeners) fn()
    }
    this.board.subscribe(notify)
    this.runtime = {
      create: async (workspaceId) =>
        (
          await this.ctx.sessionController.create({
            workspaceId: workspaceId as never,
            sessionId: `session-${crypto.randomUUID()}` as never,
          })
        ).sessionId,
      prompt: async (sessionId, content, requestId) => {
        await this.ctx.sessionController.prompt(
          {
            sessionId: sessionId as never,
            requestId: requestId as never,
            mode: 'queue',
            content,
          },
          new AbortController().signal,
        )
      },
      idle: async (sessionId) => {
        const agent = this.ctx.agents.get(sessionId as never)
        if (!agent) throw new Error('DSH Agent is unavailable')
        await agent.whenIdle()
      },
      running: (sessionId) =>
        this.ctx.agents.get(sessionId as never)?.status === 'running',
      readImage: async (image) => {
        const store = this.attachmentStore()
        if (!store) throw new Error('DSH attachment capability is unavailable')
        const stored = await store.readImage({
          attachmentId: image.attachmentId as never,
          mediaType: image.mediaType,
          bytes: image.bytes,
          width: image.width,
          height: image.height,
          name: image.name,
        })
        return stored.data
      },
      imageRoute: async (sessionId) => {
        const agent = this.ctx.agents.get(sessionId as never)
        let provider: string | undefined
        let model: string | undefined
        // The durable next/last selection is the route the following request
        // consumes; agent.options can still name the route of an earlier turn.
        try {
          const projections = await this.ctx.sessionController.projections(
            { sessionId: sessionId as never },
            new AbortController().signal,
          )
          const selection = projections?.values?.modelSelection
          provider = selection?.next?.provider ?? selection?.lastUsed?.provider
          model = selection?.next?.model ?? selection?.lastUsed?.model
        } catch {}
        provider ??= agent?.options.provider
        model ??= agent?.options.model
        if (!provider || !model) return null
        const llm = this.ctx.get('llm') as
          | {
              resolveModelInfo(
                provider: string,
                model: string,
              ): Promise<{
                inputModalities?: readonly string[]
              }>
            }
          | undefined
        if (!llm?.resolveModelInfo) return { provider, model, images: null }
        try {
          const info = await llm.resolveModelInfo(provider, model)
          return {
            provider,
            model,
            images:
              info.inputModalities === undefined
                ? null
                : info.inputModalities.includes('image'),
          }
        } catch {
          return { provider, model, images: null }
        }
      },
    }
    this.completion = new CompletionCoordinator(
      this.board,
      this.runtime,
      (id) => {
        const ws = this.ctx.workspaceRegistry.get(id as never)
        if (!ws) throw new Error('Workspace unavailable')
        return ws.path
      },
    )
    this.dispatcher = new Dispatcher(this.board, this.runtime, notify, (id) =>
      this.completion.finish(id),
    )
    this.permissions = createPermissionCapability(
      this.ctx as unknown as PermissionCapabilityHost,
    )
    this.ctx.on('agent/status', () => this.dispatcher.wake())
    this.ctx.effect(
      () => () => {
        this.stopped = true
        this.completion.close()
      },
      'dashboard completion',
    )
    this.ctx.effect(
      () => () => this.dispatcher.close(),
      'perse-dashboard dispatcher',
    )
    this.registerTools()
  }
  private owner() {
    if (
      this.ctx.invocation &&
      this.ctx.invocation.peer.principal.kind !== 'owner'
    )
      throw new RemoteError(
        'gateway/bad-request',
        'Dashboard is owner-only',
        {},
      )
  }
  private async protect<T>(operation: () => Promise<T>): Promise<T> {
    this.owner()
    try {
      return await operation()
    } catch (error) {
      if (error instanceof BoardError)
        throw new RemoteError(
          'gateway/bad-request',
          `${error.code}: ${error.message}`,
          {},
        )
      throw error
    }
  }
  private attachmentStore(): AttachmentStore | undefined {
    return this.ctx.get('attachments') as AttachmentStore | undefined
  }
  private imageInputLimits(): ImageInputLimits {
    return taskImageLimits(this.attachmentStore()?.imageLimits)
  }
  /** Persist create drafts in one batch after validating every member. */
  private async saveInputImages(
    drafts: readonly InputImageDraft[] | undefined,
  ): Promise<InputImage[]> {
    if (!drafts?.length) return []
    const store = this.attachmentStore()
    if (!store)
      throw new BoardError(
        'image-unsupported',
        'This DSH Host has no attachment capability; task input images are unavailable',
      )
    const limits = this.imageInputLimits()
    if (drafts.length > limits.maxImages)
      throw new BoardError(
        'image-limit',
        `At most ${limits.maxImages} input images are allowed`,
      )
    const decoded = drafts.map((draft) => decodeDraft(draft, limits))
    let saved
    try {
      saved = await store.saveImages(
        decoded.map((image) => ({
          data: image.data,
          mediaType: image.mediaType,
          name: image.name,
        })),
      )
    } catch (error) {
      throw new BoardError(
        'image-invalid',
        `Image was refused: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    return saved.map((ref, index) => ({
      attachmentId: ref.attachmentId,
      mediaType: ref.mediaType,
      bytes: ref.bytes,
      width: ref.width,
      height: ref.height,
      name: (ref.name ?? decoded[index]!.name).slice(0, 200),
      source: decoded[index]!.source,
    }))
  }
  private async updateInputImages(
    request: UpdateRequest,
    task: Task,
  ): Promise<InputImage[] | undefined> {
    if (request.inputImages === undefined) return undefined
    const drafts = request.inputImages.filter(
      (item): item is InputImageDraft => !('keep' in item),
    )
    const saved = await this.saveInputImages(drafts)
    let next = 0
    return request.inputImages.map((item: InputImageUpdate) => {
      if (!('keep' in item)) return saved[next++]!
      const recorded = task.inputImages.find(
        (image) => image.attachmentId === item.attachmentId,
      )
      if (!recorded)
        throw new BoardError(
          'image-missing',
          'An image retained by this edit is no longer recorded on the task',
        )
      return recorded
    })
  }
  @Remote
  async snapshot(): Promise<DashboardSnapshot> {
    this.owner()
    const {
      receipts: _receipts,
      settingsReceipts: _settingsReceipts,
      ...snapshot
    } = this.board.snapshot()
    return {
      ...snapshot,
      dispatch: this.dispatcher.snapshot(),
      capabilities: {
        create: true,
        update: true,
        dispatch: true,
        analyze: true,
        verify: true,
        imageInput: !!this.attachmentStore(),
      },
      imageLimits: this.imageInputLimits(),
    }
  }
  /** Owner-only read-only classification of the current Host before an apply. */
  @Remote
  async permissionPreview(
    request: PermissionApplyPreviewRequest,
  ): Promise<PermissionApplyPreview> {
    return this.protect(async () => this.permissions.preview(request ?? {}))
  }
  /**
   * Owner-only, explicitly confirmed one-shot apply of the saved default
   * permission to preview targets. It never saves defaults, decides approvals,
   * retries failures or writes anything beyond the official permission API.
   */
  @Remote
  async permissionApply(
    request: PermissionApplyRequest,
  ): Promise<PermissionApplyResult> {
    return this.protect(async () => this.permissions.apply(request))
  }
  @Remote
  async create(request: CreateRequest): Promise<Task> {
    return this.protect(async () => {
      const { inputImages: drafts, ...rest } = request
      const inputImages = await this.saveInputImages(drafts)
      return this.board.create({
        ...rest,
        ...(inputImages.length ? { inputImages } : {}),
      })
    })
  }
  @Remote
  async update(request: UpdateRequest): Promise<Task> {
    return this.protect(async () => {
      const current = this.board
        .snapshot()
        .tasks.find((t) => t.id === request.id)
      if (
        ([
          current?.sessionId,
          current?.analysisSessionId,
          current?.reviewSessionId,
        ].some((id) => id && this.runtime.running(id)) ||
          this.dispatcher
            .snapshot()
            .active.some((slot) => slot.taskId === request.id) ||
          this.completion.active(request.id) ||
          this.dispatcher.analysis.current() === request.id) &&
        ['move', 'accept', 'archive', 'assign', 'edit', 'retry'].includes(
          request.action,
        )
      )
        throw new BoardError(
          'busy',
          'Stop the linked Agent before changing task ownership or lifecycle',
        )
      const inputImages = current
        ? await this.updateInputImages(request, current)
        : undefined
      const { inputImages: _requestImages, ...rest } = request
      return this.board.update({
        ...rest,
        ...(inputImages !== undefined ? { inputImages } : {}),
      })
    })
  }
  /** Owner-only persisted execution lane count; never part of dispatch commands. */
  @Remote
  async setAutomationLanes(
    request: LaneRequest,
  ): Promise<{ workspaceId: string; lanes: number; revision: number }> {
    return this.protect(async () => this.board.setLanes(request))
  }
  @Remote
  async dispatch(request: DispatchRequest): Promise<DispatchState> {
    return this.protect(async () => {
      const parsed = z
        .strictObject({
          workspaceId: z.string().min(1),
          enabled: z.boolean(),
          watch: z.boolean().optional(),
          maxTasks: z.number().int().min(1).max(100).optional(),
        })
        .parse(request)
      if (!this.ctx.workspaceRegistry.get(parsed.workspaceId as never))
        throw new BoardError('workspace-missing', 'Workspace is unavailable')
      return this.dispatcher.configure(
        parsed.workspaceId,
        parsed.enabled,
        parsed,
      )
    })
  }
  @Remote
  async analyze(request: TaskCommand): Promise<Task> {
    return this.protect(async () => {
      const command = taskCommandSchema.parse(request)
      const old = this.board.snapshot().tasks.find((t) => t.id === command.id)
      if (!old || old.version !== command.expectedVersion)
        throw new BoardError('conflict', 'Issue changed')
      if (
        [old.sessionId, old.analysisSessionId, old.reviewSessionId].some(
          (id) => id && this.runtime.running(id),
        ) ||
        this.dispatcher
          .snapshot()
          .active.some((slot) => slot.taskId === command.id) ||
        this.completion.active(command.id) ||
        this.dispatcher.analysis.current() === command.id
      )
        throw new BoardError('busy', 'Stop the linked Agent before reanalyzing')
      if (!this.dispatcher.analysis.acquire(command.id))
        throw new BoardError(
          'busy',
          'Another analysis is already running; analysis is globally serial',
        )
      try {
        return await this.startManualAnalysis(command)
      } catch (error) {
        this.dispatcher.analysis.release(command.id)
        this.dispatcher.wake()
        throw error
      }
    })
  }
  /** Prepare, bind and run one owner-triggered analysis under the shared gate. */
  private async startManualAnalysis(request: TaskCommand): Promise<Task> {
    const old = this.board.snapshot().tasks.find((t) => t.id === request.id)
    if (!old || old.version !== request.expectedVersion)
      throw new BoardError('conflict', 'Issue changed')
    const prepared = await this.board.update({
      ...request,
      action: 'move',
      status: 'triage',
    })
    const id = await this.runtime.create(prepared.workspaceId)
    const task = await this.board.beginAnalysis(
      id,
      prepared.id,
      prepared.version,
    )
    const refusal = task.inputImages.length
      ? imageRouteRefusal(task, await this.runtime.imageRoute(id))
      : null
    if (refusal) {
      this.dispatcher.analysis.release(request.id)
      this.dispatcher.wake()
      return this.board.update({
        requestId: crypto.randomUUID(),
        id: task.id,
        expectedVersion: task.version,
        action: 'move',
        status: 'blocked',
        evidence: refusal,
      })
    }
    void runPhase(
      this.board,
      this.runtime,
      task,
      id,
      'analysis',
      analysisPrompt(task),
      () => this.stopped,
    )
      .then(async () => {
        if (this.stopped) return
        const now = this.board.snapshot().tasks.find((t) => t.id === task.id)
        if (now?.status === 'triage' && now.analysisSessionId === id)
          await this.board.update({
            requestId: crypto.randomUUID(),
            id: now.id,
            expectedVersion: now.version,
            action: 'move',
            status: 'blocked',
            evidence:
              'Analysis Agent stopped without a structured report after one reminder',
          })
      })
      .catch(async (error) => {
        this.ctx.logger.warn(error)
        if (this.stopped) return
        const now = this.board.snapshot().tasks.find((t) => t.id === task.id)
        if (now?.status === 'triage' && now.analysisSessionId === id)
          await this.board.update({
            requestId: crypto.randomUUID(),
            id: now.id,
            expectedVersion: now.version,
            action: 'move',
            status: 'blocked',
            evidence: String(error),
          })
      })
      .catch((error) => this.ctx.logger.warn(error))
      .finally(() => {
        this.dispatcher.analysis.release(request.id)
        this.dispatcher.wake()
      })
    return task
  }
  @Remote
  async verify(request: TaskCommand): Promise<Task> {
    return this.protect(async () => {
      const command = taskCommandSchema.parse(request)
      const task = this.board
        .snapshot()
        .tasks.find((t) => t.id === command.id)
      if (!task || task.version !== command.expectedVersion)
        throw new BoardError('conflict', 'Task changed')
      if (task.status !== 'in-review' || task.archived)
        throw new BoardError(
          'invalid-transition',
          'Only active review tasks may be verified',
        )
      return this.completion.finish(task.id)
    })
  }
  @Remote
  async repairPolicy(request: RepairPolicyRequest): Promise<Task> {
    return this.protect(async () => {
      const command = repairPolicySchema.parse(request)
      const task = this.board
        .snapshot()
        .tasks.find((t) => t.id === command.id)
      if (!task || task.version !== command.expectedVersion)
        throw new BoardError('conflict', 'Task changed')
      if (task.status !== 'in-review' || task.archived)
        throw new BoardError(
          'invalid-transition',
          'Only active review tasks may repair their completion policy',
        )
      if (
        [task.sessionId, task.analysisSessionId, task.reviewSessionId].some(
          (id) => id && this.runtime.running(id),
        )
      )
        throw new BoardError(
          'busy',
          'Stop the linked Agent before repairing the completion policy',
        )
      const repaired = await this.board.repairPolicy({
        ...command,
        completionPolicy: command.completionPolicy,
      })
      return this.completion.finish(repaired.id)
    })
  }
  @Remote
  async image(request: { id: string; path: string }): Promise<string> {
    return this.protect(async () => {
      const task = this.board.snapshot().tasks.find((t) => t.id === request.id)
      if (!task) throw new BoardError('not-found', 'Task no longer exists')
      const ws = this.ctx.workspaceRegistry.get(task.workspaceId as never)
      if (!ws)
        throw new BoardError('workspace-missing', 'Workspace is unavailable')
      return evidenceImage(task, ws.path, request.path)
    })
  }
  @Remote
  async inputImage(request: {
    id: string
    attachmentId: string
  }): Promise<string> {
    return this.protect(async () => {
      const task = this.board.snapshot().tasks.find((t) => t.id === request.id)
      if (!task) throw new BoardError('not-found', 'Task no longer exists')
      const store = this.attachmentStore()
      if (!store)
        throw new BoardError(
          'image-unsupported',
          'This DSH Host has no attachment capability',
        )
      return inputImageDataUrl(task, request.attachmentId, async (image) => {
        const stored = await store.readImage({
          attachmentId: image.attachmentId as never,
          mediaType: image.mediaType,
          bytes: image.bytes,
          width: image.width,
          height: image.height,
          name: image.name,
        })
        return { data: stored.data, mediaType: stored.ref.mediaType }
      })
    })
  }
  @Remote({ mode: 'stream' })
  async *watch(signal: AbortSignal): AsyncIterable<DashboardSnapshot> {
    this.owner()
    let wake: (() => void) | undefined
    let dirty = true
    const listener = () => {
      dirty = true
      wake?.()
    }
    this.listeners.add(listener)
    signal.addEventListener('abort', listener)
    try {
      while (!signal.aborted) {
        if (dirty) {
          dirty = false
          yield await this.snapshot()
        }
        if (!dirty)
          await new Promise<void>((resolve) => {
            wake = resolve
            if (dirty || signal.aborted) resolve()
          })
      }
    } finally {
      this.listeners.delete(listener)
      signal.removeEventListener('abort', listener)
    }
  }
  private registerTools() {
    this.ctx.tools.register(
      defineTool({
        name: 'dashboard_claim_next',
        description:
          'Atomically claim the next eligible dashboard task in your current DSH workspace, or a specified task. Dependencies must all be done; a resource key already held by an in-progress task (same workspace) blocks the claim without preemption. Repeated calls keep your active claim.',
        parameters: {
          taskId: { type: 'string', description: 'Optional exact task id.' },
        },
        async execute(args, exec) {
          if (!exec.agent) throw new Error('Agent Session required')
          return JSON.stringify(
            await service.board.claim(exec.agent.session.id, {
              requestId: crypto.randomUUID(),
              ...(args.taskId ? { taskId: args.taskId } : {}),
            }),
          )
        },
        output: {
          schema: { type: 'string' },
          render: (_args, value) => [{ type: 'text', text: value }],
        },
      }),
    )
    const service = this
    this.ctx.tools.register(
      defineTool({
        name: 'dashboard_report',
        description:
          'Submit concrete verification evidence or a blocked outcome. The Host applies the owner completion policy after the Agent becomes idle; a report alone never completes work.',
        parameters: {
          images: {
            type: 'array',
            description:
              'Optional workspace-relative image evidence, max 12. Images supplement concrete verification evidence.',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                path: { type: 'string', required: true },
                caption: { type: 'string', required: true },
                criterion: { type: 'integer' },
              },
            },
          },
          outcome: {
            type: 'string',
            enum: ['review', 'blocked'],
            description:
              'Use blocked when a requirement or verification cannot be completed.',
          },
          taskId: {
            type: 'string',
            required: true,
            description: 'Claimed task id.',
          },
          expectedVersion: {
            type: 'integer',
            required: true,
            description: 'Version returned by claim.',
          },
          evidence: {
            type: 'string',
            required: true,
            description:
              'Tests, artifact paths, outcomes and remaining limitations.',
          },
        },
        async execute(args, exec) {
          if (!exec.agent) throw new Error('Agent Session required')
          const task = await service.board.report(exec.agent.session.id, {
            requestId: crypto.randomUUID(),
            ...args,
          })
          if (
            task.status === 'in-review' &&
            task.completionPolicy.mode !== 'manual'
          )
            void service.completion
              .finish(task.id)
              .catch((error) => service.ctx.logger.warn(error))
          return JSON.stringify(task)
        },
        output: {
          schema: { type: 'string' },
          render: (_args, value) => [{ type: 'text', text: value }],
        },
      }),
    )
    const identity = {
      taskId: { type: 'string', required: true, description: 'Phase task id.' },
      expectedVersion: {
        type: 'integer',
        required: true,
        description: 'Exact phase version.',
      },
    } as const
    const stringList = { type: 'array', items: { type: 'string' } } as const
    const risk = {
      type: 'string',
      enum: ['low', 'medium', 'high'],
      required: true,
    } as const
    const output = {
      schema: { type: 'string' },
      render: (_args: unknown, value: string) => [
        { type: 'text' as const, text: value },
      ],
    } as const
    this.ctx.tools.register(
      defineTool({
        name: 'dashboard_triage',
        description:
          'Report analysis for the issue bound to this analysis Session. Preserve frozen criteria; this cannot complete or execute the issue.',
        parameters: {
          ...identity,
          criteria: { ...stringList, required: true },
          analysis: {
            type: 'object',
            additionalProperties: false,
            required: true,
            properties: {
              summary: { type: 'string', required: true },
              plan: { ...stringList, required: true },
              risk,
              route: {
                type: 'string',
                enum: ['express', 'staged', 'needs-info', 'human'],
                required: true,
              },
              questions: { ...stringList, required: true },
              coordination: {
                type: 'object',
                additionalProperties: false,
                description:
                  'Optional machine-readable coordination suggestions. The Host validates them but never writes them into Task dependencies or resource keys.',
                properties: {
                  dependencies: { ...stringList, required: true },
                  resourceKeys: { ...stringList, required: true },
                  dependencyOrder: { ...stringList, required: true },
                  resourceConflicts: {
                    type: 'array',
                    required: true,
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      properties: {
                        key: { type: 'string', required: true },
                        taskIds: { ...stringList, required: true },
                      },
                    },
                  },
                  isolation: {
                    type: 'string',
                    enum: ['none', 'workspace', 'manual-workspace'],
                    required: true,
                  },
                  mergeRisk: { ...risk, required: true },
                },
              },
            },
          },
        },
        async execute(args, exec) {
          if (!exec.agent) throw Error('Agent Session required')
          return JSON.stringify(
            await service.board.triage(exec.agent.session.id, {
              requestId: crypto.randomUUID(),
              ...args,
              analysis: {
                ...args.analysis,
                coordination: args.analysis.coordination ?? null,
              },
            }),
          )
        },
        output,
      }),
    )
    this.ctx.tools.register(
      defineTool({
        name: 'dashboard_review',
        description:
          'Submit independent criterion-by-criterion review. Only the separately bound reviewer Session may report; the Host alone applies completion after idle.',
        parameters: {
          ...identity,
          review: {
            type: 'object',
            additionalProperties: false,
            required: true,
            properties: {
              verdict: {
                type: 'string',
                enum: ['pass', 'fail', 'needs-human'],
                required: true,
              },
              risk,
              results: {
                type: 'array',
                required: true,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    criterion: { type: 'integer', required: true },
                    passed: { type: 'boolean', required: true },
                    evidence: { type: 'string', required: true },
                  },
                },
              },
              remainingRisks: { ...stringList, required: true },
              evidence: { type: 'string', required: true },
            },
          },
        },
        async execute(args, exec) {
          if (!exec.agent) throw Error('Agent Session required')
          return JSON.stringify(
            await service.board.submitReview(exec.agent.session.id, {
              requestId: crypto.randomUUID(),
              ...args,
            }),
          )
        },
        output,
      }),
    )
  }
}
export async function apply(ctx: Context) {
  await ctx.plugin(DashboardService)
}
