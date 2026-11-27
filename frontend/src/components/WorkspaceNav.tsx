import { useId, useState } from 'react'
import { Activity, Archive, BarChart3, Bookmark, BookOpen, CalendarDays, ChartNoAxesCombined, ChevronDown, ClipboardList, Clock3, Flame, Images, LayoutDashboard, Lightbulb, ListChecks, Menu, MessageCircle, Server, Settings2, Smartphone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
export const workspaceGroups = [
  {label:'内容运营',items:[{id:'board',label:'运营总览',icon:LayoutDashboard},{id:'traffic',label:'流量',icon:BarChart3},{id:'calendar',label:'日历',icon:CalendarDays},{id:'convert',label:'转化',icon:ChartNoAxesCombined},{id:'archive',label:'档案',icon:Archive}]},
  {label:'内容管理',items:[{id:'creations',label:'作品库',icon:Images}]},
  {label:'研究分析',items:[{id:'topics/overview',label:'研究总览',icon:LayoutDashboard},{id:'topics/library',label:'热点内容库',icon:Flame},{id:'topics/needs',label:'需求洞察',icon:Lightbulb},{id:'topics/workbench',label:'选题工作台',icon:Bookmark},{id:'topics/apps',label:'App 调研',icon:Smartphone}]},
  {label:'技能',items:[{id:'skills',label:'技能管理',icon:BookOpen}]},
  {label:'数据与管理',items:[{id:'topics/runs',label:'采集记录',icon:ListChecks},{id:'topics/timeline',label:'采集时间轴',icon:Clock3},{id:'tasks',label:'任务',icon:ClipboardList},{id:'feedback',label:'评论',icon:MessageCircle},{id:'runtime',label:'运行',icon:Activity},{id:'services',label:'服务监控',icon:Server},{id:'topics/settings',label:'采集设置',icon:Settings2},{id:'system',label:'系统',icon:Settings2}]},
]
export const workspaceLabel=(page:string)=>page.startsWith('ep/')?'内容详情':workspaceGroups.flatMap(group=>group.items).find(item=>item.id===page)?.label??'页面不存在'
const topicViews = ['overview', 'library', 'needs', 'apps', 'runs', 'timeline', 'settings']
export const isResearchRoute = (page: string) => page.startsWith('topics/') && topicViews.includes(page.slice('topics/'.length))
type NavigationProps = { active: string; siteOn: boolean; studioPath?: string }
type NavigationItem = (typeof workspaceGroups)[number]['items'][number]
const footerIds = ['topics/settings', 'system']

function useNavigationGroups() {
  const [collapsed, setCollapsed] = useState<string[]>([])
  const toggle = (label: string) => {
    setCollapsed(current => current.includes(label) ? current.filter(item => item !== label) : [...current, label])
  }
  return { collapsed, toggle }
}

function WorkspaceLink({ item, active, closeMenu, studioPath }: { item: NavigationItem; active: string; closeMenu?: boolean; studioPath?: string }) {
  const href = `${!isResearchRoute(item.id) ? studioPath ?? '' : ''}#/${item.id}`
  const link = <a href={href} aria-current={active === item.id ? 'page' : undefined} title={item.label}><item.icon strokeWidth={1.7}/><span>{item.label}</span></a>
  return <Button asChild variant="ghost" className={cn('workspace-nav-item', active === item.id && 'is-active')}>{closeMenu ? <DialogClose asChild>{link}</DialogClose> : link}</Button>
}

function NavigationGroup({ label, items, active, collapsed, onToggle, mobile, studioPath }: {
  label: string; items: NavigationItem[]; active: string; collapsed: boolean; onToggle: () => void; mobile?: boolean; studioPath?: string
}) {
  const id = useId()
  return <div className={mobile ? 'workspace-menu-group' : 'workspace-nav-group'}>
    <button type="button" className={cn('workspace-nav-toggle', !mobile && 'workspace-nav-label')}
      aria-expanded={!collapsed} aria-controls={id} data-active={items.some(item => item.id === active) || undefined} onClick={onToggle}>
      <span>{label}</span><ChevronDown size={14} aria-hidden="true" />
    </button>
    <div id={id} hidden={collapsed}>
      {items.map(item => <WorkspaceLink key={item.id} item={item} active={active} closeMenu={mobile} studioPath={studioPath} />)}
    </div>
  </div>
}

export function WorkspaceSidebar({active,siteOn,studioPath}:NavigationProps) {
  const { collapsed, toggle } = useNavigationGroups()
  return <aside className="workspace-sidebar">
    <nav id="workspace-navigation" className="workspace-primary-navigation" aria-label="主导航">
      {workspaceGroups.map(group => <NavigationGroup key={group.label} label={group.label} active={active} studioPath={studioPath}
        items={group.items.filter(item => (item.id !== 'convert' || siteOn) && !footerIds.includes(item.id))}
        collapsed={collapsed.includes(group.label)} onToggle={() => toggle(group.label)} />)}
    </nav>
    <div className="workspace-sidebar-footer"><nav aria-label="设置导航">{workspaceGroups.flatMap(group => group.items)
      .filter(item => footerIds.includes(item.id)).map(item => <WorkspaceLink key={item.id} item={item} active={active} studioPath={studioPath} />)}</nav></div>
  </aside>;
}

export function WorkspaceMobileNav({ active, siteOn, studioPath }: NavigationProps) {
  const { collapsed, toggle } = useNavigationGroups()
  return <Dialog>
    <DialogTrigger asChild><Button className="workspace-menu-trigger" size="icon" variant="ghost" aria-label="打开导航"><Menu /></Button></DialogTrigger>
    <DialogContent className="workspace-menu" aria-describedby={undefined}>
      <DialogHeader><DialogTitle>工作台导航</DialogTitle></DialogHeader>
      <nav aria-label="主导航">
        {workspaceGroups.map(group => <NavigationGroup key={group.label} label={group.label} active={active} mobile studioPath={studioPath}
          items={group.items.filter(item => item.id !== 'convert' || siteOn)}
          collapsed={collapsed.includes(group.label)} onToggle={() => toggle(group.label)} />)}
      </nav>
    </DialogContent>
  </Dialog>
}
