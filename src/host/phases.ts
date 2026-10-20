/** Bounded report recovery over official DSH prompt/idle APIs. */
import type { Task } from '../contract/types.ts'
import type { BoardController } from './board.ts'
import type { DispatchRuntime } from './dispatch.ts'
import { phaseContent, reportReminder } from './prompts.ts'
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
/** Stable task-local refusal when the selected route cannot receive image input. */
export function imageRouteRefusal(
  task: Task,
  route: { provider: string; model: string; images: boolean | null } | null,
): string | null {
  if (!task.inputImages.length || route?.images === true) return null
  const selected = route
    ? `${route.provider}/${route.model}`
    : 'the selected model route'
  return `Image input is unsupported by ${selected}: this task has ${task.inputImages.length} input image(s) but the route does not declare image input. Images were not silently dropped. Select an image-capable model and retry the task.`
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
  const content = await phaseContent(runtime, task, prompt)
  await runtime.prompt(sessionId, content, crypto.randomUUID())
  await runtime.idle(sessionId)
  if (closed()) return
  const current = () => board.snapshot().tasks.find((t) => t.id === task.id)
  if (phaseReported(current(), phase, sessionId)) return
  // One repair turn only, text-only so image parts are never duplicated.
  const reminder = `${prompt}\n${reportReminder(task, phase, current()!.version)}`
  await runtime.prompt(sessionId, [{ type: 'text', text: reminder }], crypto.randomUUID())
  await runtime.idle(sessionId)
}
