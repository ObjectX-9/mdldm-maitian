import { Input } from '@/components/ui/input'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Panel } from '@/components/common'
import { sendLoginCode, verifyLoginCode, errorMessage } from '@/lib/api'

export function LoginPage() {
  const [code, setCode] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [wait, setWait] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { if (!wait) return; const id = setTimeout(() => setWait(n => Math.max(0, n - 1)), 1000); return () => clearTimeout(id) }, [wait])
  const send = async () => {
    setBusy(true)
    try { await sendLoginCode(); setWait(60); setMessage('验证码已发到飞书，5 分钟内有效。'); input.current?.focus() }
    catch (e) { setMessage(errorMessage(e)) }
    finally { setBusy(false) }
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (busy || code.length !== 6) return; setBusy(true)
    try { await verifyLoginCode(code); location.assign('/') }
    catch (e) { setMessage(errorMessage(e)); setCode(''); input.current?.focus(); setBusy(false) }
  }
  return <main className="grid min-h-screen place-items-center p-5"><Panel title="登录肥特自媒体工作室" note="验证码将发送到你配置的飞书群。" className="w-full max-w-sm"><form onSubmit={event => void submit(event)} className="space-y-4"><Button className="w-full" type="button" variant="outline" disabled={busy || wait > 0} onClick={() => void send()}>{wait ? `${wait} 秒后可重发` : '发送验证码'}</Button><label className="block text-sm" htmlFor="login-code">验证码</label><Input ref={input} id="login-code" className="h-12 w-full rounded-md border bg-background px-3 text-center font-mono text-2xl tracking-[.5em] outline-none focus:ring-2 focus:ring-ring" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ''))} required pattern="[0-9]{6}" /><Button className="w-full" type="submit" disabled={busy || code.length !== 6}>进入肥特自媒体工作室</Button><p role="status" aria-live="polite" className="min-h-5 text-sm text-muted-foreground">{message}</p></form></Panel></main>
}
