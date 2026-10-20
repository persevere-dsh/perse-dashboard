/** Official DSH Settings/catalog presentation; no parallel permission policy. */
import React, { useEffect, useState } from 'react'
import { Dialog } from './dialog.tsx'
import type { Injected } from './view.tsx'
import type {
  PermissionApplyPreview,
  PermissionApplyRequest,
  PermissionApplyResult,
  PermissionEffective,
  PermissionPendingFact,
} from '../contract/types.ts'
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
  previewExistingPermissions(
    pending?: PermissionPendingFact[],
  ): Promise<PermissionApplyPreview>
  applyExistingPermissions(
    request: PermissionApplyRequest,
  ): Promise<PermissionApplyResult>
}
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error)
const effectiveText = (effective: PermissionEffective | null) =>
  effective
    ? `${effective.preset} · ${effective.sandbox} · ${effective.approval}`
    : '—'
export function PermissionSettings({
  t,
  loadPermissions,
  savePermissionDefault,
  previewExistingPermissions,
  applyExistingPermissions,
  pending = [],
}: PermissionControls & {
  t: Injected['t']
  pending?: PermissionPendingFact[]
}) {
  const [value, setValue] = useState<PermissionPreferences>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [open, setOpen] = useState(false),
    [selection, setSelection] = useState(''),
    [confirm, setConfirm] = useState(false),
    [ack, setAck] = useState(false),
    [saved, setSaved] = useState(false),
    [applyOpen, setApplyOpen] = useState(false),
    [preview, setPreview] = useState<PermissionApplyPreview>(),
    [previewBusy, setPreviewBusy] = useState(false),
    [previewError, setPreviewError] = useState(''),
    [applyAck, setApplyAck] = useState(false),
    [applyBusy, setApplyBusy] = useState(false),
    [applyError, setApplyError] = useState(''),
    [applyResult, setApplyResult] = useState<PermissionApplyResult>(),
    [applyStale, setApplyStale] = useState(false)
  const load = async () => {
    setBusy(true)
    setError('')
    try {
      const next = await loadPermissions()
      setValue(next)
      setSelection(next.currentValue)
    } catch (e) {
      setError(message(e))
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
          : (value?.options.find((o) => o.id === id)?.label ??
            preview?.options.find((o) => o.id === id)?.name ??
            id)
  const reasonLabel = (reason: string) => {
    switch (reason) {
      case 'running':
        return t('permissionReasonRunning')
      case 'pending-approval':
        return t('permissionReasonPendingApproval')
      case 'pending-question':
        return t('permissionReasonPendingQuestion')
      case 'pending-plan-review':
        return t('permissionReasonPendingPlanReview')
      case 'pending-interaction':
        return t('permissionReasonPendingInteraction')
      case 'already-target':
        return t('permissionReasonAlreadyTarget')
      case 'archived':
        return t('permissionReasonArchived')
      case 'cold':
        return t('permissionReasonCold')
      case 'child':
        return t('permissionReasonChild')
      case 'other-workspace':
        return t('permissionReasonOtherWorkspace')
      case 'missing':
        return t('permissionReasonMissing')
      case 'set-failed':
        return t('permissionReasonSetFailed')
      case 'readback-mismatch':
        return t('permissionReasonReadback')
      default:
        return reason
    }
  }
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
      setError(message(e))
      setConfirm(false)
    } finally {
      setBusy(false)
    }
  }
  const loadPreview = async () => {
    setPreviewBusy(true)
    setPreviewError('')
    setApplyError('')
    setApplyResult(undefined)
    setApplyStale(false)
    setApplyAck(false)
    try {
      setPreview(await previewExistingPermissions(pending))
    } catch (e) {
      setPreview(undefined)
      setPreviewError(message(e))
    } finally {
      setPreviewBusy(false)
    }
  }
  const openApply = () => {
    setApplyOpen(true)
    setPreview(undefined)
    void loadPreview()
  }
  const confirmApply = async () => {
    if (!preview?.available || !applyAck || applyBusy) return
    setApplyBusy(true)
    setApplyError('')
    setApplyResult(undefined)
    setApplyStale(false)
    try {
      const result = await applyExistingPermissions({
        expectedRevision: preview.revision,
        expectedPreset: preview.preset,
        sessionIds: preview.targets.map((target) => target.sessionId),
        pending,
      })
      setApplyResult(result)
      setApplyAck(false)
    } catch (e) {
      const text = message(e)
      setApplyError(text)
      if (/permission-stale|changed after the preview/i.test(text))
        setApplyStale(true)
    } finally {
      setApplyBusy(false)
    }
  }
  const canConfirm =
    !!preview?.available &&
    applyAck &&
    !applyBusy &&
    !applyStale &&
    !applyResult
  const sessionLine = (
    item: {
      sessionId: string
      title: string
      workspaceTitle: string | null
      reason?: string
      detail?: string
      effective: PermissionEffective | null
    },
    key: string,
  ) => (
    <li key={key}>
      <div className="pd-permission-line-head">
        <strong>{item.title}</strong>
        {item.workspaceTitle && (
          <span className="pd-muted">{item.workspaceTitle}</span>
        )}
        {item.reason && (
          <span className="pd-permission-reason">
            {reasonLabel(item.reason)}
          </span>
        )}
      </div>
      <code>{item.sessionId}</code>
      <span className="pd-muted">{effectiveText(item.effective)}</span>
      {item.detail && (
        <span className="pd-permission-detail">{item.detail}</span>
      )}
    </li>
  )
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
        <div className="pd-permissions-actions">
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
          <button disabled={busy} onClick={openApply}>
            {t('applyExistingPermissions')}
          </button>
        </div>
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
      {applyOpen && (
        <Dialog
          className="pd-permission-apply-dialog"
          title={t('applyExistingTitle')}
          description={t('applyExistingHelp')}
          closeLabel={t('applyExistingClose')}
          onClose={() => {
            if (!applyBusy) setApplyOpen(false)
          }}
          footer={
            <>
              {!applyResult && (
                <button
                  disabled={applyBusy}
                  onClick={() => setApplyOpen(false)}
                >
                  {t('applyExistingCancel')}
                </button>
              )}
              <button
                disabled={applyBusy || previewBusy}
                onClick={() => void loadPreview()}
              >
                {t('refreshPreview')}
              </button>
              {applyResult ? (
                <button
                  className="pd-primary"
                  onClick={() => setApplyOpen(false)}
                >
                  {t('applyExistingDone')}
                </button>
              ) : (
                <button
                  className="pd-primary"
                  disabled={!canConfirm}
                  onClick={() => void confirmApply()}
                >
                  {t('applyExistingConfirm')}
                </button>
              )}
            </>
          }
        >
          {previewBusy && <p role="status">{t('applyExistingLoading')}</p>}
          {previewError && (
            <p className="pd-banner" role="alert">
              {previewError}
            </p>
          )}
          {applyError && (
            <p className="pd-banner" role="alert">
              {applyError}
            </p>
          )}
          {applyStale && (
            <p className="pd-banner" role="status">
              {t('applyExistingStale')}
            </p>
          )}
          {preview && !preview.available && (
            <div className="pd-banner" role="alert">
              <strong>
                {preview.fullAccessBlocked
                  ? t('applyExistingFullBlocked')
                  : t('applyExistingUnavailable')}
              </strong>
              {preview.reason && (
                <p className="pd-muted">
                  {t('applyExistingReason')}: {preview.reason}
                </p>
              )}
            </div>
          )}
          {preview?.available && (
            <>
              <p>
                {t('applyExistingPreset')}:{' '}
                <strong>{label(preview.preset)}</strong>
              </p>
              <p>
                {t('applyExistingTargetCount')}:{' '}
                <strong>{preview.targets.length}</strong> ·{' '}
                {t('applyExistingWorkspaceCount')}: {preview.workspaces.length}{' '}
                · {t('applyExistingExcludedCount')}: {preview.excluded.length} ·{' '}
                {t('applyExistingUnsupportedCount')}:{' '}
                {preview.unsupported.length}
              </p>
              <p className="pd-muted">{t('applyExistingScopeNote')}</p>
              {preview.workspaces.length > 0 && (
                <ul className="pd-permission-workspaces">
                  {preview.workspaces.map((workspace) => (
                    <li key={workspace.workspaceId}>
                      <strong>{workspace.title}</strong>
                      <span className="pd-muted">
                        {t('applyExistingWorkspaceCount')}: {workspace.count}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <section
                className="pd-permission-section"
                aria-label={t('applyExistingTargets')}
              >
                <h3>
                  {t('applyExistingTargets')} ({preview.targets.length})
                </h3>
                {preview.targets.length ? (
                  <ul className="pd-permission-list">
                    {preview.targets.map((target) =>
                      sessionLine(
                        { ...target, effective: target.effective },
                        target.sessionId,
                      ),
                    )}
                  </ul>
                ) : (
                  <p className="pd-muted">{t('applyExistingNone')}</p>
                )}
              </section>
              <section
                className="pd-permission-section"
                aria-label={t('applyExistingExcluded')}
              >
                <h3>
                  {t('applyExistingExcluded')} ({preview.excluded.length})
                </h3>
                {preview.excluded.length ? (
                  <ul className="pd-permission-list">
                    {preview.excluded.map((item) =>
                      sessionLine(item, `${item.sessionId}-${item.reason}`),
                    )}
                  </ul>
                ) : (
                  <p className="pd-muted">{t('applyExistingNone')}</p>
                )}
              </section>
              <section
                className="pd-permission-section"
                aria-label={t('applyExistingUnsupported')}
              >
                <h3>
                  {t('applyExistingUnsupported')} ({preview.unsupported.length})
                </h3>
                {preview.unsupported.length ? (
                  <ul className="pd-permission-list">
                    {preview.unsupported.map((item) =>
                      sessionLine(item, `${item.sessionId}-${item.reason}`),
                    )}
                  </ul>
                ) : (
                  <p className="pd-muted">{t('applyExistingNone')}</p>
                )}
              </section>
            </>
          )}
          {preview?.available && !applyResult && (
            <label className="pd-check">
              <input
                type="checkbox"
                checked={applyAck}
                disabled={applyBusy}
                onChange={(e) => setApplyAck(e.target.checked)}
              />
              {t('applyExistingAcknowledge')}
            </label>
          )}
          {applyResult && (
            <section
              className="pd-permission-section"
              aria-label={t('applyExistingResult')}
            >
              <h3>{t('applyExistingResult')}</h3>
              <p>
                {t('applyExistingApplied')}:{' '}
                <strong>{applyResult.applied.length}</strong> ·{' '}
                {t('applyExistingSkipped')}: {applyResult.skipped.length} ·{' '}
                {t('applyExistingFailed')}: {applyResult.failed.length}
              </p>
              {applyResult.applied.length > 0 && (
                <ul className="pd-permission-list">
                  {applyResult.applied.map((item) =>
                    sessionLine(
                      {
                        ...item,
                        reason: t('applyExistingApplied'),
                      },
                      item.sessionId,
                    ),
                  )}
                </ul>
              )}
              {applyResult.failed.length > 0 && (
                <ul className="pd-permission-list">
                  {applyResult.failed.map((item) =>
                    sessionLine(
                      {
                        ...item,
                        reason: item.reason,
                        detail: item.detail,
                      },
                      `${item.sessionId}-failed`,
                    ),
                  )}
                </ul>
              )}
              {applyResult.skipped.length > 0 && (
                <ul className="pd-permission-list">
                  {applyResult.skipped.map((item) =>
                    sessionLine(
                      {
                        ...item,
                        reason: item.reason,
                        detail: item.detail,
                      },
                      `${item.sessionId}-skipped`,
                    ),
                  )}
                </ul>
              )}
            </section>
          )}
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
