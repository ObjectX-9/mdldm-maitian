import { Input } from '@/components/ui/input'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ArrowRight, Eye, EyeOff } from 'lucide-react'
import { Panel } from '@/components/common'
import { sendLoginCode, verifyLoginCode, errorMessage, loginWithPassword, passwordLoginEnabled } from '@/lib/api'

export function LoginPage() {
  return passwordLoginEnabled ? <PasswordLogin /> : <FeishuLogin />
}

function PasswordLogin() {
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [passwordVisible, setPasswordVisible] = useState(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const fields = new FormData(event.currentTarget)
    setBusy(true)
    setMessage('')
    try {
      await loginWithPassword(String(fields.get('username')), String(fields.get('password')), fields.has('remember'))
      location.replace('/studio' + location.hash)
    } catch (error) {
      setMessage(errorMessage(error))
      setBusy(false)
    }
  }
  return <main className="workspace-login grid min-h-dvh place-items-center bg-muted/40 px-5 py-10">
    <div className="w-full max-w-[26rem]">
      <section aria-labelledby="studio-login-title" className="rounded-2xl border border-border bg-card px-6 py-8 sm:px-9 sm:py-10">
        <header className="mb-8">
          <img src="/static/site-icon.png" width={52} height={52} alt="" className="mb-5 rounded-xl" />
          <h1 id="studio-login-title" className="text-2xl font-semibold tracking-tight text-foreground">登录肥特自媒体工作室</h1>
        </header>
        <form onSubmit={submit} className="space-y-5">
          <div className="space-y-2">
            <label htmlFor="studio-username" className="text-sm font-medium">账号</label>
            <Input id="studio-username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={120} className="h-12 bg-background" required />
          </div>
          <div className="space-y-2">
            <label htmlFor="studio-password" className="text-sm font-medium">密码</label>
            <div className="relative">
              <Input id="studio-password" name="password" type={passwordVisible ? 'text' : 'password'} autoComplete="current-password" maxLength={256} className="h-12 bg-background pr-12" required />
              <Button type="button" variant="ghost" size="icon" className="absolute inset-y-0 right-0 m-0.5 size-11 text-muted-foreground"
                aria-label={passwordVisible ? '隐藏密码' : '显示密码'} onClick={() => setPasswordVisible(visible => !visible)}>
                {passwordVisible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
              </Button>
            </div>
          </div>
          <div className="flex min-h-8 items-center gap-2.5 text-sm text-muted-foreground">
            <Checkbox id="studio-remember" name="remember" defaultChecked />
            <label htmlFor="studio-remember" className="cursor-pointer">30 天内保持登录</label>
          </div>
          {message && <p role="alert" className="text-sm text-destructive">{message}</p>}
          <Button className="h-12 w-full font-medium" disabled={busy} type="submit">{busy ? '正在登录…' : '登录'}</Button>
        </form>
      </section>
      <a href="/" className="mx-auto mt-4 flex min-h-11 w-fit items-center gap-2 rounded-md px-3 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring">
        浏览健身热点研究 <ArrowRight size={15} aria-hidden="true" />
      </a>
    </div>
  </main>
}

function FeishuLogin() {
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
  return <main className="workspace-login grid min-h-screen place-items-center p-5"><Panel title="登录肥特自媒体工作室" note="验证码将发送到你配置的飞书群。" className="w-full max-w-sm"><form onSubmit={event => void submit(event)} className="space-y-4"><Button className="w-full" type="button" variant="outline" disabled={busy || wait > 0} onClick={() => void send()}>{wait ? `${wait} 秒后可重发` : '发送验证码'}</Button><label className="block text-sm" htmlFor="login-code">验证码</label><Input ref={input} id="login-code" className="h-12 w-full rounded-md border bg-background px-3 text-center font-mono text-2xl tracking-[.5em] outline-none focus:ring-2 focus:ring-ring" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ''))} required pattern="[0-9]{6}" /><Button className="w-full" type="submit" disabled={busy || code.length !== 6}>进入肥特自媒体工作室</Button><p role="status" aria-live="polite" className="min-h-5 text-sm text-muted-foreground">{message}</p></form></Panel></main>
}
