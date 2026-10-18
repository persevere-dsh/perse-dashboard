/** Pure components: only framework-provided hooks and injected commands. */
import React, { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { Dialog, DetailTabs } from './dialog.tsx'
import { PermissionSettings, type PermissionControls } from './permissions.tsx'
import { activeTaskSessions, attentionKey } from './attention.ts'
import type {} from '@deepseek-ai/dsh-token-meter'
import type {
  PropsRuntime,
  TranslateNS,
  PropsStore,
} from '@deepseek-ai/dsh-client-ui-slots'
import type {
  CreateRequest,
  UpdateRequest,
  Task,
  TaskStatus,
  DispatchRequest,
  DispatchState,
} from '../contract/types.ts'
import type { createDashboardStore } from './store.ts'
import type { Key } from './locales.ts'
import { CompletionEditor } from './completion-editor.tsx'
import { OptionGroup } from './option-group.tsx'
import { validSnapshot } from './validation.ts'
import type {
  CompletionPolicy,
  TaskCommand,
  DashboardSnapshot,
} from '../contract/types.ts'
export interface Injected extends PermissionControls {
  create(r: CreateRequest): Promise<Task>
  update(r: UpdateRequest): Promise<Task>
  dispatch(r: DispatchRequest): Promise<DispatchState>
  analyze(r: TaskCommand): Promise<Task>
  verify(r: TaskCommand): Promise<Task>
  openSession(id: string): void
  handoff(ws: string, id: string): void
  t: TranslateNS<'perse-dashboard'>
}
type Props = PropsRuntime<'main'> &
  PropsStore<ReturnType<typeof createDashboardStore>> &
  Injected
const statuses: TaskStatus[] = [
  'triage',
  'needs-info',
  'todo',
  'in-progress',
  'blocked',
  'in-review',
  'done',
]
export function DashboardIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  )
}
export function Dashboard(props: Props) {
  const { t } = props
  const resource = props.useResource<'perse-dashboard'>(
    'dsh-resource://perse-dashboard/board',
  )
  const sessionState = props.useSessions((s) => s),
    workspaceState = props.useWorkspaces((s) => s),
    agentState = props.useSessionStatus((s) => s)
  const { workspaceId, query, tab, archived, selected } = props.useStore(
    (s) => s,
  )
  const { setWorkspaceId, setQuery, setTab, setArchived, setSelected } =
    props.actions
  const [creating, setCreating] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [budget, setBudget] = useState('10'),
    [detailTab, setDetailTab] = useState('overview'),
    [createDirty, setCreateDirty] = useState(false),
    [discard, setDiscard] = useState(false),
    [discardTarget, setDiscardTarget] = useState<'create' | 'detail'>('create'),
    [dirtyParts, setDirtyParts] = useState({ editor: false, evidence: false })
  const lastGood = useRef<DashboardSnapshot>()
  const pendingNavigation = useRef<(() => void) | null>(null)
  const invalid = resource.value !== undefined && !validSnapshot(resource.value)
  if (validSnapshot(resource.value)) lastGood.current = resource.value
  const snapshot = lastGood.current,
    commandsAvailable =
      !invalid &&
      resource.status !== 'failed' &&
      resource.status !== 'loading' &&
      snapshot?.capabilities?.update !== false,
    workspaces = workspaceState.items,
    workspace = workspaces.find((w) => w.workspaceId === workspaceId)
  const phaseSessions = new Set(
    snapshot?.tasks
      .flatMap((t) => [t.analysisSessionId, t.reviewSessionId])
      .filter(Boolean),
  )
  const sessions = sessionState.ids
    .map((id) => sessionState.byId[id])
    .filter((s) => !workspace || workspace.sessionIds.includes(s.id))
  const tasks = (snapshot?.tasks ?? []).filter(
    (task) =>
      (!workspaceId || task.workspaceId === workspaceId) &&
      (archived || !task.archived) &&
      `${task.title} ${task.description}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  )
  const attention = sessions.flatMap((session) => {
    const key = attentionKey(agentState.get(session.id))
    return key ? [{ session, key }] : []
  })
  const taskAttention = (item: Task) =>
    activeTaskSessions(item).flatMap((id) => {
      const key = attentionKey(agentState.get(id as never))
      return key ? [{ id, key }] : []
    })
  const task = snapshot?.tasks.find(
      (v) =>
        v.id === selected && (!workspaceId || v.workspaceId === workspaceId),
    ),
    running = sessions.filter(
      (s) => agentState.get(s.id)?.running ?? s.running,
    ).length
  const tokens = sessions.reduce((sum, s) => {
    const u = s.projectionValues?.tokenUsage
    return sum + (u ? Object.values(u).reduce((a, b) => a + b, 0) : 0)
  }, 0)
  const linkedRunning =
    !!task &&
    [task.sessionId, task.analysisSessionId, task.reviewSessionId].some(
      (id) =>
        id &&
        (agentState.get(id as never)?.running ??
          sessionState.byId[id as never]?.running),
    )
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await fn()
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return false
    } finally {
      setBusy(false)
    }
  }
  const mutation = (
    task: Task,
    change: Omit<UpdateRequest, 'id' | 'requestId' | 'expectedVersion'>,
  ) =>
    act(() => {
      if (!commandsAvailable) throw new Error(t('partial'))
      return props.update({
        ...change,
        id: task.id,
        expectedVersion: task.version,
        requestId: crypto.randomUUID(),
      })
    })
  const dispatch = snapshot?.dispatch
  const ownsQueue =
    !!workspace && dispatch?.workspaceId === workspace.workspaceId
  const queueActive = !!dispatch?.enabled && ownsQueue
  const otherQueueActive = !!dispatch?.enabled && !ownsQueue
  const queueAttention =
    ownsQueue && dispatch?.activeSessionId
      ? attentionKey(agentState.get(dispatch.activeSessionId as never))
      : undefined
  const validBudget =
    /^\d+$/.test(budget) && Number(budget) >= 1 && Number(budget) <= 100
  useEffect(() => {
    if (ownsQueue && dispatch) setBudget(String(dispatch.maxTasks))
  }, [ownsQueue, dispatch?.maxTasks])
  useEffect(() => {
    setDetailTab('overview')
    setDirtyParts({ editor: false, evidence: false })
    setError('')
  }, [selected])
  const navigate = (next: () => void) => {
    if (dirtyParts.editor || dirtyParts.evidence) {
      pendingNavigation.current = next
      setDiscardTarget('detail')
      setDiscard(true)
    } else {
      setSelected(null)
      next()
    }
  }
  const openSession = (id: string) => navigate(() => props.openSession(id))
  const handoff = (ws: string, id: string) =>
    navigate(() => props.handoff(ws, id))
  const closeCreate = () => {
    if (!busy) {
      setDiscardTarget('create')
      createDirty ? setDiscard(true) : setCreating(false)
    }
  }
  const closeDetail = () => {
    if (!busy) {
      pendingNavigation.current = null
      setDiscardTarget('detail')
      dirtyParts.editor || dirtyParts.evidence
        ? setDiscard(true)
        : setSelected(null)
    }
  }
  const phase = (item: Task): Key => {
    const pending = taskAttention(item)[0]
    if (pending) return pending.key
    const currentPhases = activeTaskSessions(item)
    if (
      item.analysisSessionId &&
      currentPhases.includes(item.analysisSessionId) &&
      agentState.get(item.analysisSessionId as never)?.running
    )
      return 'analyzing'
    if (
      item.reviewSessionId &&
      currentPhases.includes(item.reviewSessionId) &&
      agentState.get(item.reviewSessionId as never)?.running
    )
      return 'reviewing'
    if (
      item.sessionId &&
      currentPhases.includes(item.sessionId) &&
      agentState.get(item.sessionId as never)?.running
    )
      return 'executing'
    return item.status
  }
  const sessionTitle = (item: Task) => {
    const id = item.sessionId ?? item.assignee
    return id
      ? (sessionState.byId[id as never]?.displayTitle ?? t('unavailable'))
      : t('queue')
  }
  const detailMessage =
    error ||
    (resource.status === 'failed'
      ? t('failed')
      : invalid
        ? t('incompatible')
        : snapshot?.capabilities?.update === false
          ? t('partial')
          : '')
  const detailError = detailMessage && (
    <div role="alert" className="pd-banner">
      {detailMessage}
    </div>
  )
  return (
    <main className="perse-dashboard" aria-label={t('nav')}>
      <header className="pd-header">
        <div>
          <span className="pd-eyebrow">PERSEVERE / DSH</span>
          <h1>{t('nav')}</h1>
          <p className="pd-muted">{t('subtitle')}</p>
        </div>
        <div className="pd-header-actions">
          <span className="pd-host">
            <i className={`pd-dot ${commandsAvailable ? 'is-live' : ''}`} />
            {t('host')}
          </span>
          <button
            className="pd-primary"
            onClick={() => {
              setCreateDirty(false)
              setCreating(true)
            }}
            disabled={!workspaces.length || !commandsAvailable}
          >
            <span aria-hidden="true">＋</span> {t('newTask')}
          </button>
        </div>
      </header>
      {attention.length > 0 && (
        <section
          className="pd-attention"
          role="alert"
          aria-label={t('attention')}
        >
          <strong>
            {t('attention')} · {attention.length}
          </strong>
          <p>{t('attentionHelp')}</p>
          <div className="pd-actions">
            {attention.map(({ session, key }) => (
              <button key={session.id} onClick={() => openSession(session.id)}>
                {t(key)} · {session.displayTitle} ↗
              </button>
            ))}
          </div>
        </section>
      )}
      <section className="pd-stats" aria-label={t('overview')}>
        {[
          [t('total'), tasks.length, '▦'],
          [t('active'), running, '◉'],
          [t('attention'), attention.length, '!'],
          [
            t('review'),
            tasks.filter((item) => item.status === 'in-review').length,
            '✓',
          ],
          [
            t('tokens'),
            new Intl.NumberFormat(undefined, {
              notation: 'compact',
              maximumFractionDigits: 1,
            }).format(tokens),
            '↗',
          ],
        ].map(([label, value, icon]) => (
          <div
            className={`pd-stat ${label === t('attention') && attention.length ? 'is-attention' : ''}`}
            key={label}
          >
            <div>
              <span>{label}</span>
              <span className="pd-stat-icon" aria-hidden="true">
                {icon}
              </span>
            </div>
            <strong
              title={
                label === t('tokens') ? tokens.toLocaleString() : undefined
              }
            >
              {value}
            </strong>
          </div>
        ))}
      </section>
      {resource.status === 'loading' && !snapshot && !invalid && (
        <p role="status" className="pd-empty">
          {t('loading')}
        </p>
      )}
      {resource.status === 'failed' && (
        <div role="alert" className="pd-banner">
          {t('failed')}
        </div>
      )}
      {invalid && (
        <div role="alert" className="pd-banner">
          {t('incompatible')}
        </div>
      )}
      {snapshot?.capabilities?.update === false && (
        <div role="status" className="pd-banner">
          {t('partial')}
        </div>
      )}
      {!task && !creating && error && (
        <div role="alert" className="pd-banner">
          {error}
        </div>
      )}
      {dispatch?.error && (
        <div className="pd-banner" role="status">
          {t('dispatchError')}: {dispatch.error}
        </div>
      )}
      <div className="pd-toolbar">
        <div className="pd-segments" role="group" aria-label={t('view')}>
          {(['board', 'list', 'sessions'] as const).map((v) => (
            <button key={v} aria-pressed={tab === v} onClick={() => setTab(v)}>
              {t(
                v === 'board'
                  ? 'board'
                  : v === 'list'
                    ? 'taskList'
                    : 'sessions',
              )}
            </button>
          ))}
        </div>
        <select
          aria-label={t('all')}
          value={workspaceId}
          onChange={(e) => setWorkspaceId(e.target.value)}
        >
          <option value="">{t('all')}</option>
          {workspaces.map((w) => (
            <option key={w.workspaceId} value={w.workspaceId}>
              {w.title}
            </option>
          ))}
        </select>
        <div className="pd-search">
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            aria-label={t('search')}
            placeholder={t('search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <label className="pd-check pd-filter-check">
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />
          {t('showArchived')}
        </label>
      </div>
      <section className="pd-automation" aria-label={t('automation')}>
        <div className="pd-automation-summary">
          <span
            className={`pd-status-icon ${queueAttention ? 'is-attention' : queueActive ? 'is-live' : ''}`}
            aria-hidden="true"
          >
            ↻
          </span>
          <div>
            <strong>{t('automation')}</strong>
            <p className="pd-muted">
              {!workspace
                ? t('chooseWorkspace')
                : otherQueueActive
                  ? t('otherQueue')
                  : queueActive
                    ? `${t(queueAttention ?? 'processing')} · ${dispatch?.processed}/${dispatch?.maxTasks}`
                    : t('automationHelp')}
            </p>
          </div>
        </div>
        {workspace && (
          <div className="pd-automation-actions">
            <label className="pd-budget">
              {t('budget')}
              <input
                aria-label={t('budget')}
                type="number"
                min={1}
                max={100}
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                disabled={queueActive || otherQueueActive}
                aria-invalid={!validBudget}
              />
            </label>
            <button
              disabled={
                busy || !commandsAvailable || otherQueueActive || !validBudget
              }
              onClick={() =>
                act(() =>
                  props.dispatch({
                    workspaceId: workspace.workspaceId,
                    enabled: !queueActive,
                    maxTasks: Number(budget),
                  }),
                )
              }
            >
              {t(queueActive ? 'stop' : 'auto')}
            </button>
            <button
              className={queueActive ? '' : 'pd-primary'}
              disabled={
                busy || !commandsAvailable || otherQueueActive || !validBudget
              }
              onClick={() =>
                act(() =>
                  props.dispatch({
                    workspaceId: workspace.workspaceId,
                    enabled: !(queueActive && dispatch?.watch),
                    watch: true,
                    maxTasks: Number(budget),
                  }),
                )
              }
            >
              {t(queueActive && dispatch?.watch ? 'pauseWatch' : 'watch')}
            </button>
          </div>
        )}
      </section>
      <PermissionSettings
        t={t}
        loadPermissions={props.loadPermissions}
        savePermissionDefault={props.savePermissionDefault}
      />
      {tab === 'board' ? (
        <div className="pd-layout">
          <div className="pd-columns" aria-label={t('board')}>
            {statuses.map((status) => (
              <section
                className="pd-column"
                key={status}
                aria-label={t(status)}
                data-status={status}
              >
                <h2>
                  <span>
                    <i className="pd-dot" />
                    {t(status)}
                  </span>
                  <span className="pd-count">
                    {tasks.filter((item) => item.status === status).length}
                  </span>
                </h2>
                <div className="pd-column-cards">
                  {tasks
                    .filter((item) => item.status === status)
                    .map((item) => (
                      <button
                        className={`pd-card ${taskAttention(item).length ? 'is-attention' : ''}`}
                        key={item.id}
                        aria-pressed={selected === item.id}
                        onClick={() => setSelected(item.id)}
                      >
                        <span className="pd-card-meta">
                          <span
                            className={`pd-priority priority-${item.priority}`}
                          >
                            {t(
                              (['low', 'normal', 'high'] as Key[])[
                                item.priority
                              ]!,
                            )}
                          </span>
                          <code>{item.id.slice(0, 8)}</code>
                        </span>
                        <strong>{item.title}</strong>
                        <span className="pd-card-description">
                          {item.description || t('noDescription')}
                        </span>
                        <span className="pd-card-tags">
                          <span
                            className={`pd-badge ${taskAttention(item).length ? 'is-attention' : ''}`}
                          >
                            {t(phase(item))}
                          </span>
                          {item.needsManual && (
                            <span className="pd-badge">{t('manual')}</span>
                          )}
                        </span>
                        <span className="pd-progress" aria-hidden="true">
                          <span
                            style={{
                              width: `${item.criteria.length ? (item.checked.filter(Boolean).length / item.criteria.length) * 100 : 0}%`,
                            }}
                          />
                        </span>
                        <span className="pd-card-meta">
                          <small title={sessionTitle(item)}>
                            {sessionTitle(item)}
                          </small>
                          <span>
                            {item.checked.filter(Boolean).length}/
                            {item.criteria.length}
                          </span>
                        </span>
                      </button>
                    ))}
                </div>
                {!tasks.some((item) => item.status === status) && (
                  <p className="pd-column-empty">—</p>
                )}
              </section>
            ))}
          </div>
          <p className="pd-scroll-hint">{t('boardHint')}</p>
        </div>
      ) : tab === 'list' ? (
        <div className="pd-table-wrap">
          <table className="pd-list">
            <thead>
              <tr>
                <th>{t('title')}</th>
                <th>{t('status')}</th>
                <th>{t('assignee')}</th>
                <th>{t('criteriaProgress')}</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((item) => (
                <tr key={item.id}>
                  <td>
                    <button
                      className="pd-text-button"
                      onClick={() => setSelected(item.id)}
                    >
                      {item.title}
                    </button>
                    <small className="pd-muted">{item.id.slice(0, 8)}</small>
                  </td>
                  <td>
                    <span
                      className={`pd-badge ${taskAttention(item).length ? 'is-attention' : ''}`}
                      data-status={item.status}
                    >
                      {t(phase(item))}
                    </span>
                  </td>
                  <td>{sessionTitle(item)}</td>
                  <td>
                    {item.checked.filter(Boolean).length}/{item.criteria.length}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="pd-table-wrap">
          <table className="pd-list">
            <thead>
              <tr>
                <th>{t('sessions')}</th>
                <th>{t('sessionState')}</th>
                <th>{t('updated')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sessions
                .filter((s) =>
                  s.displayTitle.toLowerCase().includes(query.toLowerCase()),
                )
                .map((s) => {
                  const state = agentState.get(s.id)
                  return (
                    <tr key={s.id}>
                      <td>
                        {s.displayTitle}
                        <div className="pd-muted">{s.cwd}</div>
                      </td>
                      <td>
                        <span
                          className={`pd-badge ${attentionKey(state) ? 'is-attention' : ''}`}
                        >
                          {t(
                            attentionKey(state) ??
                              ((state?.running ?? s.running)
                                ? 'running'
                                : 'idle'),
                          )}
                        </span>
                      </td>
                      <td>{new Date(s.updatedAt).toLocaleString()}</td>
                      <td>
                        <button onClick={() => openSession(s.id)}>
                          {t('openSession')}
                        </button>
                      </td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </div>
      )}
      {snapshot && tab !== 'sessions' && !tasks.length && (
        <div className="pd-empty">
          <DashboardIcon />
          <h3>{t(query ? 'filteredEmpty' : 'empty')}</h3>
          <p>{t(query ? 'filterHelp' : 'createHelp')}</p>
          {!query && (
            <button
              disabled={!commandsAvailable || !workspaces.length}
              onClick={() => setCreating(true)}
            >
              {t('firstTask')}
            </button>
          )}
        </div>
      )}
      {tab === 'sessions' && !sessions.length && (
        <p className="pd-empty">{t('noSessions')}</p>
      )}
      {!workspaces.length && <p className="pd-empty">{t('noWorkspace')}</p>}
      <footer className="pd-footer">
        <span>
          <i className={`pd-dot ${commandsAvailable ? 'is-live' : ''}`} />
          {t('host')}
        </span>
        <span>{t('brand')}</span>
      </footer>
      {task && !creating && (
        <Dialog
          className="pd-detail"
          title={task.title}
          description={`${t(task.status)} · ${task.id.slice(0, 8)} · ${t('version')} ${task.version}`}
          closeLabel={t('close')}
          onClose={closeDetail}
          footer={
            <>
              {' '}
              <div className="pd-actions">
                {['todo', 'triage', 'needs-info', 'blocked'].includes(
                  task.status,
                ) && (
                  <button
                    disabled={
                      busy ||
                      linkedRunning ||
                      task.archived ||
                      !commandsAvailable ||
                      !!(
                        task.analysisSessionId &&
                        agentState.get(task.analysisSessionId as never)?.running
                      )
                    }
                    onClick={() =>
                      act(() =>
                        props.analyze({
                          id: task.id,
                          expectedVersion: task.version,
                          requestId: crypto.randomUUID(),
                        }),
                      )
                    }
                  >
                    {t('analyze')}
                  </button>
                )}
                {task.status === 'in-review' &&
                  task.completionPolicy?.mode !== 'manual' && (
                    <button
                      disabled={busy || task.archived || !commandsAvailable}
                      onClick={() =>
                        act(() =>
                          props.verify({
                            id: task.id,
                            expectedVersion: task.version,
                            requestId: crypto.randomUUID(),
                          }),
                        )
                      }
                    >
                      {t('verify')}
                    </button>
                  )}
                <button
                  disabled={
                    busy ||
                    linkedRunning ||
                    !commandsAvailable ||
                    task.archived ||
                    task.status !== 'todo' ||
                    !!task.assignee
                  }
                  onClick={() => handoff(task.workspaceId, task.id)}
                >
                  {t('handoff')}
                </button>
                {(task.sessionId ?? task.assignee) && (
                  <button
                    disabled={
                      !sessionState.byId[
                        (task.sessionId ?? task.assignee) as never
                      ]
                    }
                    onClick={() =>
                      openSession((task.sessionId ?? task.assignee)!)
                    }
                  >
                    {t('openSession')}
                  </button>
                )}
                {task.status === 'in-review' && (
                  <button
                    className="pd-primary"
                    disabled={
                      busy ||
                      linkedRunning ||
                      !commandsAvailable ||
                      task.archived ||
                      !task.evidence ||
                      !task.checked.every(Boolean)
                    }
                    onClick={() => mutation(task, { action: 'accept' })}
                  >
                    {t('accept')}
                  </button>
                )}
                {task.status === 'done' && !task.archived && (
                  <button
                    disabled={busy || linkedRunning || !commandsAvailable}
                    onClick={() =>
                      mutation(task, { action: 'move', status: 'todo' })
                    }
                  >
                    {t('requeue')}
                  </button>
                )}
                <button
                  disabled={
                    busy ||
                    linkedRunning ||
                    !commandsAvailable ||
                    task.status === 'in-progress'
                  }
                  onClick={() =>
                    mutation(task, {
                      action: task.archived ? 'restore' : 'archive',
                    })
                  }
                >
                  {t(task.archived ? 'restore' : 'archive')}
                </button>
              </div>
            </>
          }
        >
          {detailError}
          {taskAttention(task).map(({ id, key }) => (
            <div role="alert" className="pd-attention" key={id}>
              <strong>{t(key)}</strong>
              <p>{t('attentionHelp')}</p>
              <button onClick={() => openSession(id)}>
                {t('openPendingSession')} ↗
              </button>
            </div>
          ))}
          {task.completion && (
            <div className="pd-receipt">
              <span className="pd-status-icon is-live">✓</span>
              <div>
                <strong>
                  {t('completionRecord')}:{' '}
                  {task.completion.kind === 'human'
                    ? t('manual')
                    : t('automaticDone')}
                </strong>
                <p>
                  {new Date(task.completion.time).toLocaleString()} ·{' '}
                  {task.completion.ruleVersion} ·{' '}
                  {task.checked.filter(Boolean).length}/{task.criteria.length}
                </p>
              </div>
            </div>
          )}
          <DetailTabs
            value={detailTab}
            change={setDetailTab}
            labels={[
              ['overview', t('overview')],
              ['analysis', t('analysisReview')],
              ['properties', t('properties')],
              ['activity', t('audit')],
            ]}
          />
          <section
            role="tabpanel"
            id="pd-panel-overview"
            aria-labelledby="pd-tab-overview"
            hidden={detailTab !== 'overview'}
          >
            <div className="pd-phase-grid">
              {(
                [
                  [t('analysis'), task.analysisSessionId],
                  [t('execution'), task.sessionId ?? task.assignee],
                  [t('reviewResult'), task.reviewSessionId],
                ] as const
              ).map(([label, id]) => (
                <div className="pd-phase-card" key={label}>
                  <span className="pd-muted">{label}</span>
                  <strong>
                    {id
                      ? (sessionState.byId[id as never]?.displayTitle ??
                        t('unavailable'))
                      : t('notStarted')}
                  </strong>
                  {id &&
                    activeTaskSessions(task).includes(id) &&
                    attentionKey(agentState.get(id as never)) && (
                      <span className="pd-badge is-attention">
                        {t(attentionKey(agentState.get(id as never))!)}
                      </span>
                    )}
                  {id && (
                    <button onClick={() => openSession(id)}>
                      {t(
                        label === t('analysis')
                          ? 'openAnalysis'
                          : label === t('reviewResult')
                            ? 'openReview'
                            : 'executionSession',
                      )}{' '}
                      ↗
                    </button>
                  )}
                </div>
              ))}
            </div>
            <section className="pd-section">
              <h3>{t('description')}</h3>{' '}
              <p className="pd-muted" style={{ whiteSpace: 'pre-wrap' }}>
                {task.description}
              </p>
            </section>
            <section className="pd-section">
              <h3>
                {t('criteriaProgress')}{' '}
                <span className="pd-muted">
                  {task.checked.filter(Boolean).length}/{task.criteria.length}
                </span>
              </h3>{' '}
              {task.criteria.map((criterion, i) => (
                <label key={i} className="pd-check">
                  <input
                    type="checkbox"
                    checked={task.checked[i]}
                    disabled={
                      busy ||
                      linkedRunning ||
                      !commandsAvailable ||
                      task.archived ||
                      task.status !== 'in-review'
                    }
                    onChange={(e) =>
                      mutation(task, {
                        action: 'edit',
                        checked: task.checked.map((v, n) =>
                          n === i ? e.target.checked : v,
                        ),
                      })
                    }
                  />
                  {criterion}
                </label>
              ))}
              <Evidence
                key={`evidence:${task.id}`}
                task={task}
                t={t}
                busy={busy || linkedRunning || !commandsAvailable}
                dirty={(value) =>
                  setDirtyParts((old) =>
                    old.evidence === value ? old : { ...old, evidence: value },
                  )
                }
                save={(evidence, version) =>
                  mutation({ ...task, version }, { action: 'edit', evidence })
                }
              />
            </section>
          </section>
          <section
            role="tabpanel"
            id="pd-panel-analysis"
            aria-labelledby="pd-tab-analysis"
            hidden={detailTab !== 'analysis'}
          >
            {' '}
            {task.analysis && (
              <section aria-label={t('analysis')}>
                <h3>{t('analysis')}</h3>
                <p>{task.analysis.summary}</p>
                <p>
                  {task.analysis.risk} · {task.analysis.route}
                </p>
                <ol>
                  {task.analysis.plan.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
                {task.analysis.questions.map((q, i) => (
                  <p key={i}>{q}</p>
                ))}
              </section>
            )}
            {task.automationNote && (
              <div role="status" className="pd-banner">
                {task.automationNote}
              </div>
            )}
            {task.review && (
              <section aria-label={t('reviewResult')}>
                <h3>
                  {t('reviewResult')}: {task.review.verdict}
                </h3>
                <p>{task.review.evidence}</p>
                {task.review.results.map((r, i) => (
                  <p key={i}>
                    {r.criterion + 1}. {r.passed ? '✓' : '✗'} {r.evidence}
                  </p>
                ))}
              </section>
            )}
            {!task.analysis && !task.review && (
              <p className="pd-empty">{t('notStarted')}</p>
            )}
          </section>
          <section
            role="tabpanel"
            id="pd-panel-properties"
            aria-labelledby="pd-tab-properties"
            hidden={detailTab !== 'properties'}
          >
            {' '}
            {task.completionPolicy && (
              <details className="pd-policy">
                <summary>
                  {t('completionMode')}: {t(task.completionPolicy.mode)}
                </summary>
                <p className="pd-muted">{t('completionHelp')}</p>
                <h3>{t('completionInstructions')}</h3>
                <pre>{task.completionPolicy.instructions || '—'}</pre>
                <h3>{t('machineChecks')}</h3>
                {task.completionPolicy.checks.map((c, i) => (
                  <div key={i}>
                    <p>
                      {c.criterion + 1}. {c.path} · {c.kind}
                    </p>
                    <pre>{c.expected}</pre>
                  </div>
                ))}
                {task.completion?.checks?.map((r, i) => (
                  <p key={i}>
                    {r.criterion + 1}. {r.passed ? '✓' : '✗'} {r.evidence}
                  </p>
                ))}
              </details>
            )}
            {['todo', 'triage', 'needs-info'].includes(task.status) &&
              !task.archived && (
                <TaskEditor
                  key={`editor:${task.id}`}
                  task={task}
                  t={t}
                  busy={busy || linkedRunning || !commandsAvailable}
                  dirty={(value) =>
                    setDirtyParts((old) =>
                      old.editor === value ? old : { ...old, editor: value },
                    )
                  }
                  save={(change, version) =>
                    mutation(
                      { ...task, version },
                      { action: 'edit', ...change },
                    )
                  }
                />
              )}
            <div className="pd-properties-grid">
              {' '}
              <label className="pd-field">
                {t('assignee')}
                <select
                  aria-label={t('assignee')}
                  value={task.assignee ?? ''}
                  disabled={
                    busy ||
                    linkedRunning ||
                    !commandsAvailable ||
                    task.archived ||
                    task.status === 'in-progress' ||
                    task.status === 'done'
                  }
                  onChange={(e) =>
                    mutation(task, {
                      action: 'assign',
                      assignee: e.target.value || null,
                    })
                  }
                >
                  <option value="">{t('queue')}</option>
                  {sessionState.ids
                    .filter((id) => !phaseSessions.has(id))
                    .map((id) => sessionState.byId[id])
                    .filter((s) =>
                      workspaces
                        .find((w) => w.workspaceId === task.workspaceId)
                        ?.sessionIds.includes(s.id),
                    )
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.displayTitle}
                      </option>
                    ))}
                </select>
              </label>
              <p className="pd-muted">{t('assignmentHelp')}</p>
              <label className="pd-field">
                {t('move')}
                <select
                  value={task.status}
                  disabled={
                    busy ||
                    linkedRunning ||
                    !commandsAvailable ||
                    task.archived ||
                    task.status === 'done'
                  }
                  onChange={(e) =>
                    mutation(task, {
                      action: 'move',
                      status: e.target.value as TaskStatus,
                    })
                  }
                >
                  {statuses.map((s) => (
                    <option
                      key={s}
                      value={s}
                      disabled={s === 'done' || s === 'in-progress'}
                    >
                      {t(s)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>
          <section
            role="tabpanel"
            id="pd-panel-activity"
            aria-labelledby="pd-tab-activity"
            hidden={detailTab !== 'activity'}
          >
            {' '}
            <h3 className="pd-muted">{t('audit')}</h3>
            {snapshot?.ledger
              .filter((a) => a.taskId === task.id)
              .slice(-30)
              .reverse()
              .map((a) => (
                <div className="pd-audit" key={a.seq}>
                  {a.action} ·{' '}
                  {a.actor === 'human' ? t('brand') : a.actor.slice(0, 16)}
                  <br />
                  {new Date(a.time).toLocaleString()}
                </div>
              ))}
          </section>
        </Dialog>
      )}
      {creating && (
        <Dialog
          className="pd-create-dialog"
          title={t('newTask')}
          description={t('createHelp')}
          closeLabel={t('cancel')}
          onClose={closeCreate}
        >
          {detailError}
          <CreateForm
            key={workspaceId}
            t={t}
            workspaces={workspaces}
            sessions={sessionState.ids
              .filter((id) => !phaseSessions.has(id))
              .map((id) => sessionState.byId[id])}
            selectedWorkspace={workspaceId}
            busy={busy}
            close={closeCreate}
            dirty={setCreateDirty}
            submit={(r) =>
              act(async () => {
                const created = await props.create(r)
                setCreating(false)
                setCreateDirty(false)
                setSelected(created.id)
              })
            }
          />
        </Dialog>
      )}
      {discard && (
        <Dialog
          alert
          className="pd-confirm-dialog"
          title={t('discardTitle')}
          description={t('discardHelp')}
          closeLabel={t('keepEditing')}
          onClose={() => {
            pendingNavigation.current = null
            setDiscard(false)
          }}
          footer={
            <>
              <button
                data-dialog-autofocus
                onClick={() => {
                  pendingNavigation.current = null
                  setDiscard(false)
                }}
              >
                {t('keepEditing')}
              </button>
              <button
                className="pd-danger"
                onClick={() => {
                  setDiscard(false)
                  if (discardTarget === 'create') {
                    setCreating(false)
                    setCreateDirty(false)
                  } else {
                    setSelected(null)
                    setDirtyParts({ editor: false, evidence: false })
                    const next = pendingNavigation.current
                    pendingNavigation.current = null
                    next?.()
                  }
                }}
              >
                {t('discard')}
              </button>
            </>
          }
        >
          <p>{t('discardHelp')}</p>
        </Dialog>
      )}
    </main>
  )
}
function Evidence({
  task,
  t,
  busy,
  save,
  dirty: reportDirty,
}: {
  task: Task
  t: Injected['t']
  busy: boolean
  save: (value: string, version: number) => Promise<boolean>
  dirty: (value: boolean) => void
}) {
  const [value, setValue] = useState(task.evidence),
    [baseline, setBaseline] = useState(task.evidence),
    [version, setVersion] = useState(task.version)
  const dirty = value !== baseline,
    stale = dirty && version !== task.version
  useLayoutEffect(() => {
    reportDirty(dirty)
  }, [dirty, reportDirty])
  useEffect(() => {
    if (!dirty && task.version !== version) {
      setValue(task.evidence)
      setBaseline(task.evidence)
      setVersion(task.version)
    }
  }, [task.evidence, task.version, version, dirty])
  const reload = () => {
    setValue(task.evidence)
    setBaseline(task.evidence)
    setVersion(task.version)
  }
  return (
    <div className="pd-evidence-editor">
      {stale && (
        <div className="pd-banner" role="status">
          {t('changed')} <button onClick={reload}>{t('reloadLatest')}</button>
        </div>
      )}
      <label className="pd-field">
        {t('evidence')}
        <textarea
          aria-label={t('evidence')}
          rows={5}
          disabled={
            busy ||
            task.status === 'done' ||
            task.status === 'in-progress' ||
            task.archived
          }
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </label>
      {!['done', 'in-progress'].includes(task.status) && (
        <button
          disabled={busy || !dirty || stale || task.archived}
          onClick={async () => {
            if (await save(value, version)) setBaseline(value)
          }}
        >
          {t('save')}
        </button>
      )}
    </div>
  )
}
function CreateForm({
  t,
  workspaces,
  sessions,
  selectedWorkspace,
  busy,
  close,
  dirty,
  submit,
}: {
  t: Injected['t']
  workspaces: readonly {
    workspaceId: string
    title: string
    sessionIds: readonly string[]
  }[]
  sessions: readonly { id: string; displayTitle: string }[]
  selectedWorkspace: string
  busy: boolean
  close: () => void
  dirty: (value: boolean) => void
  submit: (r: CreateRequest) => void
}) {
  const [ws, setWs] = useState(
      selectedWorkspace || workspaces[0]?.workspaceId || '',
    ),
    [title, setTitle] = useState(''),
    [description, setDescription] = useState(''),
    [criteria, setCriteria] = useState(''),
    [priority, setPriority] = useState(1),
    [assignee, setAssignee] = useState(''),
    [intake, setIntake] = useState(true),
    [needsManual, setNeedsManual] = useState(false),
    [completionPolicy, setCompletionPolicy] = useState<CompletionPolicy>({
      mode: 'reviewed',
      instructions: '',
      checks: [],
    })
  useLayoutEffect(() => {
    dirty(
      !!(
        title.trim() ||
        description.trim() ||
        criteria.trim() ||
        completionPolicy.instructions.trim() ||
        completionPolicy.checks.length ||
        completionPolicy.mode !== 'reviewed' ||
        priority !== 1 ||
        assignee ||
        !intake ||
        needsManual ||
        ws !== (selectedWorkspace || workspaces[0]?.workspaceId || '')
      ),
    )
  }, [
    title,
    description,
    criteria,
    completionPolicy,
    priority,
    assignee,
    intake,
    needsManual,
    dirty,
    ws,
  ])
  return (
    <form
      className="pd-create"
      onSubmit={(e) => {
        e.preventDefault()
        submit({
          requestId: crypto.randomUUID(),
          workspaceId: ws,
          title,
          description,
          criteria: criteria
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean),
          priority,
          assignee: assignee || null,
          intake,
          needsManual,
          completionPolicy,
        })
      }}
    >
      <OptionGroup
        label={t('all')}
        value={ws}
        change={(id) => {
          setWs(id)
          setAssignee('')
        }}
        options={workspaces.map((w) => ({
          value: w.workspaceId,
          text: w.title,
        }))}
      />
      <label className="pd-field pd-span">
        {t('title')}
        <input
          required
          data-dialog-autofocus
          maxLength={300}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label className="pd-field pd-span">
        {t('description')}
        <textarea
          value={description}
          maxLength={12000}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <label className="pd-field pd-span">
        {t('criteria')}
        <textarea
          required={!intake}
          value={criteria}
          onChange={(e) => setCriteria(e.target.value)}
        />
      </label>
      <OptionGroup
        label={t('priority')}
        value={priority}
        change={setPriority}
        options={(['low', 'normal', 'high'] as const).map((p, i) => ({
          value: i,
          text: t(p),
        }))}
      />
      <OptionGroup
        label={t('assignee')}
        value={assignee}
        change={setAssignee}
        options={[
          { value: '', text: t('queue') },
          ...sessions
            .filter((s) =>
              workspaces
                .find((w) => w.workspaceId === ws)
                ?.sessionIds.includes(s.id),
            )
            .map((s) => ({ value: s.id, text: s.displayTitle })),
        ]}
      />
      <label className="pd-check">
        <input
          type="checkbox"
          checked={intake}
          onChange={(e) => setIntake(e.target.checked)}
        />
        {t('intake')}
      </label>
      <p className="pd-muted">{t('noCriteria')}</p>
      <label className="pd-check">
        <input
          type="checkbox"
          checked={needsManual}
          onChange={(e) => setNeedsManual(e.target.checked)}
        />
        {t('manualFlag')}
      </label>
      <CompletionEditor
        value={completionPolicy}
        change={setCompletionPolicy}
        t={t}
        disabled={busy}
      />
      <div className="pd-actions">
        <button
          className="pd-primary"
          disabled={busy || !title.trim() || (!intake && !criteria.trim())}
        >
          {t('create')}
        </button>
        <button type="button" onClick={close}>
          {t('cancel')}
        </button>
      </div>
    </form>
  )
}

type EditableTask = Pick<
  Task,
  'title' | 'description' | 'priority' | 'completionPolicy' | 'needsManual'
>
const editable = (task: Task): EditableTask => ({
  title: task.title,
  description: task.description,
  priority: task.priority,
  completionPolicy: task.completionPolicy,
  needsManual: task.needsManual,
})
function TaskEditor({
  task,
  t,
  busy,
  save,
  dirty: reportDirty,
}: {
  task: Task
  t: Injected['t']
  busy: boolean
  save: (change: EditableTask, version: number) => Promise<boolean>
  dirty: (value: boolean) => void
}) {
  const [draft, setDraft] = useState(() => editable(task)),
    [baseline, setBaseline] = useState(() => editable(task)),
    [version, setVersion] = useState(task.version)
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline),
    stale = dirty && version !== task.version
  useLayoutEffect(() => {
    reportDirty(dirty)
  }, [dirty, reportDirty])
  useEffect(() => {
    if (!dirty && version !== task.version) {
      const next = editable(task)
      setDraft(next)
      setBaseline(next)
      setVersion(task.version)
    }
  }, [task, version, dirty])
  const change = <K extends keyof EditableTask>(
    key: K,
    value: EditableTask[K],
  ) => setDraft((old) => ({ ...old, [key]: value }))
  const reload = () => {
    const next = editable(task)
    setDraft(next)
    setBaseline(next)
    setVersion(task.version)
  }
  return (
    <details>
      <summary>{t('edit')}</summary>
      {stale && (
        <div className="pd-banner" role="status">
          {t('changed')} <button onClick={reload}>{t('reloadLatest')}</button>
        </div>
      )}
      <label className="pd-field">
        {t('title')}
        <input
          maxLength={300}
          disabled={busy}
          value={draft.title}
          onChange={(e) => change('title', e.target.value)}
        />
      </label>
      <label className="pd-field">
        {t('description')}
        <textarea
          maxLength={12000}
          disabled={busy}
          value={draft.description}
          onChange={(e) => change('description', e.target.value)}
        />
      </label>
      <label className="pd-field">
        {t('priority')}
        <select
          disabled={busy}
          value={draft.priority}
          onChange={(e) => change('priority', Number(e.target.value))}
        >
          {(['low', 'normal', 'high'] as const).map((v, i) => (
            <option value={i} key={v}>
              {t(v)}
            </option>
          ))}
        </select>
      </label>
      <label className="pd-check">
        <input
          type="checkbox"
          disabled={busy}
          checked={draft.needsManual}
          onChange={(e) => change('needsManual', e.target.checked)}
        />
        {t('manualFlag')}
      </label>
      <CompletionEditor
        value={draft.completionPolicy}
        change={(v) => change('completionPolicy', v)}
        t={t}
        disabled={busy}
      />
      <button
        className="pd-primary"
        disabled={busy || !draft.title.trim() || !dirty || stale}
        onClick={async () => {
          if (await save(draft, version)) setBaseline(draft)
        }}
      >
        {t('save')}
      </button>
    </details>
  )
}
