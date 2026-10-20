import type {
  PermissionControls,
  PermissionPreferences,
} from './permissions.tsx'
import type {
  PermissionApplyPreview,
  PermissionApplyRequest,
  PermissionApplyResult,
  PermissionPendingFact,
} from '../contract/types.ts'
type Result<T> = { ok: true; value: T } | { ok: false; error: unknown }
interface ExistingPermissionRemote {
  permissionPreview(request: {
    pending?: PermissionPendingFact[]
  }): Promise<Result<PermissionApplyPreview>>
  permissionApply(
    request: PermissionApplyRequest,
  ): Promise<Result<PermissionApplyResult>>
}
/** Owner-only preview/apply adapters; one call per explicit confirmation, never retried. */
export function existingPermissionControls(
  remote: ExistingPermissionRemote,
): Pick<
  PermissionControls,
  'previewExistingPermissions' | 'applyExistingPermissions'
> {
  return {
    async previewExistingPermissions(pending = []) {
      const result = await remote.permissionPreview({ pending })
      if (!result.ok) throw result.error
      return result.value
    },
    async applyExistingPermissions(request) {
      const result = await remote.permissionApply(request)
      if (!result.ok) throw result.error
      return result.value
    },
  }
}
interface PermissionRemote {
  catalog(): Promise<
    Result<{
      defaultPreset: string
      defaultOptions: { value: string; name: string; description?: string }[]
    }>
  >
  describe(): Promise<
    Result<{
      writable: boolean
      namespaces: { ns: string; revision: number }[]
    }>
  >
  mutate(
    ns: string,
    ops: { op: 'set'; path: string[]; value: string }[],
    revision: number,
  ): Promise<Result<unknown>>
}
/** Restrict writes to one official Settings field, with advertised targets and revision fencing. */
export function permissionControls(
  remote: PermissionRemote,
): Pick<PermissionControls, 'loadPermissions' | 'savePermissionDefault'> {
  const loadPermissions = async (): Promise<PermissionPreferences> => {
    const [catalog, settings] = await Promise.all([
      remote.catalog(),
      remote.describe(),
    ])
    if (!catalog.ok) throw catalog.error
    if (!settings.ok) throw settings.error
    const permission = settings.value.namespaces.find(
      (v) => v.ns === 'permission',
    )
    if (!permission || !Number.isInteger(permission.revision))
      throw Error('DSH permission settings are unavailable')
    const options = catalog.value.defaultOptions.map((o) => ({
      id: o.value,
      label: o.name,
      description: o.description,
    }))
    if (!options.some((o) => o.id === catalog.value.defaultPreset))
      throw Error('DSH default permission is not in its catalog')
    return {
      currentValue: catalog.value.defaultPreset,
      options,
      revision: permission.revision,
      writable: settings.value.writable,
    }
  }
  return {
    loadPermissions,
    async savePermissionDefault(preset, revision) {
      const current = await loadPermissions()
      if (!current.writable)
        throw Error('DSH permission settings are read-only')
      if (current.revision !== revision)
        throw Error('DSH permission settings changed; refresh and retry')
      if (!current.options.some((o) => o.id === preset))
        throw Error('Preset is not available as a DSH default')
      const response = await remote.mutate(
        'permission',
        [{ op: 'set', path: ['defaultPreset'], value: preset }],
        revision,
      )
      if (!response.ok) throw response.error
      return loadPermissions()
    },
  }
}
