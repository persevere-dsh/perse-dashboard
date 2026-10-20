import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-resources/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import REMOTE from 'perse-dashboard/remote'
import { en, zh } from './locales.ts'
import { CSS } from './style.ts'
import { createDashboardStore } from './store.ts'
import { permissionControls } from './permission-api.ts'
import type { PermissionControls } from './permissions.tsx'
import { Dashboard, DashboardIcon, type Injected } from './view.tsx'
import { handoffPrompt } from './handoff.ts'
import type { DashboardSnapshot, TaskLanguage } from '../contract/types.ts'
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface ResourceProtocolMap {
    'perse-dashboard': DashboardSnapshot
  }
}
export const inject = [
  'remote',
  'slots',
  'layout',
  'uiWorkspace',
  'resources',
  'locale',
]
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(REMOTE)
  ctx.effect(
    () => ctx.locale.register('perse-dashboard', { en, zh }),
    'dashboard locale',
  )
  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.textContent = CSS
    tag.dataset.plugin = 'perse-dashboard'
    document.head.append(tag)
    return () => tag.remove()
  }, 'dashboard stylesheet')
  const ui = ctx.inject(
    [
      'remote.perseDashboard',
      'slots',
      'layout',
      'uiWorkspace',
      'resources',
      'locale',
    ],
    (scope) => {
      scope.resources.register({
        protocol: 'perse-dashboard',
        async *open(_address, { signal }) {
          const stream = scope.remote.$stream({
            name: 'perse-dashboard',
            open: (signal) => scope.remote.perseDashboard.watch(signal),
            ended: () => new Error('Dashboard stream ended'),
          })
          const dispose = () => {
            void stream.dispose()
          }
          signal.addEventListener('abort', dispose)
          try {
            for await (const frame of stream) {
              yield { ok: true as const, value: frame.value }
              frame.accept()
            }
          } finally {
            signal.removeEventListener('abort', dispose)
            await stream.dispose()
          }
        },
      })
      const store = createDashboardStore()
      let permissionProvider: PermissionControls | undefined
      // Optional capability fiber: missing settings must not hide the task board.
      scope.inject(
        ['remote.permissionPresets', 'remote.settings'],
        (permissionScope) => {
          const provider = permissionControls({
            catalog: () => permissionScope.remote.permissionPresets.catalog(),
            describe: () => permissionScope.remote.settings.describe(),
            mutate: (ns, ops, revision) =>
              permissionScope.remote.settings.mutate(ns, ops, revision),
          })
          permissionProvider = provider
          permissionScope.effect(
            () => () => {
              if (permissionProvider === provider)
                permissionProvider = undefined
            },
            'dashboard permission capability',
          )
        },
      )
      const permissions: PermissionControls = {
        async loadPermissions() {
          if (!permissionProvider)
            throw Error('DSH permission settings are unavailable')
          return permissionProvider.loadPermissions()
        },
        async savePermissionDefault(preset, revision) {
          if (!permissionProvider)
            throw Error('DSH permission settings are unavailable')
          return permissionProvider.savePermissionDefault(preset, revision)
        },
      }
      const injected = (): Injected => ({
        ...permissions,
        language: (): TaskLanguage =>
          scope.locale.getSnapshot().active === 'zh' ? 'zh' : 'en',
        image: async (request) => {
          const result = await scope.remote.perseDashboard.image(request)
          if (!result.ok) throw result.error
          return result.value
        },
        inputImage: async (request) => {
          const result = await scope.remote.perseDashboard.inputImage(request)
          if (!result.ok) throw result.error
          return result.value
        },
        create: async (request) => {
          const result = await scope.remote.perseDashboard.create(request)
          if (!result.ok) throw result.error
          return result.value
        },
        update: async (request) => {
          const result = await scope.remote.perseDashboard.update(request)
          if (!result.ok) throw result.error
          return result.value
        },
        dispatch: async (request) => {
          const result = await scope.remote.perseDashboard.dispatch(request)
          if (!result.ok) throw result.error
          return result.value
        },
        analyze: async (request) => {
          const result = await scope.remote.perseDashboard.analyze(request)
          if (!result.ok) throw result.error
          return result.value
        },
        verify: async (request) => {
          const result = await scope.remote.perseDashboard.verify(request)
          if (!result.ok) throw result.error
          return result.value
        },
        openSession: (id) => scope.uiWorkspace.openSession(id as never),
        handoff: (workspaceId, id) =>
          scope.uiWorkspace.startSession(workspaceId as never, {
            prompt: handoffPrompt(
              scope.locale.getSnapshot().active === 'zh' ? 'zh' : 'en',
              id,
            ),
          }),
        t: scope.locale.bind('perse-dashboard'),
      })
      scope.slots.inject('main', () =>
        scope.slots.register(
          {
            name: 'main',
            key: 'perse-dashboard' as never,
            store,
            inject: injected,
          },
          Dashboard,
        ),
      )
      scope.slots.inject('sidebar.panellist', () =>
        scope.slots.register(
          {
            name: 'sidebar.panellist',
            id: 'perse-dashboard',
            order: 4,
            label: () => scope.locale.bind('perse-dashboard')('nav'),
          },
          DashboardIcon,
        ),
      )
    },
  )
  try {
    await ui
  } catch (error) {
    await ui.dispose()
    await disposeRemote()
    throw error
  }
  return async () => {
    await ui.dispose()
    await disposeRemote()
  }
}
