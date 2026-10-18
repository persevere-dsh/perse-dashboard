import { defineStore } from '@deepseek-ai/dsh-client-store'
export function createDashboardStore() {
  return defineStore({
    init: () => ({
      workspaceId: '',
      query: '',
      tab: 'board' as 'board' | 'list' | 'sessions',
      archived: false,
      selected: null as string | null,
    }),
    actions: {
      setWorkspaceId: (d, value: string) => {
        d.workspaceId = value
        d.selected = null
      },
      setQuery: (d, value: string) => {
        d.query = value
      },
      setTab: (d, value: 'board' | 'list' | 'sessions') => {
        d.tab = value
        d.selected = null
      },
      setArchived: (d, value: boolean) => {
        d.archived = value
      },
      setSelected: (d, value: string | null) => {
        d.selected = value
      },
    },
  })
}
