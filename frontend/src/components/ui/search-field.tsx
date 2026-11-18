import { useRef } from 'react'
import { Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

type SearchFieldProps = {
  label: string
  value: string
  onValueChange: (value: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  maxLength?: number
}

export function SearchField({ label, value, onValueChange, placeholder, className, disabled, maxLength }: SearchFieldProps) {
  const input = useRef<HTMLInputElement>(null)
  function clear() {
    onValueChange('')
    input.current?.focus()
  }
  return <div data-slot="search-field" data-disabled={disabled || undefined} className={cn('ui-search-field', className)}>
    <Search className="ui-search-icon" aria-hidden="true" />
    <Input ref={input} type="search" aria-label={label} value={value} placeholder={placeholder} disabled={disabled} maxLength={maxLength} autoComplete="off" onChange={event => onValueChange(event.target.value)} onKeyDown={event => {
      if (event.key === 'Escape' && value) { event.preventDefault(); event.stopPropagation(); clear() }
    }} />
    {value && <Button type="button" variant="ghost" size="icon-xs" className="ui-search-clear" aria-label={`清除${label}`} disabled={disabled} onClick={clear}><X aria-hidden="true" /></Button>}
  </div>
}
