/**
 * Shared, pure coordination rules for Host admission, validation and the Client.
 * No Node, DSH or UI imports: one rule set must decide eligibility everywhere.
 */
import type { TaskStatus } from './types.ts'
export const MAX_RESOURCE_KEYS = 8
export const MAX_DEPENDENCIES = 20
export const LANES_DEFAULT = 2
export const LANES_MIN = 1
export const LANES_MAX = 4
export const STANDARD_RESOURCE_NAMESPACES = [
  'file',
  'port',
  'build',
  'db',
  'branch',
] as const
/** Why an owner declaration or analysis suggestion is refused, with stable code. */
export interface CoordinationProblem {
  code: string
  message: string
}
/** Minimal task facts needed by coordination; real Task records satisfy it. */
export interface CoordinationTask {
  id: string
  workspaceId: string
  title?: string
  status: TaskStatus
  archived: boolean
  dependencies: readonly string[]
  resourceKeys?: readonly string[]
  createdAt?: number
  sessionId?: string | null
  assignee?: string | null
  criteria?: readonly string[]
  intake?: boolean
  analysis?: { route: string } | null
  automationNote?: string
}
export interface ResourceHolder {
  key: string
  taskId: string
  title: string
  sessionId: string | null
}
export interface DependencyFact {
  taskId: string
  title: string
  status: TaskStatus
  archived: boolean
  sessionId: string | null
}
export function parseResourceKey(
  key: string,
): { namespace: string; value: string } | null {
  const match = /^([A-Za-z][A-Za-z0-9_-]*):(.+)$/s.exec(key)
  if (!match) return null
  return { namespace: match[1]!, value: match[2]! }
}
/** Stable resource-key validation shared by owner forms and Host admission. */
export function resourceKeyProblem(key: unknown): CoordinationProblem | null {
  if (typeof key !== 'string')
    return {
      code: 'resource-key-invalid',
      message: 'Resource keys must be strings in namespace:value form',
    }
  if (!key || key.length > 128)
    return {
      code: 'resource-key-invalid',
      message: 'Resource keys must be between 1 and 128 characters',
    }
  if (key.trim() !== key)
    return {
      code: 'resource-key-invalid',
      message: 'Resource keys cannot start or end with whitespace',
    }
  if (/[\u0000-\u001f\u007f]/.test(key))
    return {
      code: 'resource-key-invalid',
      message: 'Resource keys cannot contain control characters',
    }
  const parsed = parseResourceKey(key)
  if (!parsed || parsed.value.trim() !== parsed.value)
    return {
      code: 'resource-key-invalid',
      message:
        'Resource keys must use namespace:value, for example file:src/index.ts or port:3000',
    }
  return null
}
export function resourceKeysProblem(
  keys: readonly unknown[],
): CoordinationProblem | null {
  if (keys.length > MAX_RESOURCE_KEYS)
    return {
      code: 'resource-key-invalid',
      message: `A task can declare at most ${MAX_RESOURCE_KEYS} resource keys`,
    }
  const seen = new Set<string>()
  for (const key of keys) {
    const problem = resourceKeyProblem(key)
    if (problem) return problem
    if (seen.has(key as string))
      return {
        code: 'resource-key-invalid',
        message: `Resource key ${String(key)} is declared more than once`,
      }
    seen.add(key as string)
  }
  return null
}
export function lanesProblem(value: unknown): CoordinationProblem | null {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < LANES_MIN ||
    value > LANES_MAX
  )
    return {
      code: 'lanes-invalid',
      message: `Execution lanes must be an integer between ${LANES_MIN} and ${LANES_MAX}`,
    }
  return null
}
/** Read a persisted lane count, falling back to the default for legacy/bad data. */
export function resolveLanes(value: unknown): number {
  return lanesProblem(value) ? LANES_DEFAULT : (value as number)
}
function cycle(
  taskId: string,
  dependencies: readonly string[],
  tasks: readonly CoordinationTask[],
): boolean {
  const graph = new Map<string, readonly string[]>()
  for (const task of tasks) graph.set(task.id, task.dependencies)
  graph.set(taskId, dependencies)
  const state = new Map<string, 0 | 1 | 2>()
  const visit = (id: string): boolean => {
    const mark = state.get(id)
    if (mark === 1) return true
    if (mark === 2) return false
    state.set(id, 1)
    for (const next of graph.get(id) ?? []) if (visit(next)) return true
    state.set(id, 2)
    return false
  }
  return visit(taskId)
}
/**
 * Validate the dependency list a task would persist, or an analysis suggestion.
 * All dependencies are workspace-local and must already exist, be active and be
 * acyclic. Analysis suggestions are admitted by the same rules but never written.
 */
export function dependenciesProblem(
  taskId: string,
  dependencies: readonly unknown[],
  tasks: readonly CoordinationTask[],
  workspaceId: string,
): CoordinationProblem | null {
  if (dependencies.length > MAX_DEPENDENCIES)
    return {
      code: 'dependency-invalid',
      message: `A task can declare at most ${MAX_DEPENDENCIES} dependencies`,
    }
  const seen = new Set<string>()
  for (const raw of dependencies) {
    if (typeof raw !== 'string' || !raw)
      return {
        code: 'dependency-invalid',
        message: 'Dependencies must be nonempty task ids',
      }
    if (seen.has(raw))
      return {
        code: 'dependency-invalid',
        message: `Dependency ${raw} is declared more than once`,
      }
    seen.add(raw)
    if (raw === taskId)
      return {
        code: 'dependency-cycle',
        message: 'A task cannot depend on itself',
      }
    const dependency = tasks.find((task) => task.id === raw)
    if (!dependency)
      return {
        code: 'dependency-unknown',
        message: `Dependency ${raw} is not a known task`,
      }
    if (dependency.workspaceId !== workspaceId)
      return {
        code: 'dependency-workspace',
        message: `Dependency ${raw} belongs to another workspace; cross-workspace dependencies are not supported`,
      }
    if (dependency.archived)
      return {
        code: 'dependency-invalid',
        message: `Dependency ${raw} is archived`,
      }
  }
  if (cycle(taskId, dependencies as string[], tasks))
    return {
      code: 'dependency-cycle',
      message: 'Dependencies would create a cycle',
    }
  return null
}
/** Validate analysis coordination suggestions without persisting them on Task. */
export function coordinationProblem(
  taskId: string,
  workspaceId: string,
  coordination: {
    dependencies: readonly unknown[]
    resourceKeys?: readonly unknown[]
    dependencyOrder: readonly unknown[]
    resourceConflicts: readonly {
      key: unknown
      taskIds: readonly unknown[]
    }[]
  },
  tasks: readonly CoordinationTask[],
): CoordinationProblem | null {
  const dependencies = dependenciesProblem(
    taskId,
    coordination.dependencies,
    tasks,
    workspaceId,
  )
  if (dependencies) return dependencies
  const keys = resourceKeysProblem(coordination.resourceKeys ?? [])
  if (keys) return keys
  const order = new Set<string>()
  for (const raw of coordination.dependencyOrder) {
    if (typeof raw !== 'string' || !raw)
      return {
        code: 'coordination-invalid',
        message: 'dependencyOrder must contain task ids',
      }
    if (order.has(raw))
      return {
        code: 'coordination-invalid',
        message: `dependencyOrder contains ${raw} more than once`,
      }
    order.add(raw)
    const task = tasks.find((candidate) => candidate.id === raw)
    if (!task)
      return {
        code: 'coordination-unknown',
        message: `dependencyOrder references unknown task ${raw}`,
      }
    if (task.workspaceId !== workspaceId)
      return {
        code: 'coordination-workspace',
        message: `dependencyOrder references ${raw} in another workspace`,
      }
  }
  for (const conflict of coordination.resourceConflicts) {
    const keyProblem = resourceKeyProblem(conflict.key)
    if (keyProblem) return keyProblem
    for (const id of conflict.taskIds) {
      const task = tasks.find((candidate) => candidate.id === id)
      if (!task)
        return {
          code: 'coordination-unknown',
          message: `resourceConflicts references unknown task ${String(id)}`,
        }
      if (task.workspaceId !== workspaceId)
        return {
          code: 'coordination-workspace',
          message: `resourceConflicts references ${String(id)} in another workspace`,
        }
      if (task.id === taskId)
        return {
          code: 'coordination-invalid',
          message: 'resourceConflicts cannot reference the analyzed task itself',
        }
    }
  }
  return null
}
/** Would adding dependency `candidateId` to `taskId` create a cycle? */
export function createsCycle(
  taskId: string | null,
  candidateId: string,
  tasks: readonly CoordinationTask[],
): boolean {
  if (!taskId || taskId === candidateId) return !!taskId
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const seen = new Set<string>()
  const visit = (id: string): boolean => {
    if (id === taskId) return true
    if (seen.has(id)) return false
    seen.add(id)
    const task = byId.get(id)
    return !!task && task.dependencies.some(visit)
  }
  return visit(candidateId)
}
/** Owner-facing dependency candidates: same workspace, active, no self/cycle. */
export function dependencyCandidates(
  tasks: readonly CoordinationTask[],
  workspaceId: string,
  selfId: string | null,
): CoordinationTask[] {
  return tasks
    .filter(
      (task) =>
        task.workspaceId === workspaceId &&
        !task.archived &&
        // A completed dependency is already satisfied; offering it only adds
        // noise to the create/edit picker.
        task.status !== 'done' &&
        task.id !== selfId &&
        !createsCycle(selfId, task.id, tasks),
    )
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
}
export function dependenciesSatisfied(
  task: CoordinationTask,
  tasks: readonly CoordinationTask[],
): boolean {
  return (task.dependencies ?? []).every((id) => {
    const dependency = tasks.find((candidate) => candidate.id === id)
    return !!dependency && !dependency.archived && dependency.status === 'done'
  })
}
/** True when the task has passed intake and is ready for execution admission. */
export function executionReady(task: CoordinationTask): boolean {
  if (task.archived || task.status !== 'todo') return false
  if (!(task.criteria?.length ?? 0)) return false
  if (task.intake && !task.analysis) return false
  if (
    task.intake &&
    task.analysis &&
    !['express', 'staged'].includes(task.analysis.route)
  )
    return false
  return true
}
/** In-progress tasks holding one of this task's resource keys in its workspace. */
export function resourceHolders(
  task: CoordinationTask,
  tasks: readonly CoordinationTask[],
): ResourceHolder[] {
  const keys = task.resourceKeys ?? []
  if (!keys.length) return []
  const holders: ResourceHolder[] = []
  for (const candidate of tasks) {
    if (
      candidate.id === task.id ||
      candidate.archived ||
      candidate.workspaceId !== task.workspaceId ||
      candidate.status !== 'in-progress'
    )
      continue
    const shared = (candidate.resourceKeys ?? []).filter((key) =>
      keys.includes(key),
    )
    for (const key of shared)
      holders.push({
        key,
        taskId: candidate.id,
        title: candidate.title ?? candidate.id,
        sessionId: candidate.sessionId ?? null,
      })
  }
  return holders
}
/**
 * An earlier, still-runnable task with an overlapping key keeps its place even
 * when a later task has a higher priority. Earlier tasks that cannot run do not
 * block a later candidate; only in-progress tasks hold the key itself.
 */
export function blockedByEarlierSameKey(
  task: CoordinationTask,
  tasks: readonly CoordinationTask[],
  sessionId: string,
): boolean {
  const keys = task.resourceKeys ?? []
  if (!keys.length) return false
  return tasks.some(
    (candidate) =>
      candidate.id !== task.id &&
      candidate.workspaceId === task.workspaceId &&
      !candidate.archived &&
      executionReady(candidate) &&
      dependenciesSatisfied(candidate, tasks) &&
      !resourceHolders(candidate, tasks).length &&
      (candidate.createdAt ?? 0) < (task.createdAt ?? 0) &&
      (!candidate.assignee || candidate.assignee === sessionId) &&
      (candidate.resourceKeys ?? []).some((key) => keys.includes(key)),
  )
}
export function dependencyFacts(
  task: CoordinationTask,
  tasks: readonly CoordinationTask[],
): DependencyFact[] {
  return (task.dependencies ?? []).map((id) => {
    const dependency = tasks.find((candidate) => candidate.id === id)
    return {
      taskId: id,
      title: dependency?.title ?? id,
      status: dependency?.status ?? 'todo',
      archived: dependency?.archived ?? false,
      sessionId: dependency?.sessionId ?? null,
    }
  })
}
/**
 * First dependency in the transitive closure that invalidates the wait: blocked,
 * needs-info, archived or missing. In-progress successors keep running; callers
 * use this only to present attention.
 */
export function invalidDependency(
  task: CoordinationTask,
  tasks: readonly CoordinationTask[],
): DependencyFact | null {
  const seen = new Set<string>()
  const visit = (id: string): DependencyFact | null => {
    if (seen.has(id)) return null
    seen.add(id)
    const dependency = tasks.find((candidate) => candidate.id === id)
    if (!dependency)
      return {
        taskId: id,
        title: id,
        status: 'blocked',
        archived: false,
        sessionId: null,
      }
    if (
      dependency.archived ||
      dependency.status === 'blocked' ||
      dependency.status === 'needs-info'
    )
      return {
        taskId: dependency.id,
        title: dependency.title ?? dependency.id,
        status: dependency.status,
        archived: dependency.archived,
        sessionId: dependency.sessionId ?? null,
      }
    for (const next of dependency.dependencies) {
      const found = visit(next)
      if (found) return found
    }
    return null
  }
  for (const id of task.dependencies ?? []) {
    const found = visit(id)
    if (found) return found
  }
  return null
}
export interface InvalidatedSuccessor {
  taskId: string
  dependencyId: string
  dependencyStatus: string
}
/**
 * Descendants of an invalidated task that have not started. Traversal continues
 * through every descendant so A→B→C also blocks C; only todo/triage records are
 * persisted as blocked. The returned order is deterministic by task creation.
 */
export function invalidatedSuccessors(
  rootId: string,
  dependencyStatus: string,
  tasks: readonly CoordinationTask[],
): InvalidatedSuccessor[] {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const dependents = new Map<string, string[]>()
  for (const task of tasks)
    for (const dependency of task.dependencies ?? []) {
      const list = dependents.get(dependency) ?? []
      list.push(task.id)
      dependents.set(dependency, list)
    }
  const found = new Map<string, InvalidatedSuccessor>()
  const queue = [rootId]
  const visited = new Set([rootId])
  while (queue.length) {
    const current = queue.shift()!
    for (const id of dependents.get(current) ?? []) {
      if (visited.has(id)) continue
      visited.add(id)
      const task = byId.get(id)
      if (
        task &&
        !task.archived &&
        (['todo', 'triage'].includes(task.status) ||
          (task.status === 'blocked' &&
            task.automationNote?.startsWith('dependency-invalidated:'))) &&
        !found.has(id)
      )
        found.set(id, {
          taskId: id,
          dependencyId: rootId,
          dependencyStatus,
        })
      queue.push(id)
    }
  }
  return [...found.values()].sort((a, b) => {
    const left = byId.get(a.taskId)?.createdAt ?? 0,
      right = byId.get(b.taskId)?.createdAt ?? 0
    return left - right || a.taskId.localeCompare(b.taskId)
  })
}
/** Stable machine note for a dependency-invalidated task. */
export function dependencyNote(taskId: string, status: string): string {
  return `dependency-invalidated:${taskId}:${status}`
}
export function parseDependencyNote(
  note: string,
): { taskId: string; status: string } | null {
  const match = /^dependency-invalidated:([^:]+):([a-z-]+)$/.exec(note)
  return match ? { taskId: match[1]!, status: match[2]! } : null
}
