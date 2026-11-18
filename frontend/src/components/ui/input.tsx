import { forwardRef, type ComponentProps } from 'react'
import { cn } from '@/lib/utils'
export const Input = forwardRef<HTMLInputElement, ComponentProps<'input'>>(function Input({className,...props},ref) {return <input ref={ref} data-slot="input" className={cn('ui-input flex h-9 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',className)} {...props}/>})
