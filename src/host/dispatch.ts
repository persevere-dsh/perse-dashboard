/** A bounded queue consumer over official DSH Session commands. */
import { randomUUID } from 'node:crypto'
import type { Task, DispatchState } from '../contract/types.ts'
import { BoardController, BoardError } from './board.ts'
export interface DispatchRuntime {
  create(workspaceId: string): Promise<string>
  prompt(sessionId: string, prompt: string, requestId: string): Promise<void>
  idle(sessionId: string): Promise<void>
  running(sessionId: string): boolean
}
export class Dispatcher {
  private state: DispatchState = {
    enabled: false,
    workspaceId: null,
    activeTaskId: null,
    activeSessionId: null,
    error: null,
  }
  private work: Promise<void> | undefined
  private closed = false
  constructor(
    private board: BoardController,
    private runtime: DispatchRuntime,
    private changed: () => void,
  ) {}
  snapshot() {
    return { ...this.state }
  }
  configure(workspaceId: string, enabled: boolean) {
    if (this.closed) throw new BoardError('closed', 'Dispatcher is closed')
    if (this.work && this.state.workspaceId !== workspaceId)
      throw new BoardError('busy', 'Stop the active workspace before switching')
    this.state = { ...this.state, workspaceId, enabled, error: null }
    this.changed()
    if (enabled && !this.work) {
      this.work = this.drain(workspaceId).finally(() => {
        this.work = undefined
        this.state.enabled = false
        this.changed()
      })
    }
    return this.snapshot()
  }
  private async drain(workspaceId: string) {
    try {
      for (let n = 0; n < 10 && this.state.enabled && !this.closed; n++) {
        const task = this.board
          .eligible(workspaceId)
          .find((t) => !t.assignee || !this.runtime.running(t.assignee))
        if (!task) break
        const sessionId =
          task.assignee ?? (await this.runtime.create(workspaceId))
        if (!this.state.enabled || this.closed) break
        const claimed = await this.board.claim(sessionId, {
          requestId: randomUUID(),
          taskId: task.id,
        })
        if (!this.state.enabled || this.closed) {
          await this.board.update({
            requestId: randomUUID(),
            id: claimed.id,
            expectedVersion: claimed.version,
            action: 'move',
            status: 'todo',
          })
          break
        }
        this.state = {
          ...this.state,
          activeTaskId: task.id,
          activeSessionId: sessionId,
        }
        this.changed()
        await this.runtime.prompt(sessionId, taskPrompt(claimed), randomUUID())
        await this.runtime.idle(sessionId)
        const current = this.board
          .snapshot()
          .tasks.find((t) => t.id === task.id)
        if (current?.status === 'in-progress') {
          await this.board.update({
            requestId: randomUUID(),
            id: task.id,
            expectedVersion: current.version,
            action: 'move',
            status: 'blocked',
            evidence:
              'Agent stopped without an evidence report. Inspect the linked DSH Session before requeueing.',
          })
          throw new BoardError(
            'report-missing',
            'Agent stopped without reporting evidence; dispatch paused',
          )
        }
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
      if (active?.status === 'in-progress') {
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
      this.state.error ??= message
    } finally {
      this.state = {
        ...this.state,
        enabled: false,
        activeTaskId: null,
        activeSessionId: null,
      }
      this.changed()
    }
  }
  async close() {
    this.closed = true
    this.state.enabled = false
    this.changed() /* DSH owns active Agent lifetime. Do not dispose a conversation on plugin unload. */
  }
}
export function taskPrompt(task: Task) {
  return `Work on dashboard task ${task.id}, version ${task.version}.\nTitle: ${task.title}\n${task.description}\nAcceptance criteria:\n${task.criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}\nThis task is already claimed by your current DSH Session. Implement and verify the task in its workspace. Use dashboard_report with taskId=${task.id}, expectedVersion=${task.version} and concrete evidence when finished. Reporting only submits for human review; never claim user acceptance. If blocked, report the limitation clearly in the conversation.`
}
