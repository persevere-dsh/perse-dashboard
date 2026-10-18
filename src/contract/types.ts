/** Wire vocabulary for Persevere with DSH. */
export type TaskStatus =
  | 'triage'
  | 'needs-info'
  | 'todo'
  | 'in-progress'
  | 'blocked'
  | 'in-review'
  | 'done'
export type Risk = 'low' | 'medium' | 'high'
export type Route = 'express' | 'staged' | 'needs-info' | 'human'
export interface Analysis {
  summary: string
  plan: string[]
  risk: Risk
  route: Route
  questions: string[]
}
export interface FileCheck {
  criterion: number
  path: string
  kind: 'text-equals' | 'sha256'
  expected: string
}
export interface CompletionPolicy {
  mode: 'manual' | 'verified' | 'reviewed'
  instructions: string
  checks: FileCheck[]
}
export interface CriterionResult {
  criterion: number
  passed: boolean
  evidence: string
}
export interface Review {
  verdict: 'pass' | 'fail' | 'needs-human'
  risk: Risk
  results: CriterionResult[]
  remainingRisks: string[]
  evidence: string
}
export interface CompletionReceipt {
  kind: 'human' | 'verified' | 'reviewed'
  time: number
  ruleVersion: string
  promptHash: string
  evidenceHash: string
  reviewerSessionId: string | null
  checks: CriterionResult[]
  results: CriterionResult[]
}
export interface Task {
  id: string
  workspaceId: string
  title: string
  description: string
  criteria: string[]
  checked: boolean[]
  evidence: string
  priority: number
  assignee: string | null
  sessionId: string | null
  status: TaskStatus
  version: number
  archived: boolean
  createdAt: number
  updatedAt: number
  intake: boolean
  needsManual: boolean
  analysisSessionId: string | null
  analysis: Analysis | null
  reviewSessionId: string | null
  review: Review | null
  completionPolicy: CompletionPolicy
  completion: CompletionReceipt | null
  automationNote: string
}
export interface Audit {
  seq: number
  taskId: string
  action: string
  actor: string
  time: number
}
export interface Receipt {
  requestId: string
  fingerprint: string
  task: Task
}
export interface Board {
  revision: number
  tasks: Task[]
  ledger: Audit[]
  receipts: Receipt[]
}
export interface CreateRequest {
  requestId: string
  workspaceId: string
  title: string
  description: string
  criteria: string[]
  priority: number
  assignee: string | null
  intake?: boolean
  needsManual?: boolean
  completionPolicy?: CompletionPolicy
}
export interface UpdateRequest {
  requestId: string
  id: string
  expectedVersion: number
  action: 'edit' | 'assign' | 'move' | 'archive' | 'restore' | 'accept'
  title?: string
  description?: string
  priority?: number
  assignee?: string | null
  status?: TaskStatus
  checked?: boolean[]
  evidence?: string
  completionPolicy?: CompletionPolicy
  needsManual?: boolean
}
export interface AgentRequest {
  requestId: string
  taskId?: string
  expectedVersion?: number
  evidence?: string
  outcome?: 'review' | 'blocked'
}
export interface AnalysisReport {
  requestId: string
  taskId: string
  expectedVersion: number
  analysis: Analysis
  criteria: string[]
}
export interface ReviewReport {
  requestId: string
  taskId: string
  expectedVersion: number
  review: Review
}
export interface TaskCommand {
  requestId: string
  id: string
  expectedVersion: number
}
export interface DispatchRequest {
  workspaceId: string
  enabled: boolean
  watch?: boolean
  maxTasks?: number
}
export interface DispatchState {
  enabled: boolean
  workspaceId: string | null
  activeTaskId: string | null
  activeSessionId: string | null
  error: string | null
  watch: boolean
  processed: number
  maxTasks: number
}
export interface DashboardSnapshot {
  revision: number
  tasks: Task[]
  ledger: Audit[]
  dispatch: DispatchState
  capabilities?: Record<string, boolean>
}
