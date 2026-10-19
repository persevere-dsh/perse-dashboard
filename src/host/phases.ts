/** Bounded report recovery over official DSH prompt/idle APIs. */
import type { Task } from '../contract/types.ts'
import type { BoardController } from './board.ts'
import type { DispatchRuntime } from './dispatch.ts'
export type Phase = 'analysis' | 'execution' | 'review'
export const phaseReported = (
  task: Task | undefined,
  phase: Phase,
  sessionId: string,
) => {
  if (!task) return true
  if (phase === 'analysis')
    return (
      task.analysisSessionId !== sessionId ||
      task.status !== 'triage' ||
      !!task.analysis
    )
  if (phase === 'execution')
    return task.sessionId !== sessionId || task.status !== 'in-progress'
  return (
    task.reviewSessionId !== sessionId ||
    task.status !== 'in-review' ||
    !!task.review
  )
}
export async function runPhase(
  board: BoardController,
  runtime: DispatchRuntime,
  task: Task,
  sessionId: string,
  phase: Phase,
  prompt: string,
  closed: () => boolean = () => false,
) {
  await runtime.prompt(sessionId, prompt, crypto.randomUUID())
  await runtime.idle(sessionId)
  if (closed()) return
  const current = () => board.snapshot().tasks.find((t) => t.id === task.id)
  if (phaseReported(current(), phase, sessionId)) return
  // One repair turn only. Never infer success from a reasoning-only stop.
  await runtime.prompt(
    sessionId,
    `${prompt}\nREPORT_REMINDER: The previous turn ended without its required structured phase report. This is the only automatic reminder. Use the current task version ${current()!.version}. ${phase === 'execution' ? 'Do not repeat implementation, commands or side effects. Inspect existing results and submit dashboard_report; report blocked when verification is unavailable.' : phase === 'analysis' ? 'Complete the analysis and call dashboard_triage; missing requirements must use needs-info and concrete questions.' : 'Inspect the existing result and call dashboard_review; unavailable verification requires fail or needs-human.'}`,
    crypto.randomUUID(),
  )
  await runtime.idle(sessionId)
}
