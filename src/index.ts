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
import type {
  CreateRequest,
  UpdateRequest,
  DashboardSnapshot,
  DispatchRequest,
  DispatchState,
  Task,
  TaskCommand,
} from './contract/types.ts'
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
  'agents',
  'tools',
]
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
      prompt: async (sessionId, text, requestId) => {
        await this.ctx.sessionController.prompt(
          {
            sessionId: sessionId as never,
            requestId: requestId as never,
            mode: 'queue',
            content: [{ type: 'text', text }],
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
  @Remote
  async snapshot(): Promise<DashboardSnapshot> {
    this.owner()
    const { receipts, ...snapshot } = this.board.snapshot()
    return {
      ...snapshot,
      dispatch: this.dispatcher.snapshot(),
      capabilities: {
        create: true,
        update: true,
        dispatch: true,
        analyze: true,
        verify: true,
      },
    }
  }
  @Remote
  async create(request: CreateRequest): Promise<Task> {
    return this.protect(() => this.board.create(request))
  }
  @Remote
  async update(request: UpdateRequest): Promise<Task> {
    return this.protect(async () => {
      const current = this.board
        .snapshot()
        .tasks.find((t) => t.id === request.id)
      if (
        [
          current?.sessionId,
          current?.analysisSessionId,
          current?.reviewSessionId,
        ].some((id) => id && this.runtime.running(id)) &&
        ['move', 'accept', 'archive', 'assign', 'edit'].includes(request.action)
      )
        throw new BoardError(
          'busy',
          'Stop the linked Agent before changing task ownership or lifecycle',
        )
      return this.board.update(request)
    })
  }
  @Remote
  async dispatch(request: DispatchRequest): Promise<DispatchState> {
    return this.protect(async () => {
      if (!this.ctx.workspaceRegistry.get(request.workspaceId as never))
        throw new BoardError('workspace-missing', 'Workspace is unavailable')
      return this.dispatcher.configure(
        request.workspaceId,
        request.enabled,
        request,
      )
    })
  }
  @Remote
  async analyze(request: TaskCommand): Promise<Task> {
    return this.protect(async () => {
      const old = this.board.snapshot().tasks.find((t) => t.id === request.id)
      if (!old || old.version !== request.expectedVersion)
        throw new BoardError('conflict', 'Issue changed')
      if (
        [old.sessionId, old.analysisSessionId, old.reviewSessionId].some(
          (id) => id && this.runtime.running(id),
        )
      )
        throw new BoardError('busy', 'Stop the linked Agent before reanalyzing')
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
      try {
        await this.runtime.prompt(id, analysisPrompt(task), crypto.randomUUID())
      } catch (error) {
        await this.board.update({
          requestId: crypto.randomUUID(),
          id: task.id,
          expectedVersion: task.version,
          action: 'move',
          status: 'blocked',
          evidence: String(error),
        })
        throw error
      }
      void this.runtime
        .idle(id)
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
              evidence: 'Analysis Agent stopped without a structured report',
            })
        })
        .catch((error) => {
          this.ctx.logger.warn(error)
        })
      return task
    })
  }
  @Remote
  async verify(request: TaskCommand): Promise<Task> {
    return this.protect(async () => {
      const task = this.board.snapshot().tasks.find((t) => t.id === request.id)
      if (!task || task.version !== request.expectedVersion)
        throw new BoardError('conflict', 'Task changed')
      if (task.status !== 'in-review' || task.archived)
        throw new BoardError(
          'invalid-transition',
          'Only active review tasks may be verified',
        )
      return this.completion.finish(task.id)
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
          'Atomically claim the next eligible dashboard task in your current DSH workspace, or a specified task; repeated calls keep your active claim.',
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
            },
          },
        },
        async execute(args, exec) {
          if (!exec.agent) throw Error('Agent Session required')
          return JSON.stringify(
            await service.board.triage(exec.agent.session.id, {
              requestId: crypto.randomUUID(),
              ...args,
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
