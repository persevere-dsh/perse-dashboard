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
export type Isolation = 'none' | 'workspace' | 'manual-workspace'
/** Persisted task language; absent on legacy records, inferred deterministically. */
export type TaskLanguage = 'zh' | 'en'
/** One machine-readable resource conflict suggested by analysis. */
export interface ResourceConflict {
  key: string
  taskIds: string[]
}
/**
 * Optional machine-readable analysis coordination. Suggestions are recorded for
 * audit and the owner UI; they are never written into Task.dependencies or
 * Task.resourceKeys automatically. Legacy records have null.
 */
export interface Coordination {
  dependencies: string[]
  resourceKeys: string[]
  dependencyOrder: string[]
  resourceConflicts: ResourceConflict[]
  isolation: Isolation
  mergeRisk: Risk
}
export interface Analysis {
  summary: string
  plan: string[]
  risk: Risk
  route: Route
  questions: string[]
  coordination: Coordination | null
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
export interface EvidenceImage {
  path: string
  caption: string
  criterion?: number
}
/** Raster formats accepted for task input images. */
export type ImageMediaType =
  'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
/** Where the owner pasted an input image in the intake form. */
export type InputImageSource = 'description' | 'criteria'
/** Durable, serializable reference to one task input image. Never contains bytes. */
export interface InputImage {
  attachmentId: string
  mediaType: ImageMediaType
  bytes: number
  width: number
  height: number
  name: string
  source: InputImageSource
}
/** Base64 image supplied on create/update; the Host persists it before mutation. */
export interface InputImageDraft {
  mediaType: ImageMediaType
  data: string
  name?: string
  source: InputImageSource
}
/** Existing task image retained by an edit without re-uploading its bytes. */
export interface InputImageKeep {
  keep: true
  attachmentId: string
}
export type InputImageUpdate = InputImageDraft | InputImageKeep
/** Deployment image policy exposed to the client. */
export interface ImageInputLimits {
  maxImages: number
  maxImageBytes: number
  maxImagePixels: number
  maxImageDimension: number
  mediaTypes: ImageMediaType[]
}
/** Owner answer to one analysis question; persisted across re-analysis. */
export interface OwnerAnswer {
  question: string
  answer: string
}
export interface Task {
  id: string
  workspaceId: string
  title: string
  description: string
  criteria: string[]
  checked: boolean[]
  evidence: string
  images: EvidenceImage[]
  inputImages: InputImage[]
  /** Additive owner Q/A from a needs-info analysis; [] on legacy tasks. */
  answers: OwnerAnswer[]
  /** Additive field: null/absent on legacy tasks means infer from content. */
  language: TaskLanguage | null
  /** Owner-declared task dependencies in the same workspace; [] on legacy tasks. */
  dependencies: string[]
  /** Owner-declared resource keys (namespace:value); [] on legacy tasks. */
  resourceKeys: string[]
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
  reviewPromptHash: string | null
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
/** Persisted per-workspace automation settings; process-local state stays separate. */
export interface BoardWorkspaceSettings {
  lanes: number
}
export interface BoardSettings {
  workspaces: Record<string, BoardWorkspaceSettings>
}
/** Durable request receipt for a board-settings mutation (lanes). */
export interface SettingsReceipt {
  requestId: string
  fingerprint: string
  workspaceId: string
  lanes: number
}
export interface Board {
  revision: number
  tasks: Task[]
  ledger: Audit[]
  receipts: Receipt[]
  settings: BoardSettings
  settingsReceipts: SettingsReceipt[]
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
  inputImages?: InputImageDraft[]
  /** New tasks persist the active DSH language; omitted falls back to inference. */
  language?: TaskLanguage
  dependencies?: string[]
  resourceKeys?: string[]
}
export interface UpdateRequest {
  requestId: string
  id: string
  expectedVersion: number
  action:
    'edit' | 'assign' | 'move' | 'archive' | 'restore' | 'accept' | 'retry'
  criteria?: string[]
  title?: string
  description?: string
  priority?: number
  assignee?: string | null
  status?: TaskStatus
  checked?: boolean[]
  evidence?: string
  completionPolicy?: CompletionPolicy
  needsManual?: boolean
  inputImages?: InputImageUpdate[]
  dependencies?: string[]
  resourceKeys?: string[]
  answers?: OwnerAnswer[]
}
export interface AgentRequest {
  requestId: string
  taskId?: string
  expectedVersion?: number
  evidence?: string
  images?: EvidenceImage[]
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
/** Owner-only repair of an in-review completion policy; never re-executes. */
export interface RepairPolicyRequest extends TaskCommand {
  completionPolicy: CompletionPolicy
}
export interface DispatchRequest {
  workspaceId: string
  enabled: boolean
  watch?: boolean
  maxTasks?: number
}
/** Owner-only persisted lane setting; separate from strict dispatch commands. */
export interface LaneRequest {
  requestId: string
  workspaceId: string
  lanes: number
}
/** One process-local phase slot; analysis slots do not consume execution lanes. */
export interface DispatchSlot {
  taskId: string
  sessionId: string
  phase: 'analysis' | 'execution'
}
export interface DispatchState {
  enabled: boolean
  workspaceId: string | null
  /** First active slot for older clients; new clients use active[]. */
  activeTaskId: string | null
  activeSessionId: string | null
  /** Every process-local phase currently running (analysis and execution). */
  active: DispatchSlot[]
  /** Effective persisted execution lane count for the active workspace. */
  lanes: number
  errorTaskId?: string | null
  error: string | null
  watch: boolean
  processed: number
  maxTasks: number
}
/** Effective permission read back from an official DSH Session projection/service. */
export interface PermissionEffective {
  preset: string
  sandbox: string
  approval: string
}
/** One catalog preset eligible as an apply target or displayed by the preview. */
export interface PermissionPresetOptionView {
  id: string
  name: string
  description?: string
}
/** Why an eligible-looking Session is not included in one apply action. */
export type PermissionExclusionReason =
  | 'running'
  | 'pending-approval'
  | 'pending-question'
  | 'pending-plan-review'
  | 'pending-interaction'
  | 'already-target'
/** Why a Session is outside the v1 apply boundary. */
export type PermissionUnsupportedReason =
  'archived' | 'cold' | 'child' | 'other-workspace'
/** Why a requested Session was not applied at apply time. */
export type PermissionSkipReason =
  PermissionExclusionReason | PermissionUnsupportedReason | 'missing'
/** One live Session the preview would change. */
export interface PermissionApplyTarget {
  sessionId: string
  workspaceId: string | null
  workspaceTitle: string | null
  title: string
  effective: PermissionEffective | null
}
/** One eligible-looking Session deliberately left unchanged. */
export interface PermissionApplyExcluded {
  sessionId: string
  workspaceId: string | null
  workspaceTitle: string | null
  title: string
  effective: PermissionEffective | null
  reason: PermissionExclusionReason
  detail: string
}
/** One Session outside the v1 live/registered-workspace boundary. */
export interface PermissionApplyUnsupported {
  sessionId: string
  workspaceId: string | null
  workspaceTitle: string | null
  title: string
  effective: PermissionEffective | null
  reason: PermissionUnsupportedReason
  detail: string
}
/** One target Session whose effective permission was read back after the write. */
export interface PermissionApplyApplied {
  sessionId: string
  workspaceId: string | null
  workspaceTitle: string | null
  title: string
  effective: PermissionEffective
}
/** One requested Session the apply action left unchanged, with its reason. */
export interface PermissionApplySkipped {
  sessionId: string
  workspaceId: string | null
  workspaceTitle: string | null
  title: string
  effective: PermissionEffective | null
  reason: PermissionSkipReason
  detail: string
}
/** One target Session whose write or read-back failed; never retried automatically. */
export interface PermissionApplyFailed {
  sessionId: string
  workspaceId: string | null
  workspaceTitle: string | null
  title: string
  effective: PermissionEffective | null
  reason: 'set-failed' | 'readback-mismatch'
  detail: string
}
/** One workspace represented by preview targets. */
export interface PermissionApplyWorkspaceGroup {
  workspaceId: string
  title: string
  count: number
}
/** Pending interaction fact supplied by the native client status hook. */
export interface PermissionPendingFact {
  sessionId: string
  kind: string
}
/** Owner-requested classification before any permission write. */
export interface PermissionApplyPreviewRequest {
  pending?: PermissionPendingFact[]
}
/** One-shot apply request fenced by the captured Settings revision and default preset. */
export interface PermissionApplyRequest {
  expectedRevision: number
  expectedPreset: string
  sessionIds: string[]
  pending?: PermissionPendingFact[]
}
/** Complete owner-facing preview of one apply action. */
export interface PermissionApplyPreview {
  available: boolean
  reason: string
  preset: string
  presetName: string
  revision: number
  writable: boolean
  fullAccessBlocked: boolean
  options: PermissionPresetOptionView[]
  workspaces: PermissionApplyWorkspaceGroup[]
  targets: PermissionApplyTarget[]
  excluded: PermissionApplyExcluded[]
  unsupported: PermissionApplyUnsupported[]
}
/** Complete result of one apply action; failures are retained without retry. */
export interface PermissionApplyResult {
  preset: string
  revision: number
  applied: PermissionApplyApplied[]
  skipped: PermissionApplySkipped[]
  failed: PermissionApplyFailed[]
}
export interface DashboardSnapshot {
  revision: number
  tasks: Task[]
  ledger: Audit[]
  settings: BoardSettings
  dispatch: DispatchState
  capabilities?: Record<string, boolean>
  imageLimits?: ImageInputLimits
}
/** Host-normalized create command: drafts already resolved to durable references. */
export type CreateCommand = Omit<CreateRequest, 'inputImages'> & {
  inputImages?: InputImage[]
}
/** Host-normalized update command: retained and newly saved references. */
export type UpdateCommand = Omit<UpdateRequest, 'inputImages'> & {
  inputImages?: InputImage[]
}
