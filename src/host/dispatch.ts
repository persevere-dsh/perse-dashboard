/** Event-driven, bounded intake and execution over official DSH Session commands. */
import { randomUUID } from 'node:crypto'
import type {
  DispatchState,
  Task,
  DispatchRequest,
  InputImage,
} from '../contract/types.ts'
import { BoardController, BoardError } from './board.ts'
import { analysisPrompt, taskPrompt, type PromptContentPart } from './prompts.ts'
import { runPhase, imageRouteRefusal } from './phases.ts'
export { taskPrompt } from './prompts.ts'
export interface ImageRoute {
  provider: string
  model: string
  images: boolean | null
}
export interface DispatchRuntime {
  create(workspaceId: string): Promise<string>
  prompt(
    sessionId: string,
    content: readonly PromptContentPart[],
    requestId: string,
  ): Promise<void>
  idle(sessionId: string): Promise<void>
  running(sessionId: string): boolean
  /** Read one recorded task image for the ordered phase prompt. */
  readImage(image: InputImage): Promise<Uint8Array>
  /** Resolve the exact Session route's declared image capability. */
  imageRoute(sessionId: string): Promise<ImageRoute | null>
}
export class Dispatcher {
  private state: DispatchState = {
    enabled: false,
    workspaceId: null,
    activeTaskId: null,
    activeSessionId: null,
    error: null,
    errorTaskId: null,
    watch: false,
    processed: 0,
    maxTasks: 10,
  }
  private work: Promise<void> | undefined
  private closed = false
  private seen = new Set<string>()
  private unsubscribe: () => void
  constructor(
    private board: BoardController,
    private runtime: DispatchRuntime,
    private changed: () => void,
    private finish: (id: string) => Promise<unknown> = async () => {},
  ) {
    this.unsubscribe = board.subscribe(() => this.wake())
  }
  snapshot() {
    return { ...this.state }
  }
  configure(
    workspaceId: string,
    enabled: boolean,
    options: Pick<DispatchRequest, 'watch' | 'maxTasks'> = {},
  ) {
    if (
      typeof workspaceId !== 'string' ||
      !workspaceId ||
      typeof enabled !== 'boolean' ||
      (options.watch !== undefined && typeof options.watch !== 'boolean')
    )
      throw new BoardError(
        'invalid-dispatch',
        'Dispatch requires a workspace, boolean enabled and boolean watch',
      )
    if (this.closed) throw new BoardError('closed', 'Dispatcher is closed')
    if (this.work && this.state.workspaceId !== workspaceId)
      throw new BoardError('busy', 'Stop the active workspace before switching')
    const maxTasks = options.maxTasks ?? 10
    if (!Number.isInteger(maxTasks) || maxTasks < 1 || maxTasks > 100)
      throw new BoardError('budget', 'Task budget must be between 1 and 100')
    if (enabled && !this.state.enabled) {
      this.seen.clear()
      this.state.processed = 0
    }
    this.state = {
      ...this.state,
      workspaceId,
      enabled,
      watch: options.watch ?? false,
      maxTasks,
      error: null,
      errorTaskId: null,
    }
    this.changed()
    this.wake()
    return this.snapshot()
  }
  /** Native agent/status notifications wake assigned work without polling. */
  wake() {
    if (
      this.closed ||
      !this.state.enabled ||
      this.work ||
      !this.state.workspaceId
    )
      return
    const workspaceId = this.state.workspaceId
    this.work = this.drain(workspaceId).finally(() => {
      this.work = undefined
      if (!this.state.watch || this.state.error) this.state.enabled = false
      if (
        this.state.enabled &&
        !this.pending(workspaceId) &&
        this.seen.size >= this.state.maxTasks
      )
        this.state.enabled = false
      this.changed()
      if (this.state.enabled && this.pending(workspaceId)) this.wake()
    })
  }
  private pending(workspaceId: string): Task | undefined {
    const available = (t: Task) =>
      this.seen.has(t.id) || this.seen.size < this.state.maxTasks
    return (
      this.board.analysisEligible(workspaceId).find(available) ??
      this.board
        .eligible(workspaceId)
        .find(
          (t) =>
            available(t) && (!t.assignee || !this.runtime.running(t.assignee)),
        )
    )
  }
  private async drain(workspaceId: string) {
    try {
      while (this.state.enabled && !this.closed) {
        const task = this.pending(workspaceId)
        if (!task) break
        this.state.activeTaskId = task.id
        this.state.activeSessionId = null
        this.changed()
        const analyzing = task.intake && !task.analysis
        const sessionId = analyzing
          ? await this.runtime.create(workspaceId)
          : (task.assignee ?? (await this.runtime.create(workspaceId)))
        if (!this.state.enabled || this.closed) break
        const claimed = analyzing
          ? await this.board.beginAnalysis(sessionId, task.id, task.version)
          : await this.board.claim(sessionId, {
              requestId: randomUUID(),
              taskId: task.id,
            })
        if (!this.state.enabled || this.closed) {
          await this.board.update({
            requestId: randomUUID(),
            id: claimed.id,
            expectedVersion: claimed.version,
            action: 'move',
            status: analyzing ? 'triage' : 'todo',
          })
          break
        }
        if (!this.seen.has(task.id)) {
          this.seen.add(task.id)
          this.state.processed = this.seen.size
        }
        this.state = {
          ...this.state,
          activeTaskId: task.id,
          activeSessionId: sessionId,
        }
        this.changed()
        const refusal = claimed.inputImages.length
          ? imageRouteRefusal(
              claimed,
              await this.runtime.imageRoute(sessionId),
            )
          : null
        if (refusal) {
          const latest = this.board
            .snapshot()
            .tasks.find((t) => t.id === claimed.id)
          if (latest?.version === claimed.version)
            await this.board.update({
              requestId: randomUUID(),
              id: claimed.id,
              expectedVersion: claimed.version,
              action: 'move',
              status: 'blocked',
              evidence: refusal,
            })
          // A route capability omission is task-local; later issues remain eligible.
          this.state = {
            ...this.state,
            activeTaskId: null,
            activeSessionId: null,
          }
          this.changed()
          continue
        }
        try {
          await runPhase(
            this.board,
            this.runtime,
            claimed,
            sessionId,
            analyzing ? 'analysis' : 'execution',
            analyzing ? analysisPrompt(claimed) : taskPrompt(claimed),
            () => this.closed,
          )
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error)
          // The route guard should catch this first. If admission still refuses
          // images, treat it as task-local rather than pausing all dispatch.
          if (
            claimed.inputImages.length &&
            /image input|does not support image|image-capable/i.test(message)
          ) {
            const latest = this.board
              .snapshot()
              .tasks.find((t) => t.id === claimed.id)
            if (latest?.version === claimed.version)
              await this.board.update({
                requestId: randomUUID(),
                id: claimed.id,
                expectedVersion: claimed.version,
                action: 'move',
                status: 'blocked',
                evidence: `Image input is unsupported by the selected model route: ${message} Images were not silently dropped. Select an image-capable model and retry the task.`,
              })
            this.state = {
              ...this.state,
              activeTaskId: null,
              activeSessionId: null,
            }
            this.changed()
            continue
          }
          throw error
        }
        if (this.closed) break
        const current = this.board
          .snapshot()
          .tasks.find((t) => t.id === task.id)
        if (
          (analyzing &&
            current?.status === 'triage' &&
            current.analysisSessionId === sessionId) ||
          (!analyzing &&
            current?.status === 'in-progress' &&
            current.sessionId === sessionId)
        ) {
          const blocked = await this.board.update({
            requestId: randomUUID(),
            id: task.id,
            expectedVersion: current.version,
            action: 'move',
            status: 'blocked',
            evidence:
              'Agent stopped without the required phase report. Inspect its native DSH Session before retrying.',
          })
          // A task-local omission is visible on that task; later issues remain eligible.
          await this.board.note(
            task.id,
            blocked.version,
            'phase-report-missing',
          )
        }
        if (current?.status === 'in-review') await this.finish(current.id)
        this.state = {
          ...this.state,
          activeTaskId: null,
          activeSessionId: null,
        }
        this.changed()
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Dispatch failed'
      const active = this.board
        .snapshot()
        .tasks.find((t) => t.id === this.state.activeTaskId)
      if (
        active &&
        ((active.status === 'triage' &&
          active.analysisSessionId === this.state.activeSessionId) ||
          (active.status === 'in-progress' &&
            active.sessionId === this.state.activeSessionId))
      ) {
        try {
          await this.board.update({
            requestId: randomUUID(),
            id: active.id,
            expectedVersion: active.version,
            action: 'move',
            status: 'blocked',
            evidence: `Dispatch failed: ${message}. Inspect the linked DSH Session before requeueing.`,
          })
        } catch (persistError) {
          this.state.error = `${message}; failed to persist blocked state: ${persistError instanceof Error ? persistError.message : String(persistError)}`
        }
      }
      this.state.errorTaskId = this.state.activeTaskId
      this.state.error ??= message
      this.state.enabled = false
    } finally {
      this.state = { ...this.state, activeTaskId: null, activeSessionId: null }
      this.changed()
    }
  }
  async close() {
    this.closed = true
    this.state.enabled = false
    this.unsubscribe()
    this.changed()
  }
}
