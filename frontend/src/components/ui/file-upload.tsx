import { useRef } from 'react'
import { Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
export function FileUpload({ accept, onSelect, disabled }: { accept: string; onSelect: (file?: File) => void; disabled?: boolean }) {const input=useRef<HTMLInputElement>(null);return <><Button type="button" size="sm" variant="outline" disabled={disabled} onClick={()=>input.current?.click()}><Upload/>选择文件</Button><input ref={input} hidden type="file" accept={accept} onChange={event=>{onSelect(event.target.files?.[0]);event.target.value=''}}/></>}
