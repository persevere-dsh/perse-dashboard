/** Wire vocabulary for Persevere with DSH. */
export type TaskStatus =
  | 'todo'
  | 'in-progress'
  | 'blocked'
  | 'in-review'
  | 'done'
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
}
export interface AgentRequest {
  requestId: string
  taskId?: string
  expectedVersion?: number
  evidence?: string
}
export interface DispatchRequest {
  workspaceId: string
  enabled: boolean
}
export interface DispatchState {
  enabled: boolean
  workspaceId: string | null
  activeTaskId: string | null
  activeSessionId: string | null
  error: string | null
}
export interface DashboardSnapshot {
  revision: number
  tasks: Task[]
  ledger: Audit[]
  dispatch: DispatchState
}
