// Администрирование: пользователи и роли, журнал действий, служебные операции. Доступно только роли «Администратор»;
// сервер проверяет это на каждом запросе, а этот экран лишь показывает результат.
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { ChevronLeft, ChevronRight, Copy, KeyRound, Pencil, Plus, Power, RotateCcw } from 'lucide-react'
import { Dialog } from '@/components/Dialog'
import { Badge, Button, Card, Field, FitCard, Segmented, type Tone } from '@/components/ui'
import { ApiError, api, type AuditRow, type ServerUser } from '@/lib/api'
import { ruDate } from '@/lib/format'
import type { Role } from '@/lib/types'
import { useStore } from '@/store'
import { SheetFrame } from './SheetFrame'

const ROLE_LABEL: Record<Role, string> = { admin: 'Администратор', director: 'Директор', chief: 'Начальник цеха', otk: 'Оператор ОТК' }
const ROLE_HELP: Record<Role, string> = {
  admin: 'Всё: пользователи, журнал действий, данные, деньги',
  director: 'Все листы и деньги, загрузка файлов, ставки; без пользователей',
  chief: 'Простои и брак своего цеха, без денег; вносит простои своего цеха',
  otk: 'Только брак: просмотр и внесение записей, без денег',
}
const ACTION_LABEL: Record<string, string> = {
  login: 'Вход', login_failed: 'Неудачный вход', login_failed_unknown: 'Вход: неизвестный логин', login_locked: 'Блокировка входа', logout: 'Выход',
  record_create: 'Запись добавлена', record_update: 'Запись изменена', record_delete: 'Запись удалена', import: 'Загрузка журнала', reset_data: 'Сброс данных',
  user_create: 'Пользователь создан', user_update: 'Пользователь изменён', password_reset: 'Сброс пароля', password_change: 'Смена пароля', settings_update: 'Изменены ставки', system_seed: 'Первичное наполнение',
}
const ACTION_TONE = (a: string): Tone => (/failed|locked/.test(a) ? 'danger' : /delete|reset/.test(a) ? 'warning' : /login|logout/.test(a) ? 'neutral' : 'info')
const fmtTs = (iso: string | null) => (iso ? ruDate(iso.slice(0, 10)) + ' ' + iso.slice(11, 16) : '—')
const PAGE = 13

type Tab = 'users' | 'audit' | 'service'

export function Admin() {
  const [tab, setTab] = useState<Tab>('users')
  return (
    <SheetFrame id="admin" caption="Пользователи, роли и журнал действий">
      <div className="table-tools no-print">
        <Segmented label="Раздел" value={tab} onChange={setTab} items={[{ id: 'users', label: 'Пользователи' }, { id: 'audit', label: 'Журнал действий' }, { id: 'service', label: 'Служебное' }]} />
      </div>
      {/* одно тело вместо набора элементов сетки: иначе лишний элемент занимает растягиваемую строку и таблица схлопывается */}
      <div className="admin-body">
        {tab === 'users' && <Users />}
        {tab === 'audit' && <Audit />}
        {tab === 'service' && <Service />}
      </div>
    </SheetFrame>
  )
}

// ---------------------------------------------------------------- пользователи
function Users() {
  const { user: me, notify } = useStore()
  const [rows, setRows] = useState<ServerUser[]>([])
  const [err, setErr] = useState('')
  const [dlg, setDlg] = useState<{ user: ServerUser | null } | null>(null)
  const [temp, setTemp] = useState<{ login: string; password: string } | null>(null)

  const load = useCallback(async () => {
    try { setRows((await api.get<{ users: ServerUser[] }>('/api/users')).users) } catch (e) { setErr((e as Error).message) }
  }, [])
  useEffect(() => { void load() }, [load])

  const toggle = async (u: ServerUser) => {
    try { await api.put('/api/users/' + u.id, { active: !u.active }); notify({ tone: 'success', title: u.active ? 'Учётная запись отключена' : 'Учётная запись включена' }); await load() } catch (e) { notify({ tone: 'danger', title: 'Не удалось', text: (e as Error).message }) }
  }
  const reset = async (u: ServerUser) => {
    try { const r = await api.post<{ tempPassword: string }>('/api/users/' + u.id + '/reset-password'); setTemp({ login: u.login, password: r.tempPassword }); await load() } catch (e) { notify({ tone: 'danger', title: 'Не удалось', text: (e as Error).message }) }
  }

  return (
    <>
      <div className="table-tools no-print">
        <Button id="newUser" onClick={() => setDlg({ user: null })}><Plus size={16} strokeWidth={1.5} />Новый пользователь</Button>
        <span className="hint">Пароли в системе не хранятся: только необратимые хэши. Сброс пароля выдаёт временный пароль, который показывается один раз.</span>
      </div>
      <FitCard title="Пользователи" sub={rows.length ? rows.length + ' учётных записей' : undefined} className="admin-card">
        {err && <div className="auth-error" role="alert">{err}</div>}
        <div className="table-wrap">
          <table className="tbl" id="usersTable">
            <thead><tr><th>Логин</th><th>Имя</th><th>Роль</th><th>Цех</th><th>Статус</th><th>Последний вход</th><th className="no-print">Действия</th></tr></thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id} data-login={u.login}>
                  <td className="mono">{u.login}</td>
                  <td>{u.name}</td>
                  <td><Badge tone="accent">{ROLE_LABEL[u.role]}</Badge></td>
                  <td>{u.shop ?? '—'}</td>
                  <td>
                    {!u.active ? <Badge tone="neutral" dot>отключена</Badge> : u.locked ? <Badge tone="danger" dot>заблокирована</Badge> : u.mustChange ? <Badge tone="warning" dot>временный пароль</Badge> : u.demo ? <Badge tone="warning" dot>демо-пароль</Badge> : <Badge tone="success" dot>активна</Badge>}
                  </td>
                  <td className="mono dim">{fmtTs(u.lastLogin)}</td>
                  <td className="no-print row-actions">
                    <Button size="sm" variant="ghost" aria-label={'Изменить ' + u.login} title="Изменить" onClick={() => setDlg({ user: u })}><Pencil size={15} strokeWidth={1.5} /></Button>
                    <Button size="sm" variant="ghost" aria-label={'Сбросить пароль ' + u.login} title="Сбросить пароль" onClick={() => void reset(u)}><KeyRound size={15} strokeWidth={1.5} /></Button>
                    {u.id !== me?.id && <Button size="sm" variant="ghost" aria-label={(u.active ? 'Отключить ' : 'Включить ') + u.login} title={u.active ? 'Отключить' : 'Включить'} onClick={() => void toggle(u)}><Power size={15} strokeWidth={1.5} /></Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="role-legend">
          {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <div key={r}><b>{ROLE_LABEL[r]}</b><span>{ROLE_HELP[r]}</span></div>)}
        </div>
      </FitCard>
      {dlg && <UserDialog key={dlg.user?.id ?? 'new'} user={dlg.user} onClose={() => setDlg(null)} onDone={async (tp) => { setDlg(null); if (tp) setTemp(tp); await load() }} />}
      <Dialog open={!!temp} onClose={() => setTemp(null)} title="Временный пароль" width={460}
        footer={<div className="dialog-actions"><Button variant="ghost" onClick={() => { void navigator.clipboard?.writeText(temp?.password ?? ''); notify({ tone: 'info', title: 'Пароль скопирован' }) }}><Copy size={16} strokeWidth={1.5} />Копировать</Button><Button variant="secondary" onClick={() => setTemp(null)}>Закрыть</Button></div>}>
        <p>Для пользователя <b>{temp?.login}</b>. Передайте его лично: он показывается <b>один раз</b>, а при первом входе человек обязан задать свой пароль.</p>
        <div className="temp-pass" id="tempPassword">{temp?.password}</div>
      </Dialog>
    </>
  )
}

function UserDialog({ user, onClose, onDone }: { user: ServerUser | null; onClose: () => void; onDone: (temp?: { login: string; password: string }) => Promise<void> }) {
  const edit = !!user
  const [f, setF] = useState({ login: user?.login ?? '', name: user?.name ?? '', role: (user?.role ?? 'otk') as Role, shop: user?.shop ?? '', password: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k: string, v: string) => setF((c) => ({ ...c, [k]: v }))
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setErr('')
    try {
      if (edit) { await api.put('/api/users/' + user!.id, { name: f.name, role: f.role, shop: f.role === 'chief' ? f.shop : '' }); await onDone() }
      else {
        const r = await api.post<{ tempPassword: string | null }>('/api/users', { login: f.login, name: f.name, role: f.role, shop: f.role === 'chief' ? f.shop : '', password: f.password || undefined })
        await onDone(r.tempPassword ? { login: f.login, password: r.tempPassword } : undefined)
      }
    } catch (x) { setErr((x as ApiError).message) } finally { setBusy(false) }
  }
  return (
    <Dialog open onClose={onClose} title={edit ? 'Изменить пользователя' : 'Новый пользователь'} width={500}>
      <form onSubmit={submit} className="rec-form" id="userForm">
        <div className="rec-grid">
          <Field label="Логин" hint={edit ? 'Логин менять нельзя' : 'Латиница, цифры, «_», «.», «-»'}><input data-autofocus={!edit || undefined} className="input" value={f.login} disabled={edit} onChange={(e) => set('login', e.target.value)} spellCheck={false} /></Field>
          <Field label="Имя"><input data-autofocus={edit || undefined} className="input" value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
          <Field label="Роль" hint={ROLE_HELP[f.role]}>
            <select className="select" value={f.role} onChange={(e) => set('role', e.target.value)}>{(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
          </Field>
          {f.role === 'chief' && <Field label="Цех"><select className="select" value={f.shop} onChange={(e) => set('shop', e.target.value)}><option value="">— выберите —</option><option>Цех 1</option><option>Цех 2</option></select></Field>}
          {!edit && <Field label="Пароль" hint="Оставьте пустым — система создаст временный"><input className="input" type="text" autoComplete="off" value={f.password} onChange={(e) => set('password', e.target.value)} /></Field>}
        </div>
        {err && <div className="auth-error" role="alert">{err}</div>}
        <div className="dialog-actions">
          <Button type="button" variant="ghost" onClick={onClose}>Отмена</Button>
          <Button type="submit" variant="secondary" disabled={busy || !f.name || (!edit && !f.login) || (f.role === 'chief' && !f.shop)}>{busy ? 'Сохраняю…' : edit ? 'Сохранить' : 'Создать'}</Button>
        </div>
      </form>
    </Dialog>
  )
}

// ---------------------------------------------------------------- журнал действий
function Audit() {
  const [rows, setRows] = useState<AuditRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [q, setQ] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const r = await api.get<{ rows: AuditRow[]; total: number }>('/api/audit?limit=' + PAGE + '&offset=' + page * PAGE + '&q=' + encodeURIComponent(q))
        setRows(r.rows); setTotal(r.total); setErr('')
      } catch (e) { setErr((e as Error).message) }
    }, 200)
    return () => clearTimeout(t)
  }, [page, q])

  const pages = Math.max(1, Math.ceil(total / PAGE))
  return (
    <>
      <div className="table-tools no-print">
        <input id="auditSearch" className="input" type="search" placeholder="Поиск: пользователь, действие, объект…" aria-label="Поиск по журналу" value={q} onChange={(e) => { setQ(e.target.value); setPage(0) }} />
        <span className="hint">Записей: {total}. Журнал ведётся сервером и не редактируется.</span>
      </div>
      <Card className="fit-card table-card">
        {err && <div className="auth-error" role="alert">{err}</div>}
        <div className="table-wrap">
          <table className="tbl" id="auditTable">
            <thead><tr><th>Время</th><th>Пользователь</th><th>Действие</th><th>Объект</th><th>Подробности</th><th>IP</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="mono dim">{fmtTs(r.ts)}</td>
                  <td className="mono">{r.login ?? '—'}</td>
                  <td><Badge tone={ACTION_TONE(r.action)} dot>{ACTION_LABEL[r.action] ?? r.action}</Badge></td>
                  <td className="mono dim">{r.entity ?? '—'}</td>
                  <td className="dim audit-detail">{r.detail ?? ''}</td>
                  <td className="mono dim">{r.ip ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <nav className="pager no-print" aria-label="Страницы журнала">
        <span className="pager-info">Страница {page + 1} из {pages}</span>
        <div className="pager-btns">
          <Button size="sm" variant="ghost" aria-label="Предыдущая страница" disabled={page === 0} onClick={() => setPage(page - 1)}><ChevronLeft size={16} strokeWidth={1.5} /></Button>
          <Button size="sm" variant="ghost" aria-label="Следующая страница" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}><ChevronRight size={16} strokeWidth={1.5} /></Button>
        </div>
      </nav>
    </>
  )
}

// ---------------------------------------------------------------- служебное
function Service() {
  const { resetDefaults, serverInfo } = useStore()
  const [ask, setAsk] = useState(false)
  return (
    <div className="service-grid">
      <FitCard title="Данные" sub="Журналы простоев и брака хранятся в базе SQLite на сервере">
        <p className="service-text">Сброс вернёт оба журнала к исходным файлам задания (120 записей простоев и 94 записи брака). Добавленные вручную и загруженные записи будут удалены. Пользователи и журнал действий не затрагиваются.</p>
        <div><Button variant="danger" id="resetData" onClick={() => setAsk(true)}><RotateCcw size={16} strokeWidth={1.5} />Вернуть исходные данные</Button></div>
      </FitCard>
      <FitCard title="Безопасность" sub="Что защищает систему">
        <ul className="facts">
          <li>Пароли — необратимые хэши <b>scrypt</b> с индивидуальной солью.</li>
          <li>Сессия — случайный токен в <b>HttpOnly</b> cookie с <b>SameSite=Strict</b>; в базе хранится только его хэш.</li>
          <li>Пять неудачных входов подряд блокируют учётную запись на 15 минут.</li>
          <li>Права проверяет <b>сервер</b> на каждом запросе; чужие цеха и деньги для «начальника цеха» и «оператора ОТК» на страницу не попадают.</li>
          {serverInfo?.demo && <li>Сейчас включены <b>демонстрационные пароли</b> — для рабочей среды запускайте сервер с PROFIL_DEMO=0.</li>}
        </ul>
      </FitCard>
      <Dialog open={ask} onClose={() => setAsk(false)} title="Вернуть исходные данные?" width={460}
        footer={<div className="dialog-actions"><Button variant="ghost" onClick={() => setAsk(false)}>Отмена</Button><Button variant="danger" id="confirmReset" onClick={() => { setAsk(false); resetDefaults() }}>Да, вернуть</Button></div>}>
        <p>Все добавленные и загруженные записи журналов будут заменены исходными. Действие попадёт в журнал действий.</p>
      </Dialog>
    </div>
  )
}
