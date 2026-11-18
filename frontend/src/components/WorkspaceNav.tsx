import { Activity, Archive, BarChart3, CalendarDays, ChartNoAxesCombined, ClipboardList, Clock3, Flame, LayoutDashboard, Lightbulb, ListChecks, MessageCircle, Settings2, Smartphone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
export const workspaceGroups = [
  {label:'内容运营',items:[{id:'board',label:'运营总览',icon:LayoutDashboard},{id:'traffic',label:'流量',icon:BarChart3},{id:'calendar',label:'日历',icon:CalendarDays},{id:'convert',label:'转化',icon:ChartNoAxesCombined},{id:'archive',label:'档案',icon:Archive}]},
  {label:'研究分析',items:[{id:'topics/overview',label:'研究总览',icon:LayoutDashboard},{id:'topics/library',label:'热点内容库',icon:Flame},{id:'topics/needs',label:'需求洞察',icon:Lightbulb},{id:'topics/apps',label:'App 调研',icon:Smartphone}]},
  {label:'数据与管理',items:[{id:'topics/runs',label:'采集记录',icon:ListChecks},{id:'topics/timeline',label:'采集时间轴',icon:Clock3},{id:'tasks',label:'任务',icon:ClipboardList},{id:'feedback',label:'评论',icon:MessageCircle},{id:'runtime',label:'运行',icon:Activity},{id:'topics/settings',label:'采集设置',icon:Settings2},{id:'system',label:'系统',icon:Settings2}]},
]
export const workspaceLabel=(page:string)=>page.startsWith('ep/')?'内容详情':workspaceGroups.flatMap(group=>group.items).find(item=>item.id===page)?.label??'页面不存在'
export function WorkspaceSidebar({active,siteOn}:{active:string;siteOn:boolean}) {
  const footerIds=['topics/settings','system'];
  const link=(item:(typeof workspaceGroups)[number]['items'][number])=><Button asChild key={item.id} variant="ghost" className={cn('workspace-nav-item',active===item.id&&'is-active')}><a href={`#/${item.id}`} aria-current={active===item.id?'page':undefined} title={item.label}><item.icon strokeWidth={1.7}/><span>{item.label}</span></a></Button>;
  return <aside className="workspace-sidebar">
    <nav id="workspace-navigation" className="workspace-primary-navigation" aria-label="主导航">{workspaceGroups.map(group=><div className="workspace-nav-group" key={group.label}><div className="workspace-nav-label">{group.label}</div>{group.items.filter(item=>(item.id!=='convert'||siteOn)&&!footerIds.includes(item.id)).map(link)}</div>)}</nav>
    <div className="workspace-sidebar-footer"><nav aria-label="设置导航">{workspaceGroups.flatMap(group=>group.items).filter(item=>footerIds.includes(item.id)).map(link)}</nav></div>
  </aside>;
}
