/**
 * Pure classification and one-shot application of the saved default permission
 * preset to existing Sessions. No DSH, filesystem, storage or browser imports:
 * the Host adapter supplies live Session facts and the official write path.
 */
import type {
  PermissionApplyExcluded,
  PermissionApplyFailed,
  PermissionApplyPreview,
  PermissionApplyPreviewRequest,
  PermissionApplyRequest,
  PermissionApplyResult,
  PermissionApplySkipped,
  PermissionApplyTarget,
  PermissionApplyUnsupported,
  PermissionEffective,
  PermissionExclusionReason,
  PermissionPendingFact,
  PermissionPresetOptionView,
  PermissionUnsupportedReason,
} from '../contract/types.ts'
import { BoardError } from './board.ts'
export const PERMISSION_APPLY_LIMIT = 500
const PENDING_LIMIT = 1000
/** Exact effective permission of one Session, or null when it is not live. */
export interface PermissionSessionFacts {
  sessionId: string
  workspaceId: string | null
  workspaceTitle: string | null
  title: string
  live: boolean
  archived: boolean
  child: boolean
  running: boolean
  /** Pending interaction reason already normalized, or null. */
  pendingKind: PermissionExclusionReason | null
  effective: PermissionEffective | null
}
/** Captured catalog, Settings revision and target preset for one action. */
export interface PermissionEnvironment {
  available: boolean
  reason: string
  preset: string
  presetName: string
  revision: number
  writable: boolean
  fullAccessBlocked: boolean
  options: PermissionPresetOptionView[]
  spec: { sandbox: string; approval: string } | null
}
/** Official per-Session read/write closures supplied by the Host adapter. */
export interface PermissionApplyRuntime {
  read(sessionId: string): PermissionEffective
  write(sessionId: string, preset: string): void
}
type Classified =
  | { kind: 'target' }
  | { kind: 'excluded'; reason: PermissionExclusionReason; detail: string }
  | { kind: 'unsupported'; reason: PermissionUnsupportedReason; detail: string }
const candidate = (facts: PermissionSessionFacts) => ({
  sessionId: facts.sessionId,
  workspaceId: facts.workspaceId,
  workspaceTitle: facts.workspaceTitle,
  title: facts.title,
  effective: facts.effective,
})
/** Map a native pending-interaction kind to the stable exclusion vocabulary. */
export function permissionPendingReason(
  kind: string,
): PermissionExclusionReason {
  switch (kind) {
    case 'approval':
      return 'pending-approval'
    case 'question':
      return 'pending-question'
    case 'plan-review':
      return 'pending-plan-review'
    default:
      return 'pending-interaction'
  }
}
const emptyPreview = (
  environment: PermissionEnvironment,
): PermissionApplyPreview => ({
  available: false,
  reason: environment.reason,
  preset: environment.preset,
  presetName: environment.presetName,
  revision: environment.revision,
  writable: environment.writable,
  fullAccessBlocked: environment.fullAccessBlocked,
  options: environment.options,
  workspaces: [],
  targets: [],
  excluded: [],
  unsupported: [],
})
const classify = (
  facts: PermissionSessionFacts,
  preset: string,
): Classified => {
  if (facts.archived)
    return {
      kind: 'unsupported',
      reason: 'archived',
      detail:
        'Session is archived; archived Sessions are unsupported in v1 and are never changed silently.',
    }
  if (facts.child)
    return {
      kind: 'unsupported',
      reason: 'child',
      detail:
        'Child/subagent Session; child Sessions are outside the v1 apply boundary.',
    }
  if (!facts.workspaceId)
    return {
      kind: 'unsupported',
      reason: 'other-workspace',
      detail:
        'Session belongs to no registered workspace; other workspaces are outside the v1 apply boundary.',
    }
  if (!facts.live)
    return {
      kind: 'unsupported',
      reason: 'cold',
      detail:
        'Session is not live in this Host; cold Sessions are unsupported in v1.',
    }
  if (facts.pendingKind)
    return {
      kind: 'excluded',
      reason: facts.pendingKind,
      detail: facts.running
        ? 'Session has a pending approval/question/plan-review interaction and its Agent is running. The dashboard never answers or resolves it.'
        : 'Session has a pending approval/question/plan-review interaction. The dashboard never answers or resolves it.',
    }
  if (facts.running)
    return {
      kind: 'excluded',
      reason: 'running',
      detail: 'Agent is running; running Sessions are excluded.',
    }
  if (facts.effective?.preset === preset)
    return {
      kind: 'excluded',
      reason: 'already-target',
      detail: `Session already uses preset "${preset}".`,
    }
  return { kind: 'target' }
}
const sortByReasonThenTitle = <T extends { title: string; reason: string }>(
  items: T[],
) =>
  items.sort(
    (left, right) =>
      left.reason.localeCompare(right.reason) ||
      left.title.localeCompare(right.title),
  )
const byWorkspaceThenTitle = <
  T extends { title: string; workspaceTitle: string | null },
>(
  items: T[],
) =>
  items.sort(
    (left, right) =>
      (left.workspaceTitle ?? '').localeCompare(right.workspaceTitle ?? '') ||
      left.title.localeCompare(right.title),
  )
/** Classify facts without writing anything. */
export function permissionApplyPreview(
  environment: PermissionEnvironment,
  sessions: readonly PermissionSessionFacts[],
  request: PermissionApplyPreviewRequest = {},
): PermissionApplyPreview {
  if (!environment.available) return emptyPreview(environment)
  const pending = pendingFacts(request.pending)
  const targets: PermissionApplyTarget[] = []
  const excluded: PermissionApplyExcluded[] = []
  const unsupported: PermissionApplyUnsupported[] = []
  for (const facts of sessions) {
    const classified = classify(
      {
        ...facts,
        pendingKind: pending.get(facts.sessionId) ?? facts.pendingKind,
      },
      environment.preset,
    )
    if (classified.kind === 'target') targets.push(candidate(facts))
    else if (classified.kind === 'excluded')
      excluded.push({ ...candidate(facts), ...classified })
    else unsupported.push({ ...candidate(facts), ...classified })
  }
  const groups = new Map<string, { title: string; count: number }>()
  for (const target of targets) {
    const key = target.workspaceId ?? ''
    const group = groups.get(key) ?? {
      title: target.workspaceTitle ?? key,
      count: 0,
    }
    group.count++
    groups.set(key, group)
  }
  return {
    available: true,
    reason: '',
    preset: environment.preset,
    presetName: environment.presetName,
    revision: environment.revision,
    writable: environment.writable,
    fullAccessBlocked: false,
    options: environment.options,
    workspaces: [...groups.entries()]
      .map(([workspaceId, group]) => ({
        workspaceId,
        title: group.title,
        count: group.count,
      }))
      .sort((left, right) => left.title.localeCompare(right.title)),
    targets: byWorkspaceThenTitle(targets),
    excluded: sortByReasonThenTitle(excluded),
    unsupported: sortByReasonThenTitle(unsupported),
  }
}
const sanitizeIds = (value: unknown): string[] => {
  if (!Array.isArray(value))
    throw new BoardError(
      'permission-request-invalid',
      'sessionIds must be an array',
    )
  const seen = new Set<string>()
  const ids: string[] = []
  for (const raw of value) {
    if (typeof raw !== 'string' || !raw.length || raw.length > 200)
      throw new BoardError(
        'permission-request-invalid',
        'sessionIds must contain bounded nonempty strings',
      )
    if (seen.has(raw)) continue
    seen.add(raw)
    ids.push(raw)
  }
  if (ids.length > PERMISSION_APPLY_LIMIT)
    throw new BoardError(
      'permission-limit',
      `At most ${PERMISSION_APPLY_LIMIT} Sessions may be changed by one action`,
    )
  return ids
}
const pendingFacts = (
  pending: readonly PermissionPendingFact[] | undefined,
): Map<string, PermissionExclusionReason> => {
  const map = new Map<string, PermissionExclusionReason>()
  if (!Array.isArray(pending)) return map
  let count = 0
  for (const fact of pending) {
    if (++count > PENDING_LIMIT) break
    if (!fact || typeof fact !== 'object') continue
    if (typeof fact.sessionId !== 'string' || !fact.sessionId.length) continue
    if (fact.sessionId.length > 200) continue
    if (typeof fact.kind !== 'string' || fact.kind.length > 64) continue
    map.set(fact.sessionId, permissionPendingReason(fact.kind))
  }
  return map
}
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error)
const emptySkipped = (
  sessionId: string,
  reason: PermissionApplySkipped['reason'],
  detail: string,
): PermissionApplySkipped => ({
  sessionId,
  workspaceId: null,
  workspaceTitle: null,
  title: sessionId,
  effective: null,
  reason,
  detail,
})
/**
 * Apply one captured preset to the exact Session ids returned by the preview.
 * The caller must already have confirmed; this function never retries or
 * resolves approvals, and each target receives at most one write.
 */
export function permissionApply(
  environment: PermissionEnvironment,
  sessions: readonly PermissionSessionFacts[],
  request: PermissionApplyRequest,
  runtime: PermissionApplyRuntime,
): PermissionApplyResult {
  if (environment.fullAccessBlocked)
    throw new BoardError(
      'permission-full-access',
      'v1 cannot bulk-apply Full access; save a lower default preset first',
    )
  if (!environment.available)
    throw new BoardError(
      environment.reason || 'permission-unavailable',
      'The official DSH permission capability is unavailable',
    )
  if (
    !Number.isSafeInteger(request.expectedRevision) ||
    request.expectedRevision !== environment.revision
  )
    throw new BoardError(
      'permission-stale',
      'Permission settings changed after the preview; refresh and confirm again',
    )
  if (request.expectedPreset !== environment.preset)
    throw new BoardError(
      'permission-stale',
      'The saved default permission changed after the preview; refresh and confirm again',
    )
  const ids = sanitizeIds(request.sessionIds)
  const pending = pendingFacts(request.pending)
  const factsById = new Map(
    sessions.map((facts) => [facts.sessionId, facts] as const),
  )
  const result: PermissionApplyResult = {
    preset: environment.preset,
    revision: environment.revision,
    applied: [],
    skipped: [],
    failed: [],
  }
  for (const sessionId of ids) {
    const facts = factsById.get(sessionId)
    if (!facts) {
      result.skipped.push(
        emptySkipped(
          sessionId,
          'missing',
          'Session is no longer present in this Host.',
        ),
      )
      continue
    }
    const current = {
      ...facts,
      pendingKind: pending.get(sessionId) ?? facts.pendingKind,
    }
    const classified = classify(current, environment.preset)
    if (classified.kind !== 'target') {
      result.skipped.push({ ...candidate(current), ...classified })
      continue
    }
    let before: PermissionEffective
    try {
      before = runtime.read(sessionId)
    } catch (error) {
      const failed: PermissionApplyFailed = {
        ...candidate(current),
        reason: 'readback-mismatch',
        detail: `Pre-apply read failed: ${message(error)}`,
        effective: current.effective,
      }
      result.failed.push(failed)
      continue
    }
    if (before.preset === environment.preset) {
      result.skipped.push({
        ...candidate(current),
        reason: 'already-target',
        detail: `Session already uses preset "${environment.preset}".`,
      })
      continue
    }
    try {
      runtime.write(sessionId, environment.preset)
    } catch (error) {
      const failed: PermissionApplyFailed = {
        ...candidate(current),
        reason: 'set-failed',
        detail: message(error),
        effective: current.effective,
      }
      result.failed.push(failed)
      continue
    }
    let after: PermissionEffective
    try {
      after = runtime.read(sessionId)
    } catch (error) {
      const failed: PermissionApplyFailed = {
        ...candidate(current),
        reason: 'readback-mismatch',
        detail: `Read-back failed: ${message(error)}`,
        effective: null,
      }
      result.failed.push(failed)
      continue
    }
    const spec = environment.spec
    if (
      after.preset !== environment.preset ||
      (spec !== null &&
        (after.sandbox !== spec.sandbox || after.approval !== spec.approval))
    ) {
      const failed: PermissionApplyFailed = {
        ...candidate(current),
        reason: 'readback-mismatch',
        detail: `Read-back returned preset "${after.preset}" (${after.sandbox}, approval ${after.approval}); expected "${environment.preset}" (${spec?.sandbox}, approval ${spec?.approval}).`,
        effective: after,
      }
      result.failed.push(failed)
      continue
    }
    result.applied.push({ ...candidate(current), effective: after })
  }
  return result
}
