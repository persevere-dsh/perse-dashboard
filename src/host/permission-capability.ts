/**
 * Host adapter for the one-shot permission apply action. It reads only official
 * DSH services and Sessions; the actual write is PermissionPresetService.set,
 * which records its own permission/preset, sandbox/mode and approval/policy
 * events. This module never appends Session events, writes configuration, uses
 * a private database or decides approvals.
 */
import type {
  PermissionApplyPreview,
  PermissionApplyPreviewRequest,
  PermissionApplyRequest,
  PermissionApplyResult,
  PermissionEffective,
  PermissionPendingFact,
} from '../contract/types.ts'
import { BoardError } from './board.ts'
import {
  permissionApply,
  permissionApplyPreview,
  permissionPendingReason,
  type PermissionApplyRuntime,
  type PermissionEnvironment,
  type PermissionSessionFacts,
} from './permission-apply.ts'
interface PermissionSessionLike {
  id: string
  header?: {
    cwd?: string
    parentSession?: string
    origin?: string
    delegationDepth?: number
  }
}
interface PermissionWorkspaceLike {
  id: string
  path: string
  title: string
  sessionIds: readonly string[]
}
interface PermissionSessionSummaryLike {
  sessionId: string
  running: boolean
  parentSessionId?: string
  origin?: 'subagent'
  cwd?: string
  projections?: { values?: Record<string, unknown> }
}
interface CatalogOptionLike {
  value: string
  name: string
  description?: string
}
interface PresetServiceLike {
  catalog(): {
    defaultPreset: string
    defaultOptions: readonly CatalogOptionLike[]
    options?: readonly CatalogOptionLike[]
  }
  current(session: PermissionSessionLike): string
  resolve(name: string): { sandbox: string; approval: string }
  set(session: PermissionSessionLike, name: string): void
}
interface SettingsLike {
  readonly writable?: boolean
  describe(options?: unknown): readonly { ns: string; revision: number }[]
}
interface SandboxPolicyLike {
  resolve(request?: { session?: PermissionSessionLike }): { mode: string }
}
interface ApprovalLike {
  config?: { policy?: string }
  overrideOf?(session: PermissionSessionLike): string | undefined
}
interface ProjectionServiceLike {
  stateOf(session: PermissionSessionLike, key: string): unknown
}
interface TitleServiceLike {
  get(session: PermissionSessionLike): { title?: string } | undefined
}
/** The structural Host surface consumed by the adapter. */
export interface PermissionCapabilityHost {
  get(name: string): unknown
  sessions: {
    get(id: string): PermissionSessionLike | undefined
    list(): readonly PermissionSessionLike[]
  }
  agents: { get(id: string): { status?: string } | undefined }
  sessionController: {
    list(
      request: unknown,
      signal: AbortSignal,
    ): Promise<{ items: readonly PermissionSessionSummaryLike[] }>
  }
  workspaceRegistry: {
    list(): readonly PermissionWorkspaceLike[]
    readonly archivedSessionIds: readonly string[]
  }
}
export interface PermissionCapability {
  preview(
    request: PermissionApplyPreviewRequest,
  ): Promise<PermissionApplyPreview>
  apply(request: PermissionApplyRequest): Promise<PermissionApplyResult>
}
interface Services {
  presets: PresetServiceLike
  sandboxPolicy: SandboxPolicyLike
  approval: ApprovalLike
}
interface EnvironmentRead {
  environment: PermissionEnvironment
  services?: Services
}
const unavailable = (reason: string, revision = 0): EnvironmentRead => ({
  environment: {
    available: false,
    reason,
    preset: '',
    presetName: '',
    revision,
    writable: false,
    fullAccessBlocked: false,
    options: [],
    spec: null,
  },
})
const normalizedPath = (value: string) =>
  value.length > 1 ? value.replace(/\/+$/, '') : value
const readEnvironment = (host: PermissionCapabilityHost): EnvironmentRead => {
  const presets = host.get('permissionPresets') as PresetServiceLike | undefined
  const settings = host.get('settings') as SettingsLike | undefined
  const sandboxPolicy = host.get('sandboxPolicy') as
    SandboxPolicyLike | undefined
  const approval = host.get('approval') as ApprovalLike | undefined
  if (!presets || !settings || !sandboxPolicy || !approval)
    return unavailable('permission-unavailable')
  let catalog: ReturnType<PresetServiceLike['catalog']>
  let descriptor: { ns: string; revision: number } | undefined
  try {
    catalog = presets.catalog()
    descriptor = settings.describe().find((entry) => entry.ns === 'permission')
  } catch {
    return unavailable('permission-settings-unavailable')
  }
  if (!descriptor || !Number.isInteger(descriptor.revision))
    return unavailable('permission-settings-unavailable')
  const preset = String(catalog.defaultPreset ?? '')
  const option = catalog.defaultOptions.find((entry) => entry.value === preset)
  if (!option)
    return unavailable('permission-preset-unavailable', descriptor.revision)
  let spec: { sandbox: string; approval: string }
  try {
    spec = presets.resolve(preset)
  } catch {
    return unavailable('permission-preset-unavailable', descriptor.revision)
  }
  const fullAccessBlocked = spec.sandbox === 'danger-full-access'
  return {
    environment: {
      available: !fullAccessBlocked,
      reason: fullAccessBlocked ? 'permission-full-access' : '',
      preset,
      presetName: option.name || preset,
      revision: descriptor.revision,
      writable: settings.writable !== false,
      fullAccessBlocked,
      options: catalog.defaultOptions.map((entry) => ({
        id: entry.value,
        name: entry.name,
        ...(entry.description !== undefined
          ? { description: entry.description }
          : {}),
      })),
      spec: { sandbox: spec.sandbox, approval: spec.approval },
    },
    services: { presets, sandboxPolicy, approval },
  }
}
const readEffective = (
  session: PermissionSessionLike,
  services: Services,
): PermissionEffective => {
  let preset = 'unknown'
  try {
    preset = services.presets.current(session)
  } catch {}
  let sandbox = 'unknown'
  try {
    sandbox = services.sandboxPolicy.resolve({ session }).mode
  } catch {}
  const approval =
    services.approval.overrideOf?.(session) ??
    services.approval.config?.policy ??
    'ask'
  return { preset, sandbox, approval: String(approval) }
}
const projectionTitle = (
  host: PermissionCapabilityHost,
  session: PermissionSessionLike | undefined,
  summary: PermissionSessionSummaryLike | undefined,
): string | undefined => {
  const cached = summary?.projections?.values?.title
  if (typeof cached === 'string' && cached.length) return cached
  if (!session) return undefined
  const titleService = host.get('sessionTitle') as TitleServiceLike | undefined
  try {
    const title = titleService?.get(session)?.title
    if (typeof title === 'string' && title.length) return title
  } catch {}
  const projections = host.get('sessionProjections') as
    ProjectionServiceLike | undefined
  try {
    const title = projections?.stateOf(session, 'title')
    if (typeof title === 'string' && title.length) return title
  } catch {}
  return undefined
}
const collectSessions = async (
  host: PermissionCapabilityHost,
  services: Services,
  pending: readonly PermissionPendingFact[] | undefined,
): Promise<PermissionSessionFacts[]> => {
  const workspaces = host.workspaceRegistry.list()
  const workspaceById = new Map<string, PermissionWorkspaceLike>()
  for (const workspace of workspaces)
    for (const id of workspace.sessionIds)
      if (!workspaceById.has(String(id)))
        workspaceById.set(String(id), workspace)
  const workspaceByPath = new Map(
    workspaces.map((workspace) => [normalizedPath(workspace.path), workspace]),
  )
  const archived = new Set(
    host.workspaceRegistry.archivedSessionIds.map(String),
  )
  let summaries: readonly PermissionSessionSummaryLike[]
  try {
    summaries = (
      await host.sessionController.list({}, new AbortController().signal)
    ).items
  } catch (error) {
    throw new BoardError(
      'permission-session-list-unavailable',
      `DSH Session listing is unavailable: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
  const summaryById = new Map(
    summaries.map((summary) => [String(summary.sessionId), summary]),
  )
  const liveById = new Map<string, PermissionSessionLike>()
  const ids = new Set<string>()
  for (const workspace of workspaces)
    for (const id of workspace.sessionIds) ids.add(String(id))
  for (const summary of summaries) ids.add(String(summary.sessionId))
  for (const id of archived) ids.add(id)
  for (const session of host.sessions.list()) {
    liveById.set(String(session.id), session)
    ids.add(String(session.id))
  }
  const pendingById = new Map(
    (pending ?? [])
      .slice(0, 1000)
      .filter(
        (fact) =>
          fact &&
          typeof fact.sessionId === 'string' &&
          typeof fact.kind === 'string',
      )
      .map(
        (fact) => [fact.sessionId, permissionPendingReason(fact.kind)] as const,
      ),
  )
  const facts: PermissionSessionFacts[] = []
  for (const id of ids) {
    const session = liveById.get(id)
    const summary = summaryById.get(id)
    const cwd = session?.header?.cwd ?? summary?.cwd
    const workspace =
      workspaceById.get(id) ??
      (cwd ? workspaceByPath.get(normalizedPath(cwd)) : undefined)
    const child =
      !!session?.header?.parentSession ||
      session?.header?.origin === 'subagent' ||
      (session?.header?.delegationDepth ?? 0) > 0 ||
      !!summary?.parentSessionId ||
      summary?.origin === 'subagent'
    facts.push({
      sessionId: id,
      workspaceId: workspace ? String(workspace.id) : null,
      workspaceTitle: workspace ? workspace.title : null,
      title: projectionTitle(host, session, summary) ?? id,
      live: !!session,
      archived: archived.has(id),
      child,
      running:
        host.agents.get(id)?.status === 'running' || summary?.running === true,
      pendingKind: pendingById.get(id) ?? null,
      effective: session ? readEffective(session, services) : null,
    })
  }
  return facts
}
/**
 * Build the owner-facing preview and apply closures for one Host.
 * Missing optional services fail closed with a visible reason instead of
 * breaking dashboard loading.
 */
export function createPermissionCapability(
  host: PermissionCapabilityHost,
): PermissionCapability {
  return {
    async preview(request) {
      const { environment, services } = readEnvironment(host)
      if (!services) {
        const preview = permissionApplyPreview(environment, [])
        return { ...preview, available: false, reason: environment.reason }
      }
      let facts: PermissionSessionFacts[]
      try {
        facts = await collectSessions(host, services, request?.pending)
      } catch (error) {
        return {
          ...permissionApplyPreview(environment, []),
          available: false,
          reason:
            error instanceof BoardError
              ? error.code
              : 'permission-session-list-unavailable',
        }
      }
      return permissionApplyPreview(environment, facts, request ?? {})
    },
    async apply(request) {
      const { environment, services } = readEnvironment(host)
      if (!services)
        throw new BoardError(
          environment.reason || 'permission-unavailable',
          'The official DSH permission capability is unavailable',
        )
      if (environment.fullAccessBlocked)
        throw new BoardError(
          'permission-full-access',
          'v1 cannot bulk-apply Full access; save a lower default preset first',
        )
      if (
        !request ||
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
      const facts = await collectSessions(host, services, request.pending ?? [])
      const runtime: PermissionApplyRuntime = {
        read(sessionId) {
          const session = host.sessions.get(sessionId)
          if (!session) throw Error('Session is no longer live')
          return readEffective(session, services)
        },
        write(sessionId, preset) {
          const session = host.sessions.get(sessionId)
          if (!session) throw Error('Session is no longer live')
          services.presets.set(session, preset)
        },
      }
      return permissionApply(environment, facts, request, runtime)
    },
  }
}
