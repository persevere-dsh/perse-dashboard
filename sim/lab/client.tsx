/** Same Dashboard component as the native plugin; synthetic framework transport only. */
import React, { useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { Dashboard } from '../../src/client/view.tsx'
import { CSS } from '../../src/client/style.ts'
import { en, zh } from '../../src/client/locales.ts'
const style = document.createElement('style')
style.textContent = `html,body,#root{height:100%;margin:0;font:14px system-ui} :root{--dsw-alias-label-primary:#152536;--dsw-alias-label-secondary:#536578;--dsw-alias-bg-base:#fff;--dsw-alias-border-l:#d7dfe7;--dsw-alias-button-elevated-fill:#fff;--dsw-alias-interactive-bg-hover:#eef4f7;--dsw-alias-link:#237d75;--dsw-alias-state-business-primary:#237d75;--dsw-specific-sidebar-fill:#f0f3f6;--dsw-alias-state-error-primary:#bd5353}#lab-controls{padding:12px 22px;background:#142939;color:white;display:flex;gap:12px;align-items:center;flex-wrap:wrap}#lab-controls select,#lab-controls button{padding:7px}.perse-dashboard{height:auto;min-height:90%}${CSS}`
document.head.append(style)
function App() {
  const [data, setData] = useState<any>(),
    [status, setStatus] = useState('loading'),
    [fixture, setFixture] = useState<any>(),
    [locale, setLocale] = useState('en'),
    [selection, setSelection] = useState('dense'),
    [notice, setNotice] = useState(''),
    [epoch, setEpoch] = useState(0),
    [local, setLocal] = useState({
      workspaceId: '',
      query: '',
      tab: 'board',
      archived: false,
      selected: null,
    })
  async function refresh() {
    setStatus('loading')
    try {
      const response = await fetch('/data')
      if (!response.ok) throw Error(`HTTP ${response.status}`)
      setData(await response.json())
      setStatus('ready')
    } catch (e) {
      setStatus('failed')
    }
  }
  useEffect(() => {
    fetch('/fixtures')
      .then((r) => r.json())
      .then(setFixture)
  }, [])
  useEffect(() => {
    let live = true
    void refresh()
    const stream = new EventSource('/events')
    stream.onmessage = (e) => {
      if (!live) return
      const value = JSON.parse(e.data)
      if (
        value.scenario === 'first-load' ||
        ['authentication', 'network', 'server-unavailable'].includes(
          value.scenario,
        )
      )
        return
      setData((old) =>
        old &&
        old.generation === value.generation &&
        old.sequence > value.sequence
          ? old
          : value,
      )
      setStatus('ready')
    }
    stream.onerror = () => {
      if (live) setStatus('failed')
    }
    return () => {
      live = false
      stream.close()
    }
  }, [epoch])
  const control = async (body: any) => {
    const r = await fetch('/control', {
      method: 'POST',
      body: JSON.stringify(body),
    })
    if (!r.ok) throw Error('Control failed')
    return r.json()
  }
  async function scenario(id: string) {
    await control({ scenario: id })
    setData(undefined)
    setLocal({
      workspaceId: '',
      query: '',
      tab: 'board',
      archived: false,
      selected: null,
    })
    setSelection(id)
    setEpoch((e) => e + 1)
  }
  const command = (name: string) => async (request: any) => {
    const r = await fetch('/command/' + name, {
      method: 'POST',
      body: JSON.stringify(request),
    })
    const b = await r.json()
    if (!r.ok || !b.ok) throw Error(b.error ?? `HTTP ${r.status}`)
    return b.value
  }
  const sessions = data?.sessions ?? [],
    workspaces = data?.workspaces ?? []
  const dictionary = locale === 'zh' ? zh : en
  const props: any = {
    t: (key: keyof typeof en) => dictionary[key],
    useResource: () => ({ status, value: data?.snapshot }),
    useSessions: (select: any) =>
      select({
        ids: sessions.map((s: any) => s.id),
        byId: Object.fromEntries(sessions.map((s: any) => [s.id, s])),
      }),
    useWorkspaces: (select: any) => select({ items: workspaces }),
    useSessionStatus: (select: any) =>
      select(new Map(sessions.map((s: any) => [s.id, { running: s.running }]))),
    useStore: (select: any) => select(local),
    actions: Object.fromEntries(
      Object.keys(local).map((key) => [
        'set' + key[0].toUpperCase() + key.slice(1),
        (value: any) => setLocal((s) => ({ ...s, [key]: value })),
      ]),
    ),
    create: command('create'),
    update: command('update'),
    dispatch: command('dispatch'),
    analyze: command('analyze'),
    verify: command('verify'),
    openSession: (id: string) => setNotice('Opened synthetic Session ' + id),
    handoff: (ws: string, id: string) =>
      setNotice('Unsent synthetic draft for ' + ws + '/' + id),
  }
  return (
    <>
      <div id="lab-controls">
        <strong>LAB · Synthetic backend · No external model</strong>
        <select
          aria-label="Lab scenario"
          value={selection}
          onChange={(e) => void scenario(e.target.value)}
        >
          {fixture?.scenarios.map((s: any) => (
            <option key={s.id} value={s.id}>
              {s.id}
            </option>
          ))}
        </select>
        <button
          onClick={async () => {
            await control({ action: 'recover' })
            setEpoch((e) => e + 1)
          }}
        >
          Recover / release gate
        </button>
        <button
          onClick={async () => {
            await control({ action: 'disconnect' })
            setStatus('failed')
          }}
        >
          Disconnect stream
        </button>
        <button onClick={() => void refresh()}>Retry connection</button>
        <button
          onClick={() =>
            void control({
              action: 'release',
              id: data?.snapshot.dispatch.activeTaskId,
            })
          }
        >
          Release active phase
        </button>
        <select
          aria-label="Language"
          value={locale}
          onChange={(e) => setLocale(e.target.value)}
        >
          <option value="en">English</option>
          <option value="zh">中文</option>
        </select>
        <span role="status">{notice}</span>
      </div>
      <Dashboard key={epoch} {...props} />
    </>
  )
}
createRoot(document.getElementById('root')!).render(<App />)
