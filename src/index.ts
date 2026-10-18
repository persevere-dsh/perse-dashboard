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
import { Dispatcher } from './host/dispatch.ts'
import type {
  CreateRequest,
  UpdateRequest,
  DashboardSnapshot,
  DispatchRequest,
  DispatchState,
  Task,
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
    this.dispatcher = new Dispatcher(
      this.board,
      {
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
      },
      notify,
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
    return { ...snapshot, dispatch: this.dispatcher.snapshot() }
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
        current?.sessionId &&
        this.ctx.agents.get(current.sessionId as never)?.status === 'running' &&
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
      return this.dispatcher.configure(request.workspaceId, request.enabled)
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
          'Submit a claimed dashboard task for human review with concrete verification evidence. This never marks it accepted or done.',
        parameters: {
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
          return JSON.stringify(
            await service.board.report(exec.agent.session.id, {
              requestId: crypto.randomUUID(),
              ...args,
            }),
          )
        },
        output: {
          schema: { type: 'string' },
          render: (_args, value) => [{ type: 'text', text: value }],
        },
      }),
    )
  }
}
export async function apply(ctx: Context) {
  await ctx.plugin(DashboardService)
}
