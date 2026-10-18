/** Pure domain and serialized durable mutations; no DSH or browser imports. */
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import type {
  Board,
  Task,
  CreateRequest,
  UpdateRequest,
  AgentRequest,
  AnalysisReport,
  ReviewReport,
  CompletionReceipt,
} from '../contract/types.ts'
import { reviewPrompt } from './prompts.ts'
import {
  manualPolicy,
  completionPolicySchema,
  analysisSchema,
  reviewSchema,
  receiptSchema,
  canAutoComplete,
  coversAll,
  RULE_VERSION,
  digest,
} from './policy.ts'
export const imageSchema = z.object({
  path: z.string().min(1).max(1000),
  caption: z.string().max(500),
  criterion: z.number().int().nonnegative().optional(),
})
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
  analysis: analysisSchema.nullable().default(null),
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
  criteria: z.array(text).max(20),
  priority: z.number().int().min(0).max(2),
  assignee: z.string().nullable(),
  intake: z.boolean().optional(),
  needsManual: z.boolean().optional(),
  completionPolicy: completionPolicySchema.optional(),
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
    return boardSchema.parse(structuredClone(this.persistence.get()))
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
      if (!r.intake && !r.criteria.length)
        throw new BoardError(
          'criteria-required',
          'Execution-ready work requires acceptance criteria',
        )
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
          images: [],
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
          reviewSessionId: null,
          reviewPromptHash: null,
          review: null,
          completionPolicy: r.completionPolicy ?? manualPolicy(),
          completion: null,
          automationNote: '',
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
        !['todo', 'triage', 'needs-info', 'blocked'].includes(old.status) &&
        (r.criteria !== undefined ||
          r.title !== undefined ||
          r.description !== undefined ||
          r.completionPolicy !== undefined ||
          r.needsManual !== undefined)
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
        if (
          r.criteria !== undefined ||
          r.title !== undefined ||
          r.description !== undefined ||
          r.completionPolicy !== undefined ||
          r.needsManual !== undefined
        ) {
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
      return { task, action: r.action }
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
      const choices = b.tasks
        .filter(
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
      return {
        action: 'report',
        task: {
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
        },
      }
    })
  }
  eligible(workspaceId: string) {
    return this.snapshot()
      .tasks.filter(
        (t) =>
          t.workspaceId === workspaceId &&
          !t.archived &&
          t.status === 'todo' &&
          t.criteria.length > 0 &&
          (!t.intake ||
            (!!t.analysis && ['express', 'staged'].includes(t.analysis.route))),
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
      return { action: 'analysis-report', task: next }
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
