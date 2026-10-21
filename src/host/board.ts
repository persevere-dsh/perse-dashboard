/** Pure domain and serialized durable mutations; no DSH or browser imports. */
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import type {
  Board,
  Task,
  CreateCommand,
  UpdateCommand,
  AgentRequest,
  AnalysisReport,
  ReviewReport,
  CompletionReceipt,
  ImageInputLimits,
  InputImage,
  LaneRequest,
  BoardWorkspaceSettings,
  RepairPolicyRequest,
  TaskCommand,
} from '../contract/types.ts'
import { reviewPrompt } from './prompts.ts'
import { detectTaskLanguage } from '../contract/language.ts'
import {
  blockedByEarlierSameKey,
  coordinationProblem,
  dependenciesProblem,
  dependenciesSatisfied,
  dependencyNote,
  executionReady,
  invalidatedSuccessors,
  resourceHolders,
  resourceKeysProblem,
  resolveLanes,
} from '../contract/coordination.ts'
import {
  DEFAULT_IMAGE_LIMITS,
  InputImageError,
  validateInputImages,
} from './images.ts'
import {
  manualPolicy,
  completionPolicySchema,
  analysisSchema,
  storedAnalysisSchema,
  reviewSchema,
  receiptSchema,
  canAutoComplete,
  completionPolicyProblem,
  coversAll,
  RULE_VERSION,
  digest,
} from './policy.ts'
export const imageSchema = z.object({
  path: z.string().min(1).max(1000),
  caption: z.string().max(500),
  criterion: z.number().int().nonnegative().optional(),
})
export const inputImageSchema = z.strictObject({
  attachmentId: z.string().min(1).max(200),
  mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  bytes: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  name: z.string().min(1).max(200),
  source: z.enum(['description', 'criteria']),
})
const inputImagesSchema = z.array(inputImageSchema).max(4).optional()
const ownerAnswerSchema = z.strictObject({
  question: z.string().trim().min(1).max(1000),
  answer: z.string().trim().min(1).max(12000),
})
const ownerAnswersSchema = z.array(ownerAnswerSchema).max(20)
const status = z.enum([
  'triage',
  'needs-info',
  'todo',
  'in-progress',
  'blocked',
  'in-review',
  'done',
])
export const taskSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  title: z.string(),
  description: z.string(),
  criteria: z.array(z.string()),
  checked: z.array(z.boolean()),
  evidence: z.string(),
  images: z.array(imageSchema).max(12).default([]),
  inputImages: z.array(inputImageSchema).max(4).default([]),
  language: z.enum(['zh', 'en']).nullable().default(null),
  dependencies: z.array(z.string()).default([]),
  resourceKeys: z.array(z.string()).default([]),
  priority: z.number().int().min(0).max(2),
  assignee: z.string().nullable(),
  sessionId: z.string().nullable(),
  status,
  version: z.number().int().positive(),
  archived: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
  intake: z.boolean().default(false),
  needsManual: z.boolean().default(false),
  analysisSessionId: z.string().nullable().default(null),
  analysis: storedAnalysisSchema.nullable().default(null),
  answers: ownerAnswersSchema.default([]),
  reviewSessionId: z.string().nullable().default(null),
  reviewPromptHash: z.string().nullable().default(null),
  review: reviewSchema.nullable().default(null),
  completionPolicy: completionPolicySchema.default(manualPolicy),
  completion: receiptSchema.nullable().default(null),
  automationNote: z.string().default(''),
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
  // Additive persisted settings. Legacy boards parse with the default and are
  // not rewritten on read; the next mutation persists the parsed shape.
  settings: z
    .object({
      workspaces: z
        .record(
          z.string(),
          z.object({
            lanes: z.number().int().min(1).max(4).default(2),
          }),
        )
        .default({}),
    })
    .default({ workspaces: {} }),
  settingsReceipts: z
    .array(
      z.object({
        requestId: z.string(),
        fingerprint: z.string(),
        workspaceId: z.string(),
        lanes: z.number().int().min(1).max(4),
      }),
    )
    .default([]),
})
export const initialBoard = (): Board => ({
  revision: 0,
  tasks: [],
  ledger: [],
  receipts: [],
  settings: { workspaces: {} },
  settingsReceipts: [],
})
const requestId = z.string().min(1).max(150)
const text = z.string().trim().min(1).max(300)
export const createSchema = z.strictObject({
  requestId,
  workspaceId: z.string().min(1),
  title: text,
  description: z.string().max(12000),
  criteria: z.array(text).max(20),
  priority: z.number().int().min(0).max(2),
  assignee: z.string().nullable(),
  intake: z.boolean().optional(),
  needsManual: z.boolean().optional(),
  completionPolicy: completionPolicySchema.optional(),
  inputImages: inputImagesSchema,
  language: z.enum(['zh', 'en']).optional(),
  dependencies: z.array(z.string().min(1).max(150)).max(20).optional(),
  resourceKeys: z.array(z.string().max(128)).max(8).optional(),
})
export const updateSchema = z.strictObject({
  requestId,
  id: z.string(),
  expectedVersion: z.number().int().positive(),
  action: z.enum([
    'edit',
    'assign',
    'move',
    'archive',
    'restore',
    'accept',
    'retry',
  ]),
  criteria: z.array(text).max(20).optional(),
  title: text.optional(),
  description: z.string().max(12000).optional(),
  priority: z.number().int().min(0).max(2).optional(),
  assignee: z.string().nullable().optional(),
  status: status.optional(),
  checked: z.array(z.boolean()).optional(),
  evidence: z.string().max(20000).optional(),
  completionPolicy: completionPolicySchema.optional(),
  needsManual: z.boolean().optional(),
  inputImages: inputImagesSchema,
  dependencies: z.array(z.string().min(1).max(150)).max(20).optional(),
  resourceKeys: z.array(z.string().max(128)).max(8).optional(),
  answers: ownerAnswersSchema.optional(),
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
  imageLimits?(): ImageInputLimits
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
    const board = boardSchema.parse(structuredClone(this.persistence.get()))
    // Older releases left the pre-acceptance machine note on completed tasks.
    // A done task has no pending automation gate, so never present that note.
    for (const task of board.tasks)
      if (task.status === 'done') task.automationNote = ''
    return board
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
  /**
   * Persisted dependents that have not started are blocked in the same commit
   * as a blocked/needs-info/reopened/archived dependency. Running descendants
   * keep running; presentation derives their attention separately.
   */
  private invalidateSuccessors(
    b: Board,
    changed: Task,
    previous: Task,
  ): Task[] {
    const invalidated =
      (changed.archived && !previous.archived) ||
      (['blocked', 'needs-info'].includes(changed.status) &&
        changed.status !== previous.status) ||
      (previous.status === 'done' && changed.status !== 'done')
    if (!invalidated) return []
    const status = changed.archived ? 'archived' : changed.status
    return invalidatedSuccessors(changed.id, status, b.tasks).map(
      (successor) => {
        const target = b.tasks.find((t) => t.id === successor.taskId)!
        return {
          ...target,
          status: 'blocked' as const,
          automationNote: dependencyNote(successor.dependencyId, status),
          version: target.version + 1,
          updatedAt: this.env.now(),
        }
      },
    )
  }
  /** Persisted lane count for one workspace; invalid/legacy values read as 2. */
  lanes(workspaceId: string): number {
    return resolveLanes(
      this.snapshot().settings.workspaces[workspaceId]?.lanes,
    )
  }
  settings(workspaceId: string): BoardWorkspaceSettings {
    return { lanes: this.lanes(workspaceId) }
  }
  /**
   * Owner-only persisted lane setting, separate from strict dispatch commands.
   * requestId reuse returns the original result; a changed payload is refused.
   */
  setLanes(
    raw: LaneRequest,
  ): Promise<{ workspaceId: string; lanes: number; revision: number }> {
    const r = z
      .strictObject({
        requestId: requestId,
        workspaceId: z.string().min(1),
        lanes: z.number().int().min(1).max(4),
      })
      .parse(raw)
    return this.write(async () => {
      const b = this.snapshot()
      this.workspace(r.workspaceId)
      const fingerprint = createHash('sha256')
        .update(JSON.stringify({ request: r, actor: 'human' }))
        .digest('hex')
      const prior = b.settingsReceipts.find(
        (receipt) => receipt.requestId === r.requestId,
      )
      if (prior) {
        if (prior.fingerprint !== fingerprint)
          throw new BoardError(
            'request-reused',
            'Request identity was already used',
          )
        return {
          workspaceId: prior.workspaceId,
          lanes: prior.lanes,
          revision: b.revision,
        }
      }
      b.settings.workspaces[r.workspaceId] = { lanes: r.lanes }
      b.revision++
      b.ledger.push({
        seq: b.revision,
        taskId: r.workspaceId,
        action: 'settings-lanes',
        actor: 'human',
        time: this.env.now(),
      })
      b.settingsReceipts.push({
        requestId: r.requestId,
        fingerprint,
        workspaceId: r.workspaceId,
        lanes: r.lanes,
      })
      boardSchema.parse(b)
      await this.persistence.set(b)
      for (const notify of this.listeners)
        try {
          notify()
        } catch {}
      return {
        workspaceId: r.workspaceId,
        lanes: r.lanes,
        revision: b.revision,
      }
    })
  }
  private imageLimits(): ImageInputLimits {
    return this.env.imageLimits?.() ?? DEFAULT_IMAGE_LIMITS
  }
  private checkImages(images: readonly InputImage[] | undefined) {
    if (!images) return
    try {
      validateInputImages(images, this.imageLimits())
    } catch (error) {
      if (error instanceof InputImageError)
        throw new BoardError(error.code, error.message)
      throw error
    }
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
    if (
      assignee &&
      this.snapshot().tasks.some(
        (t) =>
          t.analysisSessionId === assignee || t.reviewSessionId === assignee,
      )
    )
      throw new BoardError(
        'phase-role',
        'Analysis and review Sessions cannot receive execution assignments',
      )
    if (assignee && !this.workspace(ws).sessionIds.includes(assignee))
      throw new BoardError(
        'invalid-assignee',
        'Session belongs to another workspace',
      )
  }
  /**
   * One durable commit may also invalidate not-started dependents. They share
   * the commit revision; each successor is written atomically with the root.
   */
  private mutate(
    request: { requestId: string },
    actor: string,
    decide: (b: Board) => {
      task: Task
      action: string
      successors?: Task[]
    },
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
      const { task, action, successors = [] } = decide(b)
      const at = b.tasks.findIndex((t) => t.id === task.id)
      if (at < 0) b.tasks.push(task)
      else b.tasks[at] = task
      for (const successor of successors) {
        const index = b.tasks.findIndex((t) => t.id === successor.id)
        if (index < 0) b.tasks.push(successor)
        else b.tasks[index] = successor
      }
      b.revision++
      b.ledger.push({
        seq: b.revision,
        taskId: task.id,
        action,
        actor,
        time: this.env.now(),
      })
      for (const successor of successors)
        b.ledger.push({
          seq: b.revision,
          taskId: successor.id,
          action: 'dependency-invalidated',
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
  create(raw: CreateCommand) {
    const r = createSchema.parse(raw)
    return this.mutate(r, 'human', (b) => {
      if (!r.intake && !r.criteria.length)
        throw new BoardError(
          'criteria-required',
          'Execution-ready work requires acceptance criteria',
        )
      this.workspace(r.workspaceId)
      this.checkAssignee(r.workspaceId, r.assignee)
      this.checkImages(r.inputImages)
      const policy = r.completionPolicy ?? manualPolicy()
      const policyProblem = completionPolicyProblem(policy, r.criteria)
      if (policyProblem)
        throw new BoardError('policy-incomplete', policyProblem)
      const now = this.env.now()
      const id = this.env.id()
      const dependencies = r.dependencies ?? []
      const dependencyProblem = dependenciesProblem(
        id,
        dependencies,
        b.tasks,
        r.workspaceId,
      )
      if (dependencyProblem)
        throw new BoardError(
          dependencyProblem.code,
          dependencyProblem.message,
        )
      const resourceProblem = resourceKeysProblem(r.resourceKeys ?? [])
      if (resourceProblem)
        throw new BoardError(resourceProblem.code, resourceProblem.message)
      return {
        action: 'create',
        task: {
          workspaceId: r.workspaceId,
          title: r.title,
          description: r.description,
          priority: r.priority,
          assignee: r.assignee,
          id,
          criteria: [...r.criteria],
          dependencies: [...dependencies],
          resourceKeys: [...(r.resourceKeys ?? [])],
          checked: r.criteria.map(() => false),
          evidence: '',
          images: [],
          inputImages: structuredClone(r.inputImages ?? []),
          // Persist a concrete language for new tasks even when an older client
          // omits it; legacy stored tasks keep null until the next edit.
          language:
            r.language ??
            detectTaskLanguage({
              title: r.title,
              description: r.description,
              criteria: r.criteria,
            }),
          sessionId: null,
          status: r.intake ? 'triage' : 'todo',
          version: 1,
          archived: false,
          createdAt: now,
          updatedAt: now,
          intake: r.intake ?? false,
          needsManual: r.needsManual ?? false,
          analysisSessionId: null,
          analysis: null,
          answers: [],
          reviewSessionId: null,
          reviewPromptHash: null,
          review: null,
          completionPolicy: policy,
          completion: null,
          automationNote: '',
        },
      }
    })
  }
  update(raw: UpdateCommand) {
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
        !['todo', 'triage', 'needs-info', 'blocked'].includes(old.status) &&
        (r.criteria !== undefined ||
          r.title !== undefined ||
          r.description !== undefined ||
          r.completionPolicy !== undefined ||
          r.needsManual !== undefined ||
          r.inputImages !== undefined ||
          r.dependencies !== undefined ||
          r.resourceKeys !== undefined)
      )
        throw new BoardError(
          'frozen',
          'Return the task to the queue before changing its scope',
        )
      this.checkImages(r.inputImages)
      const task = {
        ...old,
        version: old.version + 1,
        updatedAt: this.env.now(),
      }
      if (r.action === 'edit') {
        if (r.criteria !== undefined) {
          task.criteria = [...r.criteria]
          task.checked = r.criteria.map(() => false)
        }
        if (r.title !== undefined) task.title = r.title
        if (r.description !== undefined) task.description = r.description
        if (r.priority !== undefined) task.priority = r.priority
        if (r.completionPolicy !== undefined)
          task.completionPolicy = r.completionPolicy
        if (r.needsManual !== undefined) task.needsManual = r.needsManual
        if (r.inputImages !== undefined)
          task.inputImages = structuredClone(r.inputImages)
        if (r.answers !== undefined) {
          task.answers = structuredClone(r.answers)
          // The old criteria were generated before these answers; let the
          // fresh analysis rebuild them unless the edit carries new criteria.
          if (r.criteria === undefined) {
            task.criteria = []
            task.checked = []
          }
        }
        if (r.dependencies !== undefined) {
          const problem = dependenciesProblem(
            old.id,
            r.dependencies,
            b.tasks,
            old.workspaceId,
          )
          if (problem)
            throw new BoardError(problem.code, problem.message)
          task.dependencies = [...r.dependencies]
        }
        if (r.resourceKeys !== undefined) {
          const problem = resourceKeysProblem(r.resourceKeys)
          if (problem)
            throw new BoardError(problem.code, problem.message)
          task.resourceKeys = [...r.resourceKeys]
        }
        if (r.completionPolicy !== undefined || r.criteria !== undefined) {
          const policyProblem = completionPolicyProblem(
            task.completionPolicy,
            task.criteria,
          )
          if (policyProblem)
            throw new BoardError('policy-incomplete', policyProblem)
        }
        const scopeChanged =
          r.criteria !== undefined ||
          r.title !== undefined ||
          r.description !== undefined ||
          r.completionPolicy !== undefined ||
          r.needsManual !== undefined ||
          (r.answers !== undefined &&
            JSON.stringify(task.answers) !== JSON.stringify(old.answers)) ||
          (r.inputImages !== undefined &&
            JSON.stringify(r.inputImages) !== JSON.stringify(old.inputImages)) ||
          (r.dependencies !== undefined &&
            JSON.stringify(task.dependencies) !==
              JSON.stringify(old.dependencies)) ||
          (r.resourceKeys !== undefined &&
            JSON.stringify(task.resourceKeys) !==
              JSON.stringify(old.resourceKeys))
        if (scopeChanged) {
          task.analysis = null
          task.analysisSessionId = null
          task.review = null
          task.reviewPromptHash = null
          task.reviewSessionId = null
          task.completion = null
          task.automationNote = ''
          if (task.intake || task.completionPolicy.mode !== 'manual') {
            task.intake = true
            task.status = 'triage'
          }
        }
      }
      if (r.action === 'retry') {
        if (
          ![
            'blocked',
            'in-progress',
            'triage',
            'needs-info',
            'in-review',
          ].includes(old.status)
        )
          throw new BoardError(
            'invalid-transition',
            'Only unfinished work can be retried',
          )
        task.status =
          (task.intake || !task.criteria.length) &&
          (!task.analysis ||
            ['needs-info', 'human'].includes(task.analysis.route))
            ? 'triage'
            : 'todo'
        if (task.status === 'triage') {
          task.intake = true
          task.analysis = null
          task.analysisSessionId = null
        }
        task.sessionId = null
        task.review = null
        task.reviewPromptHash = null
        task.reviewSessionId = null
        task.completion = null
        task.checked = task.criteria.map(() => false)
        task.automationNote = ''
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
          !task.criteria.length ||
          !task.evidence ||
          !task.checked.every(Boolean)
        )
          throw new BoardError(
            'not-accepted',
            'Evidence and all acceptance checks are required',
          )
        task.status = 'done'
        task.automationNote = ''
        task.completion = {
          kind: 'human',
          time: this.env.now(),
          ruleVersion: RULE_VERSION,
          promptHash: digest(task.completionPolicy),
          evidenceHash: digest(task.evidence),
          reviewerSessionId: null,
          checks: [],
          results: task.criteria.map((_c, criterion) => ({
            criterion,
            passed: true,
            evidence: 'Explicit owner acceptance',
          })),
        }
      }
      if (r.action === 'move') {
        if (r.status === 'in-progress' && old.status !== 'in-progress')
          throw new BoardError(
            'invalid-transition',
            'Use the native claim path to start work',
          )
        if (!r.status || r.status === 'done')
          throw new BoardError(
            'invalid-transition',
            'Use explicit acceptance to finish',
          )
        if (r.status === 'in-review' && !task.evidence)
          throw new BoardError('evidence-required', 'Review needs evidence')
        task.status = r.status
        if (r.status === 'todo') {
          if (
            !task.criteria.length ||
            (task.intake &&
              (!task.analysis ||
                !['express', 'staged'].includes(task.analysis.route)))
          )
            throw new BoardError(
              'analysis-required',
              'Analyze and clarify the task before execution',
            )
          task.sessionId = null
          task.checked = task.checked.map(() => false)
          task.completion = null
          task.review = null
          task.reviewPromptHash = null
          task.reviewSessionId = null
          task.automationNote = ''
        }
        if (r.status === 'triage') {
          task.intake = true
          task.analysis = null
          task.analysisSessionId = null
          task.sessionId = null
          task.review = null
          task.reviewPromptHash = null
          task.reviewSessionId = null
          task.completion = null
          task.checked = task.checked.map(() => false)
          task.automationNote = ''
        }
      }
      return {
        task,
        action: r.action,
        successors: this.invalidateSuccessors(b, task, old),
      }
    })
  }
  claim(sessionId: string, raw: AgentRequest) {
    const r = z
      .strictObject({ requestId, taskId: z.string().optional() })
      .parse(raw)
    return this.mutate(r, sessionId, (b) => {
      const ws = this.sessionWorkspace(sessionId)
      if (
        b.tasks.some(
          (t) =>
            t.analysisSessionId === sessionId ||
            t.reviewSessionId === sessionId,
        )
      )
        throw new BoardError(
          'phase-role',
          'Analysis and review Sessions cannot claim execution work',
        )
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
      const base = b.tasks.filter(
        (t) =>
          !t.archived &&
          t.workspaceId === ws.id &&
          t.status === 'todo' &&
          t.criteria.length > 0 &&
          (!t.intake ||
            (!!t.analysis &&
              ['express', 'staged'].includes(t.analysis.route))) &&
          (!t.assignee || t.assignee === sessionId) &&
          (!r.taskId || t.id === r.taskId),
      )
      const choices = base
        .filter(
          (t) =>
            dependenciesSatisfied(t, b.tasks) &&
            !resourceHolders(t, b.tasks).length &&
            !blockedByEarlierSameKey(t, b.tasks, sessionId),
        )
        .sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt)
      const task = choices[0]
      if (!task) {
        // A specifically requested task gets the exact admission reason; other
        // candidates fall through only when none is runnable at all.
        const requested = r.taskId
          ? base.find((t) => t.id === r.taskId)
          : undefined
        if (requested && !dependenciesSatisfied(requested, b.tasks)) {
          const waiting = requested.dependencies.filter(
            (id) => b.tasks.find((t) => t.id === id)?.status !== 'done',
          )
          throw new BoardError(
            'dependency-wait',
            `Dependencies are not complete: ${waiting.join(', ')}`,
          )
        }
        if (requested) {
          const holders = resourceHolders(requested, b.tasks)
          if (holders.length)
            throw new BoardError(
              'resource-busy',
              `Resource ${holders[0]!.key} is held by ${holders[0]!.taskId}; v1 waits without preemption`,
            )
          if (blockedByEarlierSameKey(requested, b.tasks, sessionId))
            throw new BoardError(
              'resource-order',
              'An earlier task with the same resource key is still runnable',
            )
        }
        throw new BoardError('queue-empty', 'No eligible task')
      }
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
        images: z.array(imageSchema).max(12).optional(),
        outcome: z.enum(['review', 'blocked']).optional(),
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
      if (
        r.images?.some(
          (image) =>
            image.criterion !== undefined &&
            image.criterion >= task.criteria.length,
        )
      )
        throw new BoardError(
          'criteria-mismatch',
          'Image criterion is outside the acceptance list',
        )
      const next: Task = {
        ...task,
        evidence: r.evidence,
        images: r.images ?? [],
        status: r.outcome === 'blocked' ? 'blocked' : 'in-review',
        version: task.version + 1,
        updatedAt: this.env.now(),
        review: null,
        reviewSessionId: null,
        completion: null,
        automationNote: '',
        checked: task.criteria.map(() => false),
      }
      return {
        action: 'report',
        task: next,
        successors: this.invalidateSuccessors(b, next, task),
      }
    })
  }
  /**
   * Execution candidates: dependencies done, no in-progress holder of any key.
   * Analysis eligibility is separate; dependencies gate execution, not planning.
   */
  eligible(workspaceId: string) {
    const tasks = this.snapshot().tasks
    return tasks
      .filter(
        (t) =>
          t.workspaceId === workspaceId &&
          executionReady(t) &&
          dependenciesSatisfied(t, tasks) &&
          !resourceHolders(t, tasks).length,
      )
      .sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt)
  }
  analysisEligible(workspaceId: string) {
    return this.snapshot()
      .tasks.filter(
        (t) =>
          t.workspaceId === workspaceId &&
          !t.archived &&
          t.intake &&
          !t.analysis &&
          !t.analysisSessionId &&
          ['triage', 'todo'].includes(t.status),
      )
      .sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt)
  }
  beginAnalysis(sessionId: string, id: string, expectedVersion: number) {
    return this.mutate({ requestId: this.env.id() }, sessionId, (b) => {
      const old = b.tasks.find((t) => t.id === id)
      if (
        !old ||
        old.version !== expectedVersion ||
        old.archived ||
        !['triage', 'todo'].includes(old.status) ||
        old.analysisSessionId
      )
        throw new BoardError('conflict', 'Issue analysis already changed')
      if (this.sessionWorkspace(sessionId).id !== old.workspaceId)
        throw new BoardError(
          'not-owner',
          'Analysis Session belongs to another workspace',
        )
      return {
        action: 'analysis-start',
        task: {
          ...old,
          intake: true,
          status: 'triage',
          analysisSessionId: sessionId,
          analysis: null,
          version: old.version + 1,
          updatedAt: this.env.now(),
        },
      }
    })
  }
  triage(sessionId: string, raw: AnalysisReport) {
    const r = z
      .strictObject({
        requestId,
        taskId: z.string(),
        expectedVersion: z.number().int().positive(),
        analysis: analysisSchema,
        criteria: z.array(text).max(20),
      })
      .parse(raw)
    return this.mutate(r, sessionId, (b) => {
      const old = b.tasks.find((t) => t.id === r.taskId)
      if (
        !old ||
        old.analysisSessionId !== sessionId ||
        old.status !== 'triage' ||
        old.workspaceId !== this.sessionWorkspace(sessionId).id
      )
        throw new BoardError(
          'not-owner',
          'Issue is not assigned to this analysis Session',
        )
      if (old.version !== r.expectedVersion)
        throw new BoardError('conflict', 'Issue version changed')
      if (
        old.criteria.length &&
        JSON.stringify(old.criteria) !== JSON.stringify(r.criteria)
      )
        throw new BoardError(
          'frozen',
          'Existing acceptance criteria cannot be rewritten by analysis',
        )
      if (r.analysis.route === 'needs-info' && !r.analysis.questions.length)
        throw new BoardError(
          'questions-required',
          'Missing information requires specific questions',
        )
      if (
        !r.criteria.length &&
        ['express', 'staged'].includes(r.analysis.route)
      )
        throw new BoardError(
          'criteria-required',
          'Executable analysis requires criteria',
        )
      // Coordination is a machine-readable suggestion. It is validated against
      // the same workspace/self/cycle rules as owner declarations but is never
      // copied into Task.dependencies or Task.resourceKeys here.
      if (r.analysis.coordination) {
        const problem = coordinationProblem(
          old.id,
          old.workspaceId,
          r.analysis.coordination,
          b.tasks,
        )
        if (problem) throw new BoardError(problem.code, problem.message)
      }
      const analysis = {
        ...r.analysis,
        route:
          old.needsManual && r.analysis.route === 'express'
            ? ('staged' as const)
            : r.analysis.route,
      }
      const next: Task = {
        ...old,
        analysis,
        criteria: r.criteria,
        checked: r.criteria.map(() => false),
        status:
          analysis.route === 'needs-info'
            ? 'needs-info'
            : analysis.route === 'human'
              ? 'blocked'
              : 'todo',
        version: old.version + 1,
        updatedAt: this.env.now(),
        automationNote:
          analysis.route === 'human'
            ? 'Human implementation required'
            : analysis.route === 'needs-info'
              ? analysis.questions.join('\n')
              : '',
      }
      return {
        action: 'analysis-report',
        task: next,
        successors: this.invalidateSuccessors(b, next, old),
      }
    })
  }
  beginReview(sessionId: string, id: string, expectedVersion: number) {
    return this.mutate({ requestId: this.env.id() }, sessionId, (b) => {
      const old = b.tasks.find((t) => t.id === id)
      if (
        !old ||
        old.version !== expectedVersion ||
        old.status !== 'in-review' ||
        old.archived
      )
        throw new BoardError('conflict', 'Review task changed')
      if (
        old.sessionId === sessionId ||
        old.analysisSessionId === sessionId ||
        old.workspaceId !== this.sessionWorkspace(sessionId).id
      )
        throw new BoardError(
          'not-independent',
          'Review requires a different Session in this workspace',
        )
      const task: Task = {
        ...old,
        reviewSessionId: sessionId,
        review: null,
        version: old.version + 1,
        updatedAt: this.env.now(),
        reviewPromptHash: null,
      }
      task.reviewPromptHash = digest(reviewPrompt(task))
      return { action: 'review-start', task }
    })
  }
  submitReview(sessionId: string, raw: ReviewReport) {
    const r = z
      .strictObject({
        requestId,
        taskId: z.string(),
        expectedVersion: z.number().int().positive(),
        review: reviewSchema,
      })
      .parse(raw)
    return this.mutate(r, sessionId, (b) => {
      const old = b.tasks.find((t) => t.id === r.taskId)
      if (
        !old ||
        old.reviewSessionId !== sessionId ||
        old.sessionId === sessionId ||
        old.status !== 'in-review' ||
        old.workspaceId !== this.sessionWorkspace(sessionId).id
      )
        throw new BoardError(
          'not-owner',
          'Task is not assigned to this independent review Session',
        )
      if (old.version !== r.expectedVersion)
        throw new BoardError('conflict', 'Review version changed')
      return {
        action: 'review-report',
        task: {
          ...old,
          review: r.review,
          version: old.version + 1,
          updatedAt: this.env.now(),
        },
      }
    })
  }
  /**
   * Owner repair of an in-review completion policy. It clears only the
   * completion/review result; execution evidence and the claimed Session stay
   * intact, so the coordinator can re-verify without repeating side effects.
   */
  repairPolicy(raw: RepairPolicyRequest) {
    return this.mutate(raw, 'human', (b) => {
      const old = b.tasks.find((t) => t.id === raw.id)
      if (!old || old.version !== raw.expectedVersion)
        throw new BoardError('conflict', 'Task changed')
      if (old.status !== 'in-review' || old.archived)
        throw new BoardError(
          'invalid-transition',
          'Only active review tasks may repair their completion policy',
        )
      const policyProblem = completionPolicyProblem(
        raw.completionPolicy,
        old.criteria,
      )
      if (policyProblem)
        throw new BoardError('policy-incomplete', policyProblem)
      return {
        action: 'repair-policy',
        task: {
          ...old,
          completionPolicy: raw.completionPolicy,
          completion: null,
          review: null,
          reviewPromptHash: null,
          reviewSessionId: null,
          automationNote: '',
          version: old.version + 1,
          updatedAt: this.env.now(),
        },
      }
    })
  }
  /**
   * Apply the analysis coordination suggestions to the owner-declared
   * scheduling fields. This is a separate owner command: it preserves the
   * analysis, criteria and status and never re-executes the task.
   */
  applyCoordination(raw: TaskCommand) {
    return this.mutate(raw, 'human', (b) => {
      const old = b.tasks.find((t) => t.id === raw.id)
      if (!old || old.version !== raw.expectedVersion)
        throw new BoardError('conflict', 'Task changed')
      if (old.archived || !['todo', 'blocked', 'needs-info'].includes(old.status))
        throw new BoardError(
          'invalid-transition',
          'Coordination suggestions can only be applied before execution',
        )
      const coordination = old.analysis?.coordination
      if (!coordination)
        throw new BoardError(
          'coordination-missing',
          'This task has no analysis coordination suggestions',
        )
      if (old.dependencies.length || old.resourceKeys.length)
        throw new BoardError(
          'coordination-existing',
          'Clear the task dependencies and resource keys before applying suggestions',
        )
      if (!coordination.dependencies.length && !coordination.resourceKeys.length)
        throw new BoardError(
          'coordination-empty',
          'The analysis has no dependencies or resource keys to apply',
        )
      const dependencyProblem = dependenciesProblem(
        old.id,
        coordination.dependencies,
        b.tasks,
        old.workspaceId,
      )
      if (dependencyProblem)
        throw new BoardError(dependencyProblem.code, dependencyProblem.message)
      const resourceProblem = resourceKeysProblem(coordination.resourceKeys)
      if (resourceProblem)
        throw new BoardError(resourceProblem.code, resourceProblem.message)
      return {
        action: 'apply-coordination',
        task: {
          ...old,
          dependencies: [...coordination.dependencies],
          resourceKeys: [...coordination.resourceKeys],
          version: old.version + 1,
          updatedAt: this.env.now(),
        },
      }
    })
  }
  note(id: string, expectedVersion: number, note: string) {
    return this.mutate({ requestId: this.env.id() }, 'automation', (b) => {
      const old = b.tasks.find((t) => t.id === id)
      if (!old || old.version !== expectedVersion)
        throw new BoardError('conflict', 'Task changed during verification')
      return {
        action: 'automation-held',
        task: {
          ...old,
          automationNote: note,
          version: old.version + 1,
          updatedAt: this.env.now(),
        },
      }
    })
  }
  completeAutomatically(
    id: string,
    expectedVersion: number,
    receipt: CompletionReceipt,
  ) {
    return this.mutate({ requestId: this.env.id() }, 'automation', (b) => {
      const old = b.tasks.find((t) => t.id === id)
      if (
        !old ||
        old.version !== expectedVersion ||
        old.archived ||
        old.status !== 'in-review'
      )
        throw new BoardError(
          'conflict',
          'Task changed during automatic completion',
        )
      if (
        !canAutoComplete(old) ||
        !coversAll(old, receipt.results) ||
        receipt.kind !== old.completionPolicy.mode ||
        receipt.evidenceHash !== digest(old.evidence)
      )
        throw new BoardError(
          'gate-failed',
          'Automatic completion gates did not pass',
        )
      if (
        receipt.kind === 'reviewed' &&
        (!old.reviewSessionId ||
          old.reviewSessionId === old.sessionId ||
          receipt.reviewerSessionId !== old.reviewSessionId ||
          old.review?.verdict !== 'pass' ||
          old.review.risk !== 'low' ||
          old.review.remainingRisks.length ||
          !coversAll(old, old.review.results))
      )
        throw new BoardError(
          'gate-failed',
          'Independent review gates did not pass',
        )
      return {
        action: 'auto-complete',
        task: {
          ...old,
          status: 'done',
          completion: receiptSchema.parse(receipt),
          checked: old.criteria.map(() => true),
          automationNote: '',
          version: old.version + 1,
          updatedAt: this.env.now(),
        },
      }
    })
  }
}
export const defaultEnvironment = { now: Date.now, id: randomUUID }
