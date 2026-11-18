import { useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { DayPicker } from 'react-day-picker'
import { zhCN } from 'react-day-picker/locale'
import { CalendarDays } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { dayKey } from '@/lib/format'
export function DatePicker({ value, onValueChange, disabled, label = '选择日期' }: { value: string; onValueChange: (value: string) => void; disabled?: boolean; label?: string }) {
  const [open, setOpen] = useState(false)
  const selected = value ? new Date(`${value}T12:00:00`) : undefined
  return <Popover.Root open={open} onOpenChange={setOpen}><Popover.Trigger asChild><Button data-slot="date-trigger" variant="outline" disabled={disabled} aria-label={label} className="w-full justify-start gap-2 font-normal"><CalendarDays className="size-4 text-muted-foreground"/>{value || '选择日期'}</Button></Popover.Trigger><Popover.Portal><Popover.Content data-slot="calendar-content" sideOffset={6} align="start" collisionPadding={12} className="ui-calendar-popover z-[90] rounded-xl border bg-card p-3 text-foreground shadow-lg"><DayPicker mode="single" locale={zhCN} selected={selected} defaultMonth={selected} showOutsideDays onSelect={date => {if (date) {onValueChange(dayKey(date));setOpen(false)}}} className="ui-calendar"/></Popover.Content></Popover.Portal></Popover.Root>
}
