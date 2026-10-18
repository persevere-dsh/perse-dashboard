/** Serialized automatic completion using native Sessions and owner-approved gates. */
import { BoardController } from './board.ts'
import type { DispatchRuntime } from './dispatch.ts'
import type { Task } from '../contract/types.ts'
import {
  canAutoComplete,
  coversAll,
  checkFiles,
  digest,
  RULE_VERSION,
} from './policy.ts'
import { reviewPrompt } from './prompts.ts'
export class CompletionCoordinator {
  private jobs = new Map<string, Promise<Task>>()
  private tail: Promise<unknown> = Promise.resolve()
  private closed = false
  constructor(
    private board: BoardController,
    private runtime: DispatchRuntime,
    private workspacePath: (id: string) => string,
  ) {}
  close() {
    this.closed = true
  }
  finish(id: string): Promise<Task> {
    const existing = this.jobs.get(id)
    if (existing) return existing
    const job = this.tail
      .then(() => this.run(id))
      .finally(() => this.jobs.delete(id))
    this.jobs.set(id, job)
    this.tail = job.catch(() => {})
    return job
  }
  private task(id: string) {
    const task = this.board.snapshot().tasks.find((t) => t.id === id)
    if (!task) throw Error('Task no longer exists')
    return task
  }
  private async run(id: string): Promise<Task> {
    let task = this.task(id)
    if (
      this.closed ||
      task.status !== 'in-review' ||
      task.archived ||
      task.completionPolicy.mode === 'manual'
    )
      return task
    try {
      if (task.sessionId) await this.runtime.idle(task.sessionId)
      if (this.closed) return this.task(id)
      task = this.task(id)
      if (task.status !== 'in-review' || task.archived) return task
      if (!canAutoComplete(task))
        return this.board.note(
          id,
          task.version,
          'Automatic completion held: only an express, low-risk issue without a manual flag is eligible. Human acceptance remains available.',
        )
      let promptHash = digest({
        rule: RULE_VERSION,
        policy: task.completionPolicy,
      })
      if (task.completionPolicy.mode === 'reviewed') {
        const sessionId = await this.runtime.create(task.workspaceId)
        if (this.closed) return this.task(id)
        task = await this.board.beginReview(sessionId, id, task.version)
        const prompt = reviewPrompt(task)
        promptHash = digest(prompt)
        await this.runtime.prompt(sessionId, prompt, crypto.randomUUID())
        await this.runtime.idle(sessionId)
        if (this.closed) return this.task(id)
        task = this.task(id)
        if (task.status !== 'in-review') return task
        if (
          task.review?.verdict !== 'pass' ||
          task.review.risk !== 'low' ||
          task.review.remainingRisks.length ||
          !coversAll(task, task.review.results)
        )
          return this.board.note(
            id,
            task.version,
            'Independent review did not pass every criterion without remaining risks. Inspect the review Session; human acceptance or a corrected execution is required.',
          )
      }
      const results = await checkFiles(
        task,
        this.workspacePath(task.workspaceId),
      )
      if (results.some((r) => !r.passed))
        return this.board.note(
          id,
          task.version,
          'Machine verification failed: ' +
            results
              .filter((r) => !r.passed)
              .map((r) => r.evidence)
              .join('; '),
        )
      if (this.closed) return this.task(id)
      if (
        (task.sessionId && this.runtime.running(task.sessionId)) ||
        (task.reviewSessionId && this.runtime.running(task.reviewSessionId))
      )
        return this.board.note(
          id,
          task.version,
          'A linked Agent resumed during verification. Completion remains pending.',
        )
      return await this.board.completeAutomatically(id, task.version, {
        kind:
          task.completionPolicy.mode === 'reviewed' ? 'reviewed' : 'verified',
        time: Date.now(),
        ruleVersion: RULE_VERSION,
        promptHash,
        evidenceHash: digest(task.evidence),
        reviewerSessionId: task.reviewSessionId,
        checks: results,
        results:
          task.completionPolicy.mode === 'reviewed'
            ? task.review!.results
            : results,
      })
    } catch (error) {
      task = this.task(id)
      if (task.status !== 'in-review' || this.closed) return task
      return this.board.note(
        id,
        task.version,
        'Automatic verification unavailable: ' +
          (error instanceof Error ? error.message : String(error)),
      )
    }
  }
}
