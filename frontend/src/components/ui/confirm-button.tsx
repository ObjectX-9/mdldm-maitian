import { useState } from 'react'
import { Button, type ButtonProps } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'

type ConfirmButtonProps = Omit<ButtonProps, 'onClick' | 'title' | 'asChild'> & {
  title: string
  description: string
  confirmLabel?: string
  onConfirm: () => void
}

export function ConfirmButton({ title, description, confirmLabel = '确认执行', onConfirm, children, disabled, ...props }: ConfirmButtonProps) {
  const [open, setOpen] = useState(false)
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button {...props} disabled={disabled}>{children}</Button></DialogTrigger>
    <DialogContent role="alertdialog" className="ui-confirm-dialog">
      <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
      <div className="ui-confirm-actions"><Button type="button" variant="outline" onClick={() => setOpen(false)}>取消</Button><Button type="button" disabled={disabled} onClick={() => { setOpen(false); onConfirm() }}>{confirmLabel}</Button></div>
    </DialogContent>
  </Dialog>
}
