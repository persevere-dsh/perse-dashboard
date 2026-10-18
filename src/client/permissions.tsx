/** Official DSH Settings/catalog presentation; no parallel permission policy. */
import React, { useEffect, useState } from 'react'
import { Dialog } from './dialog.tsx'
import type { Injected } from './view.tsx'
export interface PermissionPreferences {
  currentValue: string
  revision: number
  writable: boolean
  options: { id: string; label: string; description?: string }[]
}
export interface PermissionControls {
  loadPermissions(): Promise<PermissionPreferences>
  savePermissionDefault(
    preset: string,
    revision: number,
  ): Promise<PermissionPreferences>
}
export function PermissionSettings({
  t,
  loadPermissions,
  savePermissionDefault,
}: PermissionControls & { t: Injected['t'] }) {
  const [value, setValue] = useState<PermissionPreferences>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [open, setOpen] = useState(false),
    [selection, setSelection] = useState(''),
    [confirm, setConfirm] = useState(false),
    [ack, setAck] = useState(false),
    [saved, setSaved] = useState(false)
  const load = async () => {
    setBusy(true)
    setError('')
    try {
      const next = await loadPermissions()
      setValue(next)
      setSelection(next.currentValue)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setValue(undefined)
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    void load()
  }, [loadPermissions])
  const label = (id: string) =>
    id === 'workspace-write'
      ? t('permissionWorkspace')
      : id === 'danger-full-access'
        ? t('permissionFull')
        : id === 'read-only'
          ? t('permissionReadOnly')
          : (value?.options.find((o) => o.id === id)?.label ?? id)
  const save = async () => {
    if (!value || !ack) return
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      const next = await savePermissionDefault(selection, value.revision)
      setValue(next)
      setSelection(next.currentValue)
      setConfirm(false)
      setSaved(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setConfirm(false)
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <section className="pd-permissions" aria-label={t('defaultPermissions')}>
        <div>
          <strong>
            {t('defaultPermissions')}:{' '}
            {value
              ? label(value.currentValue)
              : busy
                ? t('loading')
                : t('permissionUnavailable')}
          </strong>
          <p className="pd-muted">{t('permissionScope')}</p>
          {error && !open && (
            <p role="alert">
              {t('permissionUnavailable')}: {error}
            </p>
          )}
        </div>
        <button
          disabled={busy}
          onClick={() => {
            setOpen(true)
            setSaved(false)
            void load()
          }}
        >
          {t('permissionSettings')}
        </button>
      </section>
      {open && (
        <Dialog
          className="pd-permission-dialog"
          title={t('defaultPermissions')}
          description={t('permissionScope')}
          closeLabel={t('closePermissionSettings')}
          onClose={() => {
            if (!busy) setOpen(false)
          }}
          footer={
            <>
              <button disabled={busy} onClick={() => void load()}>
                {t('refreshPermissions')}
              </button>
              <button
                className="pd-primary"
                disabled={
                  busy ||
                  !value?.writable ||
                  !selection ||
                  selection === value.currentValue
                }
                onClick={() => {
                  setAck(false)
                  setConfirm(true)
                }}
              >
                {t('savePermissionDefault')}
              </button>
            </>
          }
        >
          <p>{t('permissionExisting')}</p>
          {error && (
            <p className="pd-banner" role="alert">
              {error}
            </p>
          )}
          {saved && <p role="status">{t('permissionSaved')}</p>}
          {!value && !busy && <p>{t('permissionUnavailable')}</p>}
          {value && !value.writable && (
            <p className="pd-banner">{t('permissionReadOnlySettings')}</p>
          )}
          <fieldset
            className="pd-permission-options"
            disabled={busy || !value?.writable}
          >
            <legend>{t('permissionDefaultChoice')}</legend>
            {value?.options.map((option) => (
              <label className="pd-check" key={option.id}>
                <input
                  type="radio"
                  name="pd-default-permission"
                  checked={selection === option.id}
                  onChange={() => {
                    setSelection(option.id)
                    setSaved(false)
                  }}
                  value={option.id}
                />
                <span>
                  <strong>{label(option.id)}</strong>
                  {option.description && <small>{option.description}</small>}
                </span>
              </label>
            ))}
          </fieldset>
          <div className="pd-banner">{t('permissionFullWarning')}</div>
          <p className="pd-muted">{t('permissionApprovalHelp')}</p>
        </Dialog>
      )}
      {confirm && (
        <Dialog
          alert
          className="pd-confirm-dialog"
          title={t('confirmPermissionDefault')}
          description={t('permissionScope')}
          closeLabel={t('cancel')}
          onClose={() => {
            if (!busy) setConfirm(false)
          }}
          footer={
            <>
              <button disabled={busy} onClick={() => setConfirm(false)}>
                {t('cancel')}
              </button>
              <button
                className="pd-primary"
                disabled={!ack || busy}
                onClick={() => void save()}
              >
                {t('confirmPermissionSave')}
              </button>
            </>
          }
        >
          <p>
            <strong>{label(selection)}</strong>
          </p>
          <p>
            {selection === 'workspace-write' || selection === 'read-only'
              ? t('permissionExisting')
              : t('permissionFullWarning')}
          </p>
          <label className="pd-check">
            <input
              type="checkbox"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
            />
            {t('permissionAcknowledge')}
          </label>
        </Dialog>
      )}
    </>
  )
}
