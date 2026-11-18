import { useId, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
export function Disclosure({ title, children, className }: { title: ReactNode; children: ReactNode; className?: string }) {
 const [open,setOpen]=useState(false),id=useId()
 return <div className={cn('ui-disclosure',className)}><Button id={`${id}-trigger`} type="button" variant="ghost" className="ui-disclosure-trigger h-auto w-full justify-start whitespace-normal px-0 py-2 text-left hover:bg-transparent" aria-expanded={open} aria-controls={id} onClick={()=>setOpen(current=>!current)}><span className="flex min-w-0 flex-1 flex-wrap items-center gap-3">{title}</span><ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform ${open?'rotate-180':''}`}/></Button>{open&&<div id={id} className="ui-disclosure-panel" role="region" aria-labelledby={`${id}-trigger`}>{children}</div>}</div>
}
