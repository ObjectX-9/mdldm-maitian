import * as Primitive from '@radix-ui/react-dialog'
import type { ComponentProps } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
export const Dialog = Primitive.Root
export const DialogTrigger = Primitive.Trigger
export const DialogClose = Primitive.Close
export function DialogContent({className,children,...props}:ComponentProps<typeof Primitive.Content>) {return <Primitive.Portal><Primitive.Overlay data-slot="dialog-overlay" className="ui-dialog-overlay fixed inset-0 z-50 bg-black/30"/><div className="topics-workspace"><Primitive.Content data-slot="dialog-content" className={cn('ui-dialog-content fixed left-1/2 top-1/2 z-50 grid max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-xl border bg-card p-6 text-foreground shadow-lg',className)} {...props}>{children}<Primitive.Close asChild><Button variant="ghost" size="icon-sm" className="ui-dialog-close absolute right-2 top-2" aria-label="关闭"><X/></Button></Primitive.Close></Primitive.Content></div></Primitive.Portal>}
export function DialogHeader({className,...props}:ComponentProps<'div'>) {return <div data-slot="dialog-header" className={cn('ui-dialog-header flex flex-col gap-2 pr-7',className)} {...props}/>}
export function DialogTitle({className,...props}:ComponentProps<typeof Primitive.Title>) {return <Primitive.Title data-slot="dialog-title" className={cn('ui-dialog-title text-lg font-semibold',className)} {...props}/>}
export function DialogDescription({className,...props}:ComponentProps<typeof Primitive.Description>) {return <Primitive.Description data-slot="dialog-description" className={cn('ui-dialog-description text-sm text-muted-foreground',className)} {...props}/>}
