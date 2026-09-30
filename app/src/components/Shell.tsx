import { useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { CalendarDays, KeyRound, LayoutDashboard, LogOut, Moon, RotateCcw, ShieldAlert, ShieldCheck, Sun, Table2, Timer, Upload, X } from 'lucide-react'
import { PasswordDialog } from '@/components/Auth'
import { Badge, Button, Segmented } from '@/components/ui'
import { useTheme } from '@/hooks/useTheme'
import { nf } from '@/lib/format'
import { EASE_OUT } from '@/lib/motion'
import type { SheetId } from '@/lib/types'
import { useStore } from '@/store'

const NAV: { id: SheetId; label: string; icon: typeof Timer }[] = [
  { id: 'summary', label: 'Сводка', icon: LayoutDashboard },
  { id: 'downtime', label: 'Простои', icon: Timer },
  { id: 'defects', label: 'Брак', icon: ShieldAlert },
  { id: 'data', label: 'Данные', icon: Table2 },
  { id: 'admin', label: 'Админ-панель', icon: ShieldCheck },
]
export const SHEET_TITLE: Record<SheetId, string> = { summary: 'Сводка', downtime: 'Простои', defects: 'Брак', data: 'Данные', admin: 'Администрирование' }
const ICON = { size: 16, strokeWidth: 1.5 } as const
const SOURCE: Partial<Record<string, string>> = { app: 'база данных SQLite', sealed: 'зашифрованный файл' }

export function Sidebar() {
  const { sheet, setSheet, journals, mode, user, perms, logout, canReset, upload, resetDefaults } = useStore()
  const { theme, toggle } = useTheme()
  const input = useRef<HTMLInputElement>(null)
  const [pwd, setPwd] = useState(false)
  const src = (j: { fileName: string; records: unknown[]; isDefault: boolean } | null) => (j ? j.fileName + ' · ' + nf(j.records.length) + ' зап.' + (j.isDefault ? '' : mode === 'demo' ? ' (загружен)' : '') : 'нет данных')
  const items = NAV.filter((n) => perms.sheets.includes(n.id))
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">П</div>
        <div>
          <div className="brand-name">Профиль</div>
          <div className="eyebrow brand-sub">учёт производства</div>
        </div>
      </div>
      <nav className="nav" aria-label="Листы">
        <div className="eyebrow">Листы</div>
        {items.map(({ id, label, icon: Icon }) => (
          <button key={id} className="nav-item" aria-current={sheet === id ? 'page' : undefined} onClick={() => setSheet(id)}>
            {sheet === id && <motion.span layoutId="nav-pill" className="nav-pill" transition={{ duration: 0.18, ease: EASE_OUT }} />}
            <Icon {...ICON} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-foot" id="sourceInfo">
        <div className="eyebrow">Данные</div>
        <dl>
          {journals.downtime && <div title={src(journals.downtime)}><dt>Простои</dt><dd>{nf(journals.downtime.records.length)} зап.</dd></div>}
          {journals.defects && <div title={src(journals.defects)}><dt>Брак</dt><dd>{nf(journals.defects.records.length)} зап.</dd></div>}
        </dl>
        <Badge tone={mode === 'app' ? 'success' : canReset ? 'accent' : 'neutral'} dot>{SOURCE[mode] ?? (canReset ? 'загруженные файлы' : 'исходные файлы')}</Badge>
        {/* единственная первичная кнопка на экране — «загрузить данные» */}
        {perms.upload && mode !== 'boot' && <Button variant="primary" className="w-full" onClick={() => input.current?.click()}><Upload {...ICON} />Загрузить данные</Button>}
        {perms.upload && mode !== 'boot' && <input
          ref={input} id="fileInput" type="file" accept=".csv,.txt,.xlsx,.xls,.xlsm" multiple hidden
          onChange={(e) => { const files = [...(e.target.files ?? [])]; e.target.value = ''; if (files.length) void upload(files) }}
        />}
        {canReset && <Button variant="ghost" size="sm" className="w-full" onClick={resetDefaults} id="resetBtn"><RotateCcw {...ICON} />Вернуть исходные данные</Button>}
      </div>
      {(mode === 'app' || mode === 'sealed') && user && (
        <div className="sidebar-user" id="userCard">
          <div className="user-name">{user.name}</div>
          <div className="user-meta"><Badge tone="accent">{perms.label}</Badge>{user.shop && <span>{user.shop}</span>}</div>
          {user.demo && mode === 'app' && <p className="hint user-warn">Демонстрационный пароль — смените его.</p>}
          <div className="user-actions">
            {mode === 'app' && <Button size="sm" variant="ghost" onClick={() => setPwd(true)}><KeyRound {...ICON} />Пароль</Button>}
            <Button size="sm" variant="ghost" id="logoutBtn" onClick={() => void logout()}><LogOut {...ICON} />Выйти</Button>
          </div>
          <PasswordDialog open={pwd} onClose={() => setPwd(false)} />
        </div>
      )}
      <button className="theme-btn" onClick={toggle} aria-label={theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}>
        {theme === 'dark' ? <Sun {...ICON} /> : <Moon {...ICON} />}<span>{theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}</span>
      </button>
    </aside>
  )
}

export function Topbar() {
  const { sheet } = useStore()
  return <header className="topbar">{sheet !== 'admin' ? <FilterBar /> : <div className="topbar-admin">Управление доступом</div>}</header>
}

export function FilterBar() {
  const { filters, setFilters, bounds, presets, shops } = useStore()
  const cur = presets.findIndex((p) => p.from === filters.from && p.to === filters.to)
  return (
    <section className="tb-filters" aria-label="Фильтры">
      <div className="filter">
        <span className="filter-label"><CalendarDays {...ICON} /><span className="sr-only">Период</span></span>
        <div className="filter-row">
          <input id="fFrom" className="input" type="date" aria-label="Период с" value={filters.from} min={bounds?.min} max={bounds?.max}
            onChange={(e) => e.target.value && setFilters({ from: e.target.value })} />
          <span className="filter-sep">—</span>
          <input id="fTo" className="input" type="date" aria-label="Период по" value={filters.to} min={bounds?.min} max={bounds?.max}
            onChange={(e) => e.target.value && setFilters({ to: e.target.value })} />
          <Segmented size="sm" label="Быстрый период" value={cur >= 0 ? String(cur) : ""}
            items={presets.map((p, i) => ({ id: String(i), label: p.label, title: p.title }))}
            onChange={(v) => { const p = presets[+v]; setFilters({ from: p.from, to: p.to }) }} />
        </div>
      </div>
      <div className="filter" id="fShift">
        <span className="filter-label">Смена</span>
        <Segmented size="sm" label="Смена" value={String(filters.shift)}
          items={[{ id: "all", label: "Обе" }, { id: "1", label: "День" }, { id: "2", label: "Ночь" }]}
          onChange={(v) => setFilters({ shift: v === "all" ? "all" : (Number(v) as 1 | 2) })} />
      </div>
      {shops.length > 1 && <div className="filter" id="fShop">
        <span className="filter-label help" title="В журнале брака нет цеха, поэтому фильтр по цеху влияет только на простои">Цех*</span>
        <Segmented size="sm" label="Цех" value={filters.shop}
          items={[{ id: "all", label: "Все" }, ...shops.map((s) => ({ id: s, label: s }))]}
          onChange={(v) => setFilters({ shop: v })} />
      </div>}
    </section>
  )
}

/** Отчёт о загрузке: что загружено, какие строки пропущены, не совпадают ли периоды журналов. */
export function LoadReport() {
  const { report, dismissReport } = useStore()
  return (
    <AnimatePresence>
      {report && (
        <motion.div
          key="report" id="loadReport" className={'notice notice--' + report.tone} role="status"
          initial={{ opacity: 0, transform: 'translateY(-6px)' }} animate={{ opacity: 1, transform: 'translateY(0px)' }} exit={{ opacity: 0, transform: 'translateY(-4px)', transition: { duration: 0.12 } }} transition={{ duration: 0.22, ease: EASE_OUT }}
        >
          <i className="led" />
          <div className="notice-body">
            {report.items.map((it) => (
              <div key={it.fileName}>
                <b>{it.title}</b> из «{it.fileName}»: загружено {it.loaded} из {it.total} строк.
                {!it.total && ' В файле нет строк с данными (только заголовок).'}
                {it.errors.length > 0 && (
                  <>
                    {' '}Пропущены строки с ошибками:
                    <ul>
                      {it.errors.slice(0, 10).map((e) => <li key={e}>{e}</li>)}
                      {it.errors.length > 10 && <li>…и ещё {it.errors.length - 10}</li>}
                    </ul>
                  </>
                )}
              </div>
            ))}
            {report.mismatch && <div><b>Внимание:</b> {report.mismatch}</div>}
            {report.failures.map((f) => <div key={f}><b>Не загружено:</b> {f}</div>)}
          </div>
          <Button size="sm" variant="ghost" aria-label="Скрыть отчёт" onClick={dismissReport}><X size={14} strokeWidth={1.5} /></Button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

