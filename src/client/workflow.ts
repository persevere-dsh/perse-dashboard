import type { Task } from '../contract/types.ts'
import type { Key } from './locales.ts'
export function completionBlocks(task: Task): Key[] {
  const blocks: Key[] = []
  if ((task.completionPolicy?.mode ?? 'manual') === 'manual')
    blocks.push('gateManual')
  if (task.needsManual) blocks.push('gateManualFlag')
  if (!task.analysis) blocks.push('gateAnalysis')
  else {
    if (task.analysis.route !== 'express') blocks.push('gateStaged')
    if (task.analysis.risk !== 'low') blocks.push('gateRisk')
  }
  if (!task.criteria.length) blocks.push('gateCriteria')
  if (!task.evidence.trim()) blocks.push('gateEvidence')
  if (
    task.completionPolicy?.mode === 'verified' &&
    (task.completionPolicy.checks.length !== task.criteria.length ||
      new Set(task.completionPolicy.checks.map((c) => c.criterion)).size !==
        task.criteria.length)
  )
    blocks.push('gateChecks')
  return blocks
}
export function nextStep(
  task: Task,
  running: boolean,
  queue: boolean,
  dependency: 'wait' | 'attention' | null = null,
): Key {
  if (task.archived) return 'nextArchived'
  if (dependency === 'attention') return 'nextDependencyAttention'
  if (dependency === 'wait') return 'nextDependencyWait'
  if (task.status === 'done') return 'nextDone'
  if (running) return 'nextRunning'
  if (task.status === 'needs-info') return 'nextClarify'
  if (task.status === 'blocked') return 'nextBlocked'
  if (
    task.status === 'in-progress' ||
    (task.status === 'triage' && task.analysisSessionId)
  )
    return 'nextInterrupted'
  if (task.status === 'triage') return queue ? 'nextQueued' : 'nextAnalyze'
  if (
    task.status === 'todo' &&
    (!task.criteria.length || (task.intake && !task.analysis))
  )
    return 'nextAnalyze'
  if (task.status === 'todo') return queue ? 'nextQueued' : 'nextStart'
  if (task.review && task.review.verdict !== 'pass') return 'nextReviewFailed'
  if (completionBlocks(task).length) return 'nextHuman'
  return 'nextVerify'
}
export function taskNeedsAction(task: Task, running: boolean, queue: boolean) {
  return (
    !task.archived &&
    !['nextDone', 'nextRunning', 'nextQueued', 'nextDependencyWait'].includes(
      nextStep(task, running, queue),
    )
  )
}
