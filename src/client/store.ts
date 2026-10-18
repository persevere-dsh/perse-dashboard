import {defineStore} from '@deepseek-ai/dsh-client-store'
export function createDashboardStore(){return defineStore({
 init:()=>({workspaceId:'',query:'',tab:'board' as 'board'|'sessions',archived:false,selected:null as string|null}),
 actions:{
  setWorkspaceId:(d,value:string)=>{d.workspaceId=value},setQuery:(d,value:string)=>{d.query=value},
  setTab:(d,value:'board'|'sessions')=>{d.tab=value},setArchived:(d,value:boolean)=>{d.archived=value},setSelected:(d,value:string|null)=>{d.selected=value},
 }
})}
