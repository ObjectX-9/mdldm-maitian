import * as Primitive from '@radix-ui/react-checkbox'
import type { ComponentProps } from 'react'
import { Check, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'
type Props = Omit<ComponentProps<typeof Primitive.Root>, 'onCheckedChange'> & { onCheckedChange?: (checked: boolean) => void }
export function Checkbox({ className, onCheckedChange, ...props }: Props) {return <Primitive.Root data-slot="checkbox" className={cn('ui-checkbox studio-checkbox inline-flex size-4 shrink-0 items-center justify-center rounded border border-input bg-card outline-none data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50', className)} onCheckedChange={checked => onCheckedChange?.(checked === true)} {...props}><Primitive.Indicator><Check className="ui-checkbox-check size-3" strokeWidth={3}/><Minus className="ui-checkbox-minus size-3" strokeWidth={3}/></Primitive.Indicator></Primitive.Root>}
