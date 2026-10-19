/** Presentation only: pending interaction never changes native running or task lifecycle. */
import type { SessionStatus } from '@deepseek-ai/dsh-client-ui-session/client'
import type { Task } from '../contract/types.ts'
export type AttentionKey =
  | 'waitingApproval'
  | 'waitingPlan'
  | 'waitingAnswer'
  | 'waitingInteraction'
export function attentionKey(
  status: Pick<SessionStatus, 'pendingInteraction'> | undefined,
): AttentionKey | undefined {
  const pending = status?.pendingInteraction
  if (!pending) return undefined
  switch (pending.kind) {
    case 'approval':
      return 'waitingApproval'
    case 'plan-review':
      return 'waitingPlan'
    case 'question':
      return 'waitingAnswer'
    default:
      return 'waitingInteraction'
  }
}
/** Only current lifecycle phases; completed/historical links are not active task work. */
export function activeTaskSessions(task: Task): string[] {
  const ids = task.archived
    ? []
    : task.status === 'triage'
      ? [task.analysisSessionId]
      : task.status === 'in-progress'
        ? [task.sessionId]
        : task.status === 'in-review'
          ? [task.sessionId, task.reviewSessionId]
          : []
  return [...new Set(ids.filter((id): id is string => !!id))]
}
