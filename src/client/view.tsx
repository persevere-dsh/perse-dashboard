/** Pure components: only framework-provided hooks and injected commands. */
import React, { useState, useRef } from 'react'
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
import { validSnapshot } from './validation.ts'
import type {
  CompletionPolicy,
  TaskCommand,
  DashboardSnapshot,
} from '../contract/types.ts'
export interface Injected {
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
    [budget, setBudget] = useState(10)
  const lastGood = useRef<DashboardSnapshot>()
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
  const task = snapshot?.tasks.find((v) => v.id === selected),
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
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
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
  return (
    <main className="perse-dashboard" aria-label={t('nav')}>
      <header className="pd-header">
        <div>
          <div className="pd-muted">{t('brand')}</div>
          <h1>{t('nav')}</h1>
          <div className="pd-muted">{t('subtitle')}</div>
        </div>
        <button
          className="pd-primary"
          onClick={() => setCreating((v) => !v)}
          disabled={!workspaces.length || !commandsAvailable}
        >
          {t('newTask')}
        </button>
      </header>
      <div className="pd-stats">
        {[
          [t('total'), tasks.length],
          [t('active'), running],
          [t('review'), tasks.filter((t) => t.status === 'in-review').length],
          [t('tokens'), tokens.toLocaleString()],
        ].map(([label, value]) => (
          <div className="pd-stat" key={label}>
            <span className="pd-muted">{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      {resource.status === 'loading' && !snapshot && !invalid && (
        <p role="status">{t('loading')}</p>
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
      {error && (
        <div role="alert" className="pd-banner">
          {error}
        </div>
      )}
      {snapshot?.dispatch.error && (
        <div className="pd-banner">
          {t('dispatchError')}: {snapshot.dispatch.error}
        </div>
      )}
      <div className="pd-toolbar">
        <button aria-pressed={tab === 'board'} onClick={() => setTab('board')}>
          {t('board')}
        </button>
        <button
          aria-pressed={tab === 'sessions'}
          onClick={() => setTab('sessions')}
        >
          {t('sessions')}
        </button>
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
        <input
          type="search"
          aria-label={t('search')}
          placeholder={t('search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label className="pd-check">
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />
          {t('showArchived')}
        </label>
      </div>
      {workspace && (
        <div className="pd-toolbar">
          <button
            title={t('autoHint')}
            disabled={busy || !commandsAvailable}
            onClick={() =>
              act(() =>
                props.dispatch({
                  workspaceId: workspace.workspaceId,
                  enabled: !snapshot?.dispatch.enabled,
                }),
              )
            }
          >
            {t(snapshot?.dispatch.enabled ? 'stop' : 'auto')}
          </button>
          <span className="pd-muted">{t('autoHint')}</span>
        </div>
      )}
      {workspace && (
        <div className="pd-toolbar">
          <label>
            {t('budget')}{' '}
            <input
              aria-label={t('budget')}
              type="number"
              min={1}
              max={100}
              value={budget}
              onChange={(e) => setBudget(Number(e.target.value))}
            />
          </label>
          <button
            disabled={busy || !commandsAvailable}
            onClick={() =>
              act(() =>
                props.dispatch({
                  workspaceId: workspace.workspaceId,
                  enabled: !(
                    snapshot?.dispatch.enabled && snapshot.dispatch.watch
                  ),
                  watch: true,
                  maxTasks: budget,
                }),
              )
            }
          >
            {t(
              snapshot?.dispatch.enabled && snapshot.dispatch.watch
                ? 'pauseWatch'
                : 'watch',
            )}
          </button>
          <span className="pd-muted">
            {t('pipelineHelp')} {snapshot?.dispatch.processed ?? 0}/
            {snapshot?.dispatch.maxTasks ?? budget}
          </span>
        </div>
      )}
      {creating && (
        <CreateForm
          key={workspaceId}
          t={t}
          workspaces={workspaces}
          sessions={sessionState.ids
            .filter((id) => !phaseSessions.has(id))
            .map((id) => sessionState.byId[id])}
          selectedWorkspace={workspaceId}
          busy={busy}
          close={() => setCreating(false)}
          submit={(r) =>
            act(async () => {
              const created = await props.create(r)
              setCreating(false)
              setSelected(created.id)
            })
          }
        />
      )}
      {tab === 'board' ? (
        <div className={`pd-layout ${task ? 'pd-selected' : ''}`}>
          <div className="pd-columns">
            {statuses.map((status) => (
              <section
                className="pd-column"
                key={status}
                aria-label={t(status)}
              >
                <h2>
                  {t(status)}
                  <span>{tasks.filter((t) => t.status === status).length}</span>
                </h2>
                {tasks
                  .filter((t) => t.status === status)
                  .map((task) => (
                    <button
                      className="pd-card"
                      key={task.id}
                      aria-pressed={selected === task.id}
                      onClick={() => setSelected(task.id)}
                    >
                      <span className="pd-card-meta">
                        <span>
                          {t(
                            (['low', 'normal', 'high'] as Key[])[
                              task.priority
                            ]!,
                          )}
                        </span>
                        <span>{task.id.slice(0, 8)}</span>
                      </span>
                      <strong>{task.title}</strong>
                      <small>
                        {workspaces.find(
                          (w) => w.workspaceId === task.workspaceId,
                        )?.title ?? t('noWorkspace')}
                      </small>
                      <span className="pd-card-meta" style={{ marginTop: 10 }}>
                        <span>
                          {task.assignee
                            ? (sessionState.byId[task.assignee as never]
                                ?.displayTitle ?? t('unavailable'))
                            : t('queue')}
                        </span>
                        <span>
                          {task.checked.filter(Boolean).length}/
                          {task.criteria.length}
                        </span>
                      </span>
                    </button>
                  ))}
              </section>
            ))}
          </div>
          {task && (
            <aside className="pd-detail">
              <div
                className="pd-actions"
                style={{ justifyContent: 'space-between', marginTop: 0 }}
              >
                <span className="pd-muted">
                  {t('details')} · {t('version')} {task.version}
                </span>
                <button
                  aria-label={t('close')}
                  onClick={() => setSelected(null)}
                >
                  ×
                </button>
              </div>
              <h2>{task.title}</h2>
              {task.completion && (
                <p className="pd-badge">
                  {t('completionRecord')}:{' '}
                  {task.completion.kind === 'human'
                    ? t('manual')
                    : t('automaticDone')}{' '}
                  · {task.completion.ruleVersion}
                </p>
              )}
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

              {['todo', 'triage', 'needs-info'].includes(task.status) &&
                !task.archived && (
                  <TaskEditor
                    key={`editor:${task.id}:${task.version}`}
                    task={task}
                    t={t}
                    busy={busy || linkedRunning || !commandsAvailable}
                    save={(change) =>
                      mutation(task, { action: 'edit', ...change })
                    }
                  />
                )}
              <p className="pd-muted" style={{ whiteSpace: 'pre-wrap' }}>
                {task.description}
              </p>
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
                key={`evidence:${task.id}:${task.version}`}
                task={task}
                t={t}
                busy={busy || linkedRunning || !commandsAvailable}
                save={(evidence) =>
                  mutation(task, { action: 'edit', evidence })
                }
              />
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
                {task.analysisSessionId && (
                  <button
                    onClick={() => props.openSession(task.analysisSessionId!)}
                  >
                    {t('openAnalysis')}
                  </button>
                )}
                {task.reviewSessionId && (
                  <button
                    onClick={() => props.openSession(task.reviewSessionId!)}
                  >
                    {t('openReview')}
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
                  onClick={() => props.handoff(task.workspaceId, task.id)}
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
                      props.openSession((task.sessionId ?? task.assignee)!)
                    }
                  >
                    {t('openSession')}
                  </button>
                )}
                {task.status === 'in-review' && (
                  <button
                    className="pd-primary"
                    disabled={
                      busy || !task.evidence || !task.checked.every(Boolean)
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
              <h3 className="pd-muted">{t('audit')}</h3>
              {snapshot?.ledger
                .filter((a) => a.taskId === task.id)
                .slice(-8)
                .reverse()
                .map((a) => (
                  <div className="pd-audit" key={a.seq}>
                    {a.action} ·{' '}
                    {a.actor === 'human' ? t('brand') : a.actor.slice(0, 16)}
                    <br />
                    {new Date(a.time).toLocaleString()}
                  </div>
                ))}
            </aside>
          )}
        </div>
      ) : (
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
                      <span className="pd-badge">
                        {t(
                          state?.pendingInteraction
                            ? 'waiting'
                            : (state?.running ?? s.running)
                              ? 'running'
                              : 'idle',
                        )}
                      </span>
                    </td>
                    <td>{new Date(s.updatedAt).toLocaleString()}</td>
                    <td>
                      <button onClick={() => props.openSession(s.id)}>
                        {t('openSession')}
                      </button>
                    </td>
                  </tr>
                )
              })}
          </tbody>
        </table>
      )}
      {snapshot && !tasks.length && (
        <p className="pd-empty">{t(query ? 'filteredEmpty' : 'empty')}</p>
      )}
      {!workspaces.length && <p className="pd-empty">{t('noWorkspace')}</p>}
      <footer className="pd-footer">
        {t('host')} · {t('brand')}
      </footer>
    </main>
  )
}
function Evidence({
  task,
  t,
  busy,
  save,
}: {
  task: Task
  t: Injected['t']
  busy: boolean
  save: (value: string) => void
}) {
  const [value, setValue] = useState(task.evidence)
  return (
    <label className="pd-field">
      {t('evidence')}
      <textarea
        disabled={
          task.status === 'done' ||
          task.status === 'in-progress' ||
          task.archived
        }
        aria-label={t('evidence')}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button
        disabled={
          busy ||
          value === task.evidence ||
          task.status === 'done' ||
          task.status === 'in-progress' ||
          task.archived
        }
        onClick={() => save(value)}
      >
        {t('save')}
      </button>
    </label>
  )
}
function CreateForm({
  t,
  workspaces,
  sessions,
  selectedWorkspace,
  busy,
  close,
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
      <h2>{t('newTask')}</h2>
      <p className="pd-muted">{t('createHelp')}</p>
      <label className="pd-field">
        {t('all')}
        <select
          value={ws}
          onChange={(e) => {
            setWs(e.target.value)
            setAssignee('')
          }}
        >
          {workspaces.map((w) => (
            <option key={w.workspaceId} value={w.workspaceId}>
              {w.title}
            </option>
          ))}
        </select>
      </label>
      <label className="pd-field">
        {t('title')}
        <input
          required
          maxLength={300}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label className="pd-field">
        {t('description')}
        <textarea
          value={description}
          maxLength={12000}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <label className="pd-field">
        {t('criteria')}
        <textarea
          required={!intake}
          value={criteria}
          onChange={(e) => setCriteria(e.target.value)}
        />
      </label>
      <label className="pd-field">
        {t('priority')}
        <select
          value={priority}
          onChange={(e) => setPriority(Number(e.target.value))}
        >
          {(['low', 'normal', 'high'] as const).map((p, i) => (
            <option value={i} key={p}>
              {t(p)}
            </option>
          ))}
        </select>
      </label>
      <label className="pd-field">
        {t('assignee')}
        <select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
          <option value="">{t('queue')}</option>
          {sessions
            .filter((s) =>
              workspaces
                .find((w) => w.workspaceId === ws)
                ?.sessionIds.includes(s.id),
            )
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.displayTitle}
              </option>
            ))}
        </select>
      </label>
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

function TaskEditor({
  task,
  t,
  busy,
  save,
}: {
  task: Task
  t: Injected['t']
  busy: boolean
  save: (change: {
    title: string
    description: string
    priority: number
    completionPolicy: CompletionPolicy
    needsManual: boolean
  }) => void
}) {
  const [title, setTitle] = useState(task.title),
    [description, setDescription] = useState(task.description),
    [priority, setPriority] = useState(task.priority),
    [completionPolicy, setCompletionPolicy] = useState(
      task.completionPolicy ?? { mode: 'manual', instructions: '', checks: [] },
    ),
    [needsManual, setNeedsManual] = useState(task.needsManual ?? false)
  return (
    <details>
      <summary>{t('edit')}</summary>
      <label className="pd-field">
        {t('title')}
        <input
          maxLength={300}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label className="pd-field">
        {t('description')}
        <textarea
          maxLength={12000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <label className="pd-field">
        {t('priority')}
        <select
          value={priority}
          onChange={(e) => setPriority(Number(e.target.value))}
        >
          {(['low', 'normal', 'high'] as const).map((p, i) => (
            <option value={i} key={p}>
              {t(p)}
            </option>
          ))}
        </select>
      </label>
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
      <button
        disabled={
          busy ||
          !title.trim() ||
          (title === task.title &&
            description === task.description &&
            priority === task.priority &&
            JSON.stringify(completionPolicy) ===
              JSON.stringify(task.completionPolicy) &&
            needsManual === task.needsManual)
        }
        onClick={() =>
          save({ title, description, priority, completionPolicy, needsManual })
        }
      >
        {t('save')}
      </button>
    </details>
  )
}
