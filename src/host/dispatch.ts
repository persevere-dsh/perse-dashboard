/** Event-driven, bounded concurrent intake/execution over official DSH Session commands. */
import { randomUUID } from 'node:crypto'
import type {
  DispatchSlot,
  DispatchState,
  DispatchRequest,
  Task,
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
/**
 * A Host-wide analysis gate. Analysis is globally serial even across manual
 * Analyze actions and the dispatcher, but it never occupies an execution lane.
 */
export class AnalysisGate {
  private active: string | null = null
  acquire(taskId: string): boolean {
    if (this.active) return false
    this.active = taskId
    return true
  }
  release(taskId: string) {
    if (this.active === taskId) this.active = null
  }
  busy(): boolean {
    return this.active !== null
  }
  current(): string | null {
    return this.active
  }
}
const taskLocalCodes = new Set([
  'queue-empty',
  'dependency-wait',
  'dependency-blocked',
  'dependency-cycle',
  'dependency-unknown',
  'dependency-workspace',
  'dependency-invalid',
  'resource-busy',
  'resource-order',
  'resource-key-invalid',
  'criteria-required',
  'analysis-required',
  'phase-role',
  'invalid-transition',
  'invalid-assignee',
  'conflict',
  'busy',
])
const isTaskLocal = (error: unknown) =>
  error instanceof BoardError && taskLocalCodes.has(error.code)
export class Dispatcher {
  private state: DispatchState = {
    enabled: false,
    workspaceId: null,
    activeTaskId: null,
    activeSessionId: null,
    active: [],
    lanes: 2,
    error: null,
    errorTaskId: null,
    watch: false,
    processed: 0,
    maxTasks: 10,
  }
  private scheduling = false
  private again = false
  private closed = false
  private seen = new Set<string>()
  private slots = new Map<string, DispatchSlot>()
  private inflight = new Set<string>()
  private finishing = new Set<string>()
  private unsubscribe: () => void
  readonly analysis = new AnalysisGate()
  constructor(
    private board: BoardController,
    private runtime: DispatchRuntime,
    private changed: () => void,
    private finish: (id: string) => Promise<unknown> = async () => {},
    options: { analysisGate?: AnalysisGate } = {},
  ) {
    if (options.analysisGate) this.analysis = options.analysisGate
    this.unsubscribe = board.subscribe(() => this.wake())
  }
  snapshot(): DispatchState {
    const lanes = this.state.workspaceId
      ? this.board.lanes(this.state.workspaceId)
      : this.state.lanes
    return {
      ...this.state,
      lanes,
      active: this.state.active.map((slot) => ({ ...slot })),
    }
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
    if (
      (this.scheduling ||
        this.state.active.length ||
        this.finishing.size) &&
      this.state.workspaceId !== workspaceId
    )
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
      lanes: this.board.lanes(workspaceId),
      error: null,
      errorTaskId: null,
    }
    this.changed()
    this.wake()
    return this.snapshot()
  }
  /** Native agent/status notifications and board changes wake admission. */
  wake() {
    if (
      this.closed ||
      !this.state.enabled ||
      !this.state.workspaceId ||
      this.state.error
    )
      return
    if (this.scheduling) {
      this.again = true
      return
    }
    this.scheduling = true
    void this.pump(this.state.workspaceId)
  }
  private async pump(workspaceId: string) {
    try {
      do {
        this.again = false
        await this.step(workspaceId)
      } while (this.again && this.enabled() && !this.closed)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Dispatch failed'
      this.state.error ??= message
      this.state.errorTaskId = this.state.activeTaskId
      this.state.enabled = false
    } finally {
      this.scheduling = false
      if (this.closed) return
      if (this.again && this.state.enabled && !this.state.error) this.wake()
      else this.settle()
    }
  }
  private enabled() {
    return this.state.enabled && !this.closed && !this.state.error
  }
  private available(task: Task) {
    return (
      this.seen.has(task.id) || this.seen.size < this.state.maxTasks
    )
  }
  private runningAssignees(task: Task) {
    return (
      (!!task.assignee && this.runtime.running(task.assignee)) ||
      (!!task.sessionId && this.runtime.running(task.sessionId))
    )
  }
  /**
   * Durable in-progress work that our process does not own (a stale claim after
   * restart or an externally claimed task) is never replayed, but it keeps its
   * lane and resource keys until the owner recovers it.
   */
  private durableOccupied(workspaceId: string) {
    return this.board
      .snapshot()
      .tasks.filter(
        (task) =>
          task.workspaceId === workspaceId &&
          !task.archived &&
          task.status === 'in-progress' &&
          !this.slots.has(task.id),
      ).length
  }
  private executionCapacity(workspaceId: string) {
    return Math.max(0, this.board.lanes(workspaceId) - this.durableOccupied(workspaceId))
  }
  private pending(workspaceId: string) {
    // A Session create/claim/bind is in flight before its slot becomes visible.
    // Treat it as pending so an intermediate empty candidate list cannot stop
    // auto dispatch in the same tick.
    if (this.inflight.size || this.finishing.size) return true
    return (
      this.board
        .analysisEligible(workspaceId)
        .some((task) => this.available(task)) ||
      (this.executionCapacity(workspaceId) > 0 &&
        this.board
          .eligible(workspaceId)
          .some(
            (task) =>
              this.available(task) &&
              !this.inflight.has(task.id) &&
              !this.runningAssignees(task),
          ))
    )
  }
  private settle() {
    if (this.closed) return
    if (this.state.active.length || this.finishing.size) return
    const workspaceId = this.state.workspaceId
    const pending = workspaceId ? this.pending(workspaceId) : false
    if (this.state.error) {
      if (this.state.enabled) {
        this.state.enabled = false
        this.changed()
      }
      return
    }
    if (pending) return
    if (
      !this.state.watch ||
      this.seen.size >= this.state.maxTasks
    ) {
      if (this.state.enabled) {
        this.state.enabled = false
        this.changed()
      }
    }
  }
  /**
   * Admission is serialized; phases themselves run concurrently. Analysis takes
   * the global gate, then execution starts until the persisted lane count is full.
   */
  private async step(workspaceId: string) {
    if (!this.enabled() || this.closed) return
    if (!this.analysis.busy()) {
      const analysis = this.board
        .analysisEligible(workspaceId)
        .find((task) => this.available(task) && !this.inflight.has(task.id))
      if (analysis && this.analysis.acquire(analysis.id)) {
        this.inflight.add(analysis.id)
        // Reserve the shared activation budget before launching. Analysis is
        // detached, so otherwise an execution lane could spend the last slot
        // before the analysis slot becomes visible.
        this.seen.add(analysis.id)
        void this.runAnalysis(workspaceId, analysis)
      }
    }
    const capacity = this.executionCapacity(workspaceId)
    const attempted = new Set<string>()
    while (
      this.enabled() &&
      !this.closed &&
      this.state.active.filter((slot) => slot.phase === 'execution').length <
        capacity
    ) {
      const candidate = this.board
        .eligible(workspaceId)
        .find(
          (task) =>
            !attempted.has(task.id) &&
            !this.inflight.has(task.id) &&
            this.available(task) &&
            !this.runningAssignees(task),
        )
      if (!candidate) break
      attempted.add(candidate.id)
      const started = await this.startExecution(workspaceId, candidate)
      if (!started) continue
    }
  }
  private addSlot(slot: DispatchSlot) {
    this.slots.set(slot.taskId, slot)
    this.syncSlots()
    this.changed()
  }
  private removeSlot(taskId: string) {
    this.slots.delete(taskId)
    this.inflight.delete(taskId)
    this.syncSlots()
    this.changed()
  }
  private syncSlots() {
    const active = [...this.slots.values()]
    const first =
      active.find((slot) => slot.phase === 'execution') ?? active[0]
    this.state = {
      ...this.state,
      active,
      activeTaskId: first?.taskId ?? null,
      activeSessionId: first?.sessionId ?? null,
    }
  }
  /** Create/reuse the Session, claim atomically and launch one execution lane. */
  private async startExecution(workspaceId: string, task: Task): Promise<boolean> {
    let sessionId: string
    try {
      sessionId = task.assignee ?? (await this.runtime.create(workspaceId))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.state.error ??= `Failed to create a Session: ${message}`
      this.state.errorTaskId = task.id
      this.state.enabled = false
      this.changed()
      return false
    }
    if (!this.enabled() || this.closed) return false
    let claimed: Task
    try {
      claimed = await this.board.claim(sessionId, {
        requestId: randomUUID(),
        taskId: task.id,
      })
    } catch (error) {
      // Dependency/resource admission can change between listing and claiming.
      // It is task-local: the next wake or lane keeps other work moving.
      if (isTaskLocal(error)) {
        if (
          error instanceof BoardError &&
          (error.code === 'dependency-wait' ||
            error.code === 'dependency-blocked' ||
            error.code === 'resource-busy' ||
            error.code === 'resource-order')
        ) {
          // No durable change is needed; the card already explains the wait.
        }
        return false
      }
      const message = error instanceof Error ? error.message : String(error)
      this.state.error ??= message
      this.state.errorTaskId = task.id
      this.state.enabled = false
      this.changed()
      return false
    }
    if (!this.enabled() || this.closed) {
      try {
        await this.board.update({
          requestId: randomUUID(),
          id: claimed.id,
          expectedVersion: claimed.version,
          action: 'move',
          status: 'todo',
        })
      } catch {}
      return false
    }
    this.inflight.add(claimed.id)
    if (!this.seen.has(claimed.id)) {
      this.seen.add(claimed.id)
      this.state.processed = this.seen.size
    }
    this.addSlot({
      taskId: claimed.id,
      sessionId,
      phase: 'execution',
    })
    void this.runExecution(claimed, sessionId)
    return true
  }
  private async blockActive(
    taskId: string,
    sessionId: string,
    evidence: string,
  ) {
    const current = this.board.snapshot().tasks.find((t) => t.id === taskId)
    if (
      current &&
      current.status === 'in-progress' &&
      current.sessionId === sessionId
    ) {
      try {
        return await this.board.update({
          requestId: randomUUID(),
          id: current.id,
          expectedVersion: current.version,
          action: 'move',
          status: 'blocked',
          evidence,
        })
      } catch {}
    }
    return undefined
  }
  private async runExecution(task: Task, sessionId: string) {
    let completed: Task | undefined
    try {
      const claimed = this.board
        .snapshot()
        .tasks.find((t) => t.id === task.id)
      if (!claimed) return
      const refusal = claimed.inputImages.length
        ? imageRouteRefusal(
            claimed,
            await this.runtime.imageRoute(sessionId),
          )
        : null
      if (refusal) {
        await this.blockActive(claimed.id, sessionId, refusal)
        return
      }
      try {
        await runPhase(
          this.board,
          this.runtime,
          claimed,
          sessionId,
          'execution',
          taskPrompt(claimed),
          () => this.closed,
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (
          claimed.inputImages.length &&
          /image input|does not support image|image-capable/i.test(message)
        ) {
          await this.blockActive(
            claimed.id,
            sessionId,
            `Image input is unsupported by the selected model route: ${message} Images were not silently dropped. Select an image-capable model and retry the task.`,
          )
          return
        }
        await this.blockActive(
          claimed.id,
          sessionId,
          `Dispatch failed: ${message}. Inspect the linked DSH Session before requeueing.`,
        )
        this.state.error ??= message
        this.state.errorTaskId = claimed.id
        this.state.enabled = false
        return
      }
      if (this.closed) return
      const current = this.board
        .snapshot()
        .tasks.find((t) => t.id === task.id)
      if (
        current?.status === 'in-progress' &&
        current.sessionId === sessionId
      ) {
        const blocked = await this.board.update({
          requestId: randomUUID(),
          id: current.id,
          expectedVersion: current.version,
          action: 'move',
          status: 'blocked',
          evidence:
            'Agent stopped without the required phase report. Inspect its native DSH Session before retrying.',
        })
        await this.board.note(
          current.id,
          blocked.version,
          'phase-report-missing',
        )
        return
      }
      if (current?.status === 'in-review') completed = current
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Lane failed'
      this.state.error ??= message
      this.state.errorTaskId = task.id
      this.state.enabled = false
    } finally {
      this.removeSlot(task.id)
      if (completed) {
        this.finishing.add(completed.id)
        void this.finish(completed.id)
          .catch((error) => {
            this.state.error ??=
              error instanceof Error ? error.message : String(error)
            this.state.errorTaskId = completed!.id
            this.state.enabled = false
          })
          .finally(() => {
            this.finishing.delete(completed!.id)
            this.changed()
            this.wake()
          })
      }
      this.wake()
    }
  }
  /** One globally serial analysis phase; execution lanes stay available. */
  private async runAnalysis(workspaceId: string, task: Task) {
    let holder = task.id
    let marked = false
    try {
      const sessionId = await this.runtime.create(workspaceId)
      if (!this.enabled() || this.closed) return
      const claimed = await this.board.beginAnalysis(
        sessionId,
        task.id,
        task.version,
      )
      if (!this.enabled() || this.closed) {
        try {
          await this.board.update({
            requestId: randomUUID(),
            id: claimed.id,
            expectedVersion: claimed.version,
            action: 'move',
            status: 'triage',
          })
        } catch {}
        return
      }
      this.seen.add(claimed.id)
      this.state.processed = this.seen.size
      marked = true
      this.addSlot({
        taskId: claimed.id,
        sessionId,
        phase: 'analysis',
      })
      const refusal = claimed.inputImages.length
        ? imageRouteRefusal(
            claimed,
            await this.runtime.imageRoute(sessionId),
          )
        : null
      if (refusal) {
        const current = this.board
          .snapshot()
          .tasks.find((t) => t.id === claimed.id)
        if (
          current?.status === 'triage' &&
          current.analysisSessionId === sessionId
        )
          await this.board.update({
            requestId: randomUUID(),
            id: current.id,
            expectedVersion: current.version,
            action: 'move',
            status: 'blocked',
            evidence: refusal,
          })
        return
      }
      try {
        await runPhase(
          this.board,
          this.runtime,
          claimed,
          sessionId,
          'analysis',
          analysisPrompt(claimed),
          () => this.closed,
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (
          claimed.inputImages.length &&
          /image input|does not support image|image-capable/i.test(message)
        ) {
          const current = this.board
            .snapshot()
            .tasks.find((t) => t.id === claimed.id)
          if (
            current?.status === 'triage' &&
            current.analysisSessionId === sessionId
          )
            await this.board.update({
              requestId: randomUUID(),
              id: current.id,
              expectedVersion: current.version,
              action: 'move',
              status: 'blocked',
              evidence: `Image input is unsupported by the selected model route: ${message} Images were not silently dropped. Select an image-capable model and retry the task.`,
            })
          return
        }
        const current = this.board
          .snapshot()
          .tasks.find((t) => t.id === claimed.id)
        if (
          current?.status === 'triage' &&
          current.analysisSessionId === sessionId
        )
          await this.board.update({
            requestId: randomUUID(),
            id: current.id,
            expectedVersion: current.version,
            action: 'move',
            status: 'blocked',
            evidence: `Analysis dispatch failed: ${message}. Inspect the linked DSH Session before retrying.`,
          })
        this.state.error ??= message
        this.state.errorTaskId = claimed.id
        this.state.enabled = false
        return
      }
      if (this.closed) return
      const current = this.board
        .snapshot()
        .tasks.find((t) => t.id === task.id)
      if (
        current?.status === 'triage' &&
        current.analysisSessionId === sessionId
      ) {
        const blocked = await this.board.update({
          requestId: randomUUID(),
          id: current.id,
          expectedVersion: current.version,
          action: 'move',
          status: 'blocked',
          evidence:
            'Analysis Agent stopped without a structured report after one reminder',
        })
        await this.board.note(
          current.id,
          blocked.version,
          'phase-report-missing',
        )
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Analysis failed'
      this.state.error ??= message
      this.state.errorTaskId = task.id
      this.state.enabled = false
    } finally {
      this.removeSlot(holder)
      this.analysis.release(holder)
      // A failure before a durable analysis claim must not consume the budget.
      if (!marked) this.seen.delete(holder)
      this.wake()
    }
  }
  async close() {
    this.closed = true
    this.state.enabled = false
    this.unsubscribe()
    this.changed()
  }
}
