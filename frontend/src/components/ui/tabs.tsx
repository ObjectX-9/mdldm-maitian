import * as Primitive from '@radix-ui/react-tabs'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'
import { useMovingSelection } from '@/components/ui/moving-selection'
export function Tabs({className,...props}:ComponentProps<typeof Primitive.Root>) {return <Primitive.Root data-slot="tabs" className={cn('ui-tabs flex flex-col gap-2',className)} {...props}/>}
export function TabsList({className,variant='default',children,...props}:ComponentProps<typeof Primitive.List>&{variant?:'default'|'line'}) {
 const ref=useMovingSelection()
 return <Primitive.List {...props} ref={ref} data-slot="tabs-list" data-variant={variant} className={cn('ui-tabs-list ui-moving-tabs inline-flex items-center gap-1 rounded-md bg-muted p-1',variant==='line'&&'rounded-none bg-transparent',className)}><span className="ui-moving-indicator" aria-hidden="true"/>{children}</Primitive.List>
}
export function TabsTrigger({className,...props}:ComponentProps<typeof Primitive.Trigger>) {return <Primitive.Trigger data-slot="tabs-trigger" className={cn('ui-tabs-trigger inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground data-[state=active]:bg-card data-[state=active]:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',className)} {...props}/>}
export function TabsContent({className,...props}:ComponentProps<typeof Primitive.Content>) {return <Primitive.Content data-slot="tabs-content" className={cn('ui-tabs-panel min-w-0 flex-1 outline-none',className)} {...props}/>}
