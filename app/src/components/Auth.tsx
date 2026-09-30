// Экраны входа и смены временного пароля.
import { useState, type FormEvent } from 'react'
import { motion } from 'motion/react'
import { KeyRound, LogIn } from 'lucide-react'
import { Dialog } from '@/components/Dialog'
import { Badge, Button, Field } from '@/components/ui'
import { ApiError } from '@/lib/api'
import { EASE_OUT } from '@/lib/motion'
import { useStore } from '@/store'

function AuthCard({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="auth">
      <motion.div className="card card--raised auth-card" initial={{ opacity: 0, transform: 'translateY(8px)' }} animate={{ opacity: 1, transform: 'translateY(0px)' }} transition={{ duration: 0.28, ease: EASE_OUT }}>
        <div className="brand auth-brand">
          <div className="brand-mark">П</div>
          <div>
            <div className="brand-name">Профиль</div>
            <div className="eyebrow brand-sub">учёт производства</div>
          </div>
        </div>
        <h1 className="h-title">{title}</h1>
        <p className="auth-sub">{sub}</p>
        {children}
      </motion.div>
    </div>
  )
}

export function Login() {
  const { login, serverInfo } = useStore()
  const [l, setL] = useState('')
  const [p, setP] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true); setErr('')
    try { await login(l.trim(), p) } catch (x) {
      const a = x as ApiError
      setErr(a.status === 429 ? 'Слишком много неудачных попыток. Повторите через ' + Math.max(1, Math.ceil(Number(a.data.retryAfter ?? 900) / 60)) + ' мин.' : a.message)
      setP('')
    } finally { setBusy(false) }
  }

  return (
    <AuthCard title="Вход в систему" sub="Введите логин и пароль, выданные администратором.">
      <form onSubmit={submit} className="auth-form">
        <Field label="Логин"><input id="loginName" className="input" autoComplete="username" autoFocus value={l} onChange={(e) => setL(e.target.value)} spellCheck={false} /></Field>
        <Field label="Пароль"><input id="loginPass" className="input" type="password" autoComplete="current-password" value={p} onChange={(e) => setP(e.target.value)} /></Field>
        {err && <div className="auth-error" role="alert" id="loginError">{err}</div>}
        <Button variant="primary" size="lg" type="submit" disabled={busy || !l || !p} id="loginSubmit"><LogIn size={16} strokeWidth={1.5} />{busy ? 'Проверяю…' : 'Войти'}</Button>
      </form>
      {serverInfo?.demo && serverInfo.demoUsers.length > 0 && (
        <details className="auth-demo">
          <summary>Демонстрационные входы</summary>
          <p className="hint">Учебная версия: пароли ниже общеизвестны. В рабочей среде сервер запускается с PROFIL_DEMO=0.</p>
          <ul>
            {serverInfo.demoUsers.map((u) => (
              <li key={u.login}>
                <button type="button" className="chip" onClick={() => { setL(u.login); setP(u.password); setErr('') }}>{u.login}</button>
                <span>{u.role}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </AuthCard>
  )
}

export function MustChange() {
  const { user, changePassword, logout } = useStore()
  const [cur, setCur] = useState('')
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (a !== b) { setErr('Новые пароли не совпадают.'); return }
    setBusy(true); setErr('')
    try { await changePassword(cur, a) } catch (x) { setErr((x as Error).message) } finally { setBusy(false) }
  }

  return (
    <AuthCard title="Смена пароля" sub={(user?.name ?? '') + ', у вас временный пароль. Задайте свой — без этого работа с данными недоступна.'}>
      <form onSubmit={submit} className="auth-form">
        <Field label="Временный пароль"><input className="input" type="password" autoComplete="current-password" autoFocus value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
        <Field label="Новый пароль" hint="Не короче 8 символов, не совпадает с логином, не из списка самых частых."><input className="input" type="password" autoComplete="new-password" value={a} onChange={(e) => setA(e.target.value)} /></Field>
        <Field label="Повторите новый пароль"><input className="input" type="password" autoComplete="new-password" value={b} onChange={(e) => setB(e.target.value)} /></Field>
        {err && <div className="auth-error" role="alert">{err}</div>}
        <Button variant="primary" size="lg" type="submit" disabled={busy || !cur || !a || !b}><KeyRound size={16} strokeWidth={1.5} />{busy ? 'Сохраняю…' : 'Сменить пароль'}</Button>
        <Button variant="ghost" type="button" onClick={() => void logout()}>Выйти</Button>
      </form>
    </AuthCard>
  )
}

export function ServerDown() {
  return (
    <AuthCard title="Нет связи с сервером" sub="Панель не смогла обратиться к серверу. Проверьте, что он запущен, и обновите страницу.">
      <Badge tone="danger" dot>сервер недоступен</Badge>
      <Button onClick={() => location.reload()}>Обновить страницу</Button>
    </AuthCard>
  )
}

/** Смена собственного пароля из бокового меню */
export function PasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { changePassword } = useStore()
  const [cur, setCur] = useState('')
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const close = () => { setCur(''); setA(''); setB(''); setErr(''); onClose() }
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (a !== b) { setErr('Новые пароли не совпадают.'); return }
    setBusy(true); setErr('')
    try { await changePassword(cur, a); close() } catch (x) { setErr((x as Error).message) } finally { setBusy(false) }
  }
  return (
    <Dialog open={open} onClose={close} title="Смена пароля" width={440}>
      <form onSubmit={submit} className="auth-form">
        <Field label="Текущий пароль"><input data-autofocus className="input" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
        <Field label="Новый пароль" hint="Не короче 8 символов, не совпадает с логином, не из списка самых частых."><input className="input" type="password" autoComplete="new-password" value={a} onChange={(e) => setA(e.target.value)} /></Field>
        <Field label="Повторите новый пароль"><input className="input" type="password" autoComplete="new-password" value={b} onChange={(e) => setB(e.target.value)} /></Field>
        {err && <div className="auth-error" role="alert">{err}</div>}
        <div className="dialog-actions">
          <Button type="button" variant="ghost" onClick={close}>Отмена</Button>
          <Button type="submit" variant="secondary" disabled={busy || !cur || !a || !b}>{busy ? 'Сохраняю…' : 'Сохранить пароль'}</Button>
        </div>
      </form>
    </Dialog>
  )
}
