/** Pure domain and serialized durable mutations; no DSH or browser imports. */
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import type {
  Board,
  Task,
  CreateRequest,
  UpdateRequest,
  AgentRequest,
} from '../contract/types.ts'
const status = z.enum(['todo', 'in-progress', 'blocked', 'in-review', 'done'])
export const taskSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  title: z.string(),
  description: z.string(),
  criteria: z.array(z.string()),
  checked: z.array(z.boolean()),
  evidence: z.string(),
  priority: z.number().int().min(0).max(2),
  assignee: z.string().nullable(),
  sessionId: z.string().nullable(),
  status,
  version: z.number().int().positive(),
  archived: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
})
export const boardSchema = z.object({
  revision: z.number().int().nonnegative(),
  tasks: z.array(taskSchema),
  ledger: z.array(
    z.object({
      seq: z.number(),
      taskId: z.string(),
      action: z.string(),
      actor: z.string(),
      time: z.number(),
    }),
  ),
  receipts: z.array(
    z.object({
      requestId: z.string(),
      fingerprint: z.string(),
      task: taskSchema,
    }),
  ),
})
export const initialBoard = (): Board => ({
  revision: 0,
  tasks: [],
  ledger: [],
  receipts: [],
})
const requestId = z.string().min(1).max(150)
const text = z.string().trim().min(1).max(300)
export const createSchema = z.strictObject({
  requestId,
  workspaceId: z.string().min(1),
  title: text,
  description: z.string().max(12000),
  criteria: z.array(text).min(1).max(20),
  priority: z.number().int().min(0).max(2),
  assignee: z.string().nullable(),
})
export const updateSchema = z.strictObject({
  requestId,
  id: z.string(),
  expectedVersion: z.number().int().positive(),
  action: z.enum(['edit', 'assign', 'move', 'archive', 'restore', 'accept']),
  title: text.optional(),
  description: z.string().max(12000).optional(),
  priority: z.number().int().min(0).max(2).optional(),
  assignee: z.string().nullable().optional(),
  status: status.optional(),
  checked: z.array(z.boolean()).optional(),
  evidence: z.string().max(20000).optional(),
})
export class BoardError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}
export interface BoardPersistence {
  get(): Board
  set(board: Board): Promise<void>
}
export interface WorkspaceRecord {
  id: string
  path: string
  sessionIds: readonly string[]
}
export interface BoardEnvironment {
  workspaces(): WorkspaceRecord[]
  now(): number
  id(): string
}
export class BoardController {
  private tail: Promise<unknown> = Promise.resolve()
  private listeners = new Set<() => void>()
  constructor(
    private persistence: BoardPersistence,
    private env: BoardEnvironment,
  ) {
    boardSchema.parse(persistence.get())
  }
  snapshot(): Board {
    return structuredClone(this.persistence.get())
  }
  subscribe(fn: () => void) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  private write<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn)
    this.tail = result.catch(() => {})
    return result
  }
  private workspace(id: string) {
    const ws = this.env.workspaces().find((w) => w.id === id)
    if (!ws)
      throw new BoardError('workspace-missing', 'Workspace is unavailable')
    return ws
  }
  private sessionWorkspace(sessionId: string) {
    const ws = this.env
      .workspaces()
      .find((w) => w.sessionIds.includes(sessionId))
    if (!ws)
      throw new BoardError(
        'workspace-missing',
        'Session has no registered workspace',
      )
    return ws
  }
  private checkAssignee(ws: string, assignee: string | null) {
    if (assignee && !this.workspace(ws).sessionIds.includes(assignee))
      throw new BoardError(
        'invalid-assignee',
        'Session belongs to another workspace',
      )
  }
  private mutate(
    request: { requestId: string },
    actor: string,
    decide: (b: Board) => { task: Task; action: string },
  ): Promise<Task> {
    return this.write(async () => {
      const b = this.snapshot()
      const fingerprint = createHash('sha256')
        .update(JSON.stringify({ request, actor }))
        .digest('hex')
      const prior = b.receipts.find((r) => r.requestId === request.requestId)
      if (prior) {
        if (prior.fingerprint !== fingerprint)
          throw new BoardError(
            'request-reused',
            'Request identity was already used',
          )
        return structuredClone(prior.task)
      }
      const { task, action } = decide(b)
      const at = b.tasks.findIndex((t) => t.id === task.id)
      if (at < 0) b.tasks.push(task)
      else b.tasks[at] = task
      b.revision++
      b.ledger.push({
        seq: b.revision,
        taskId: task.id,
        action,
        actor,
        time: this.env.now(),
      })
      b.receipts.push({
        requestId: request.requestId,
        fingerprint,
        task: structuredClone(task),
      })
      boardSchema.parse(b)
      await this.persistence.set(b)
      for (const notify of this.listeners)
        try {
          notify()
        } catch {}
      return structuredClone(task)
    })
  }
  create(raw: CreateRequest) {
    const r = createSchema.parse(raw)
    return this.mutate(r, 'human', () => {
      this.workspace(r.workspaceId)
      this.checkAssignee(r.workspaceId, r.assignee)
      const now = this.env.now()
      return {
        action: 'create',
        task: {
          workspaceId: r.workspaceId,
          title: r.title,
          description: r.description,
          priority: r.priority,
          assignee: r.assignee,
          id: this.env.id(),
          criteria: [...r.criteria],
          checked: r.criteria.map(() => false),
          evidence: '',
          sessionId: null,
          status: 'todo',
          version: 1,
          archived: false,
          createdAt: now,
          updatedAt: now,
        },
      }
    })
  }
  update(raw: UpdateRequest) {
    const r = updateSchema.parse(raw)
    return this.mutate(r, 'human', (b) => {
      const old = b.tasks.find((t) => t.id === r.id)
      if (!old) throw new BoardError('not-found', 'Task no longer exists')
      if (old.version !== r.expectedVersion)
        throw new BoardError('conflict', 'Task changed; refresh before editing')
      if (
        old.status === 'done' &&
        !['archive', 'restore'].includes(r.action) &&
        !(r.action === 'move' && r.status === 'todo')
      )
        throw new BoardError(
          'accepted',
          'Reopen the accepted task before changing it',
        )
      if (old.archived && !['restore'].includes(r.action))
        throw new BoardError('archived', 'Restore the task before changing it')
      if (
        r.action === 'edit' &&
        old.status !== 'todo' &&
        (r.title !== undefined || r.description !== undefined)
      )
        throw new BoardError(
          'frozen',
          'Return the task to the queue before changing its scope',
        )
      const task = {
        ...old,
        version: old.version + 1,
        updatedAt: this.env.now(),
      }
      if (r.action === 'edit') {
        if (r.title !== undefined) task.title = r.title
        if (r.description !== undefined) task.description = r.description
        if (r.priority !== undefined) task.priority = r.priority
      }
      if (r.action === 'assign') {
        this.checkAssignee(task.workspaceId, r.assignee ?? null)
        if (task.status === 'in-progress')
          throw new BoardError(
            'busy',
            'Stop or return the task before reassignment',
          )
        task.assignee = r.assignee ?? null
      }
      if (r.action === 'archive' || r.action === 'restore') {
        if (task.status === 'in-progress')
          throw new BoardError('busy', 'Running tasks cannot be archived')
        task.archived = r.action === 'archive'
      }
      if (r.checked !== undefined) {
        if (r.checked.length !== task.criteria.length)
          throw new BoardError(
            'criteria-mismatch',
            'Acceptance criteria changed',
          )
        task.checked = [...r.checked]
      }
      if (r.evidence !== undefined) task.evidence = r.evidence.trim()
      if (r.action === 'accept') {
        if (
          task.status !== 'in-review' ||
          !task.evidence ||
          !task.checked.every(Boolean)
        )
          throw new BoardError(
            'not-accepted',
            'Evidence and all acceptance checks are required',
          )
        task.status = 'done'
      }
      if (r.action === 'move') {
        if (!r.status || r.status === 'done')
          throw new BoardError(
            'invalid-transition',
            'Use explicit acceptance to finish',
          )
        if (r.status === 'in-review' && !task.evidence)
          throw new BoardError('evidence-required', 'Review needs evidence')
        task.status = r.status
        if (r.status === 'todo') {
          task.sessionId = null
          task.checked = task.checked.map(() => false)
        }
      }
      return { task, action: r.action }
    })
  }
  claim(sessionId: string, raw: AgentRequest) {
    const r = z
      .strictObject({ requestId, taskId: z.string().optional() })
      .parse(raw)
    return this.mutate(r, sessionId, (b) => {
      const ws = this.sessionWorkspace(sessionId)
      const own = b.tasks.find(
        (t) =>
          !t.archived &&
          t.sessionId === sessionId &&
          t.status === 'in-progress',
      )
      if (own) {
        if (r.taskId && own.id !== r.taskId)
          throw new BoardError('busy', 'Session already owns an active task')
        return { task: own, action: 'claim-reaffirmed' }
      }
      const choices = b.tasks
        .filter(
          (t) =>
            !t.archived &&
            t.workspaceId === ws.id &&
            t.status === 'todo' &&
            (!t.assignee || t.assignee === sessionId) &&
            (!r.taskId || t.id === r.taskId),
        )
        .sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt)
      const task = choices[0]
      if (!task) throw new BoardError('queue-empty', 'No eligible task')
      return {
        action: 'claim',
        task: {
          ...task,
          sessionId,
          status: 'in-progress',
          version: task.version + 1,
          updatedAt: this.env.now(),
        },
      }
    })
  }
  report(sessionId: string, raw: AgentRequest) {
    const r = z
      .strictObject({
        requestId,
        taskId: z.string(),
        expectedVersion: z.number().int().positive(),
        evidence: z.string().trim().min(1).max(20000),
      })
      .parse(raw)
    return this.mutate(r, sessionId, (b) => {
      const task = b.tasks.find((t) => t.id === r.taskId)
      if (
        !task ||
        task.sessionId !== sessionId ||
        task.workspaceId !== this.sessionWorkspace(sessionId).id
      )
        throw new BoardError('not-owner', 'Task is not claimed by this Session')
      if (task.version !== r.expectedVersion)
        throw new BoardError('conflict', 'Task version changed')
      if (task.status !== 'in-progress')
        throw new BoardError(
          'invalid-transition',
          'Only a running task can report',
        )
      return {
        action: 'report',
        task: {
          ...task,
          evidence: r.evidence,
          status: 'in-review',
          version: task.version + 1,
          updatedAt: this.env.now(),
        },
      }
    })
  }
  eligible(workspaceId: string) {
    return this.snapshot()
      .tasks.filter(
        (t) =>
          t.workspaceId === workspaceId && !t.archived && t.status === 'todo',
      )
      .sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt)
  }
}
export const defaultEnvironment = { now: Date.now, id: randomUUID }
