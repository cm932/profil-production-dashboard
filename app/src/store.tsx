import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ApiError, api, probeServer, type MeResponse, type ServerMeta } from '@/lib/api'
import { buildInsights, type Insight } from '@/lib/insights'
import { addDays, applyFilters, computeSummary, dataBounds, periodMismatch, type Filtered, type Journals, type Summary } from '@/lib/model'
import { readFile } from '@/lib/parse'
import { readVault, unseal } from '@/lib/vault'
import type { Defect, Downtime, Filters, Journal, Kind, LoadResult, Params, Perms, SheetId, User } from '@/lib/types'

export interface Preset { label: string; title?: string; from: string; to: string }

export interface ReportItem { title: string; fileName: string; loaded: number; total: number; errors: string[] }
export interface Report {
  tone: 'success' | 'warning' | 'danger'
  items: ReportItem[]
  failures: string[]
  mismatch: string
}
export interface ToastMsg { id: number; tone: 'success' | 'warning' | 'danger' | 'info'; title: string; text?: string }

/** boot — проверяем, есть ли сервер; demo — режим разработки без входа; sealed — запечатанный файл, данные расшифрованы паролем;
 *  login — нужен вход; mustchange — нужно сменить временный пароль; app — работа под учётной записью на сервере; error — сервер недоступен */
export type Mode = 'boot' | 'demo' | 'sealed' | 'login' | 'mustchange' | 'app' | 'error'

interface PendingImport { results: LoadResult[]; failures: string[] }

interface Store {
  mode: Mode
  serverInfo: ServerMeta | null
  user: User | null
  perms: Perms
  showMoney: boolean
  journals: Journals
  filters: Filters
  params: Params
  sheet: SheetId
  report: Report | null
  toast: ToastMsg | null
  bounds: { min: string; max: string } | null
  presets: Preset[]
  shops: string[]
  F: Filtered
  summary: Summary
  insights: Insight[]
  canReset: boolean
  pendingImport: PendingImport | null
  setSheet: (s: SheetId) => void
  setFilters: (p: Partial<Filters>) => void
  setParams: (p: Partial<Params>) => void
  upload: (files: File[]) => Promise<void>
  confirmImport: (mode: 'replace' | 'append') => Promise<void>
  cancelImport: () => void
  resetDefaults: () => void
  dismissReport: () => void
  notify: (t: Omit<ToastMsg, 'id'>) => void
  login: (login: string, password: string) => Promise<void>
  logout: () => Promise<void>
  changePassword: (current: string, next: string) => Promise<void>
  saveRecord: (kind: Kind, rec: Record<string, unknown>, dbId?: number) => Promise<void>
  deleteRecord: (kind: Kind, dbId: number) => Promise<void>
}

const Ctx = createContext<Store | null>(null)
export const useStore = () => {
  const s = useContext(Ctx)
  if (!s) throw new Error('useStore вне провайдера')
  return s
}

const SHEETS: SheetId[] = ['summary', 'downtime', 'defects', 'data', 'admin']
const sheetFromHash = (): SheetId => {
  const h = location.hash.slice(1) as SheetId
  return SHEETS.includes(h) ? h : 'summary'
}

/** Права автономного режима: смотреть все листы, загружать файлы, скачивать PDF; ни записей, ни администрирования */
const DEMO_PERMS: Perms = { label: 'Автономный режим', sheets: ['summary', 'downtime', 'defects', 'data'], money: true, upload: true, pdf: true, users: false, audit: false, settings: true, records: {} }
const NO_PERMS: Perms = { label: '', sheets: ['summary'], money: false, upload: false, pdf: false, users: false, audit: false, settings: false, records: {} }
const EMPTY: Journals = { downtime: null, defects: null }

const DEFAULT_PARAMS: Params = { shiftHours: 8, hourCost: 3000, pieceCost: 1500 }
function loadParams(): Params {
  try { return { ...DEFAULT_PARAMS, ...JSON.parse(localStorage.getItem('profil.params') || '{}') } } catch { return DEFAULT_PARAMS }
}

function toJournals(results: LoadResult[], isDefault: boolean, base: Journals): Journals {
  const out = { ...base }
  for (const r of results) {
    const j = { records: r.records, fileName: r.fileName, errors: r.errors, total: r.total, isDefault }
    if (r.kind === 'downtime') out.downtime = j as Journals['downtime']
    else out.defects = j as Journals['defects']
  }
  return out
}

const fromServer = <T,>(records: T[]): Journal<T> => ({ records, fileName: 'база данных', errors: [], total: records.length, isDefault: false })

export function StoreProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>('boot')
  const [serverInfo, setServerInfo] = useState<ServerMeta | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [perms, setPerms] = useState<Perms>(NO_PERMS)
  const [journals, setJournals] = useState<Journals>(EMPTY)
  const [params, setParamsState] = useState<Params>(loadParams)
  const [sheet, setSheetState] = useState<SheetId>(sheetFromHash)
  const [report, setReport] = useState<Report | null>(null)
  const [toast, setToast] = useState<ToastMsg | null>(null)
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null)
  const toastId = useRef(0)
  const sealedRef = useRef<Journals>(EMPTY) // расшифрованные журналы запечатанного файла — для «Вернуть исходные данные»
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const bounds = useMemo(() => dataBounds(journals), [journals])
  const [filters, setFiltersState] = useState<Filters>({ from: '', to: '', shift: 'all', shop: 'all' })
  const filtersRef = useRef(filters)
  filtersRef.current = filters
  const shops = useMemo(() => [...new Set((journals.downtime?.records ?? []).map((r) => r.shop).filter(Boolean))].sort(), [journals])

  // Быстрые периоды: весь период и недели по 7 дней от начала данных
  const presets = useMemo<Preset[]>(() => {
    if (!bounds) return []
    const out: Preset[] = [{ label: 'Весь период', from: bounds.min, to: bounds.max }]
    const dm = (d: string) => d.slice(8) + '.' + d.slice(5, 7) + '.' + d.slice(0, 4)
    const weeks: Preset[] = []
    for (let start = bounds.min, i = 1; start <= bounds.max; start = addDays(start, 7), i++) {
      const end = addDays(start, 6) > bounds.max ? bounds.max : addDays(start, 6)
      weeks.push({ label: 'Нед. ' + i, title: dm(start) + ' — ' + dm(end), from: start, to: end })
    }
    return out.concat(weeks.slice(-5)) // нумерация остаётся сквозной от начала данных
  }, [bounds])

  const showMoney = mode === 'demo' || (mode !== 'boot' && perms.money)
  const F = useMemo(() => applyFilters(journals, filters), [journals, filters])
  const summary = useMemo(() => computeSummary(journals, filters, params, F), [journals, filters, params, F])
  const insights = useMemo(() => (bounds ? buildInsights({ F, f: filters, p: params, s: summary, money: showMoney }) : []), [bounds, F, filters, params, summary, showMoney])

  const setFilters = useCallback((p: Partial<Filters>) => {
    setFiltersState((cur) => {
      const next = { ...cur, ...p }
      if (p.from && next.to && p.from > next.to) next.to = p.from // период: «с» не позже «по»
      if (p.to && next.from && p.to < next.from) next.from = p.to
      return next
    })
  }, [])

  const notify = useCallback((t: Omit<ToastMsg, 'id'>) => setToast({ ...t, id: ++toastId.current }), [])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4200)
    return () => clearTimeout(t)
  }, [toast])

  // Новые данные → период по границам новых данных; цех сбрасывается, если такого больше нет
  const adopt = useCallback((next: Journals, keepFilters = false) => {
    const b = dataBounds(next)
    const s = new Set((next.downtime?.records ?? []).map((r) => r.shop))
    setJournals(next)
    setFiltersState((cur) => {
      // один цех (у начальника цеха) — фильтр по цеху не нужен, в подписях сразу его название
      const shop = s.size === 1 ? [...s][0] : cur.shop !== 'all' && !s.has(cur.shop) ? 'all' : cur.shop
      const next = keepFilters && b && cur.from && cur.to
        ? { ...cur, from: cur.from < b.min ? b.min : cur.from, to: cur.to > b.max ? b.max : cur.to, shop }
        : { ...cur, from: b?.min ?? '', to: b?.max ?? '', shop }
      return next.from === cur.from && next.to === cur.to && next.shop === cur.shop ? cur : next
    })
  }, [])

  // ---------------------------------------------------------------- сервер
  const loadServerData = useCallback(async (keepFilters = false) => {
    const d = await api.get<{ downtime: Downtime[]; defects: Defect[]; settings: Params | null }>('/api/data')
    adopt({ downtime: fromServer(d.downtime), defects: fromServer(d.defects) }, keepFilters)
    if (d.settings) setParamsState(d.settings)
  }, [adopt])

  const setSheet = useCallback((s: SheetId) => {
    setSheetState(s)
    if (location.hash !== '#' + s) history.replaceState(null, '', '#' + s)
  }, [])

  const enter = useCallback(async (me: MeResponse) => {
    setUser(me.user)
    setPerms(me.perms)
    if (me.user.mustChange) { setMode('mustchange'); return }
    await loadServerData()
    setMode('app')
    setSheetState((cur) => (me.perms.sheets.includes(cur) ? cur : me.perms.sheets[0]))
  }, [loadServerData])

  // Запуск: есть ли сервер? Если нет — автономный режим со вшитыми журналами (двойной клик по файлу, GitHub Pages)
  useEffect(() => {
    let dead = false
    ;(async () => {
      if (__SEALED__) { setMode(readVault() ? 'login' : 'error'); return }
      const meta = await probeServer()
      if (dead) return
      if (!meta) {
        if (__STANDALONE__) {
          const { loadDefaultJournals } = await import('@/data/default')
          if (dead) return
          adopt(toJournals(loadDefaultJournals(), true, EMPTY))
          setPerms(DEMO_PERMS)
          setMode('demo')
        } else setMode('error')
        return
      }
      setServerInfo(meta)
      try {
        await enter(await api.get<MeResponse>('/api/me'))
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) setMode('login')
        else setMode('error')
      }
    })()
    return () => { dead = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const h = () => setSheetState(sheetFromHash())
    window.addEventListener('hashchange', h)
    return () => window.removeEventListener('hashchange', h)
  }, [])

  const login = useCallback(async (loginName: string, password: string) => {
    if (__SEALED__) {
      const vault = readVault()
      if (!vault) throw new Error('В файле нет зашифрованных данных.')
      const u = await unseal(vault, loginName, password)
      const j = (records: unknown[], fileName: string) => ({ records, fileName, errors: [], total: records.length, isDefault: true })
      const next = { downtime: j(u.downtime, u.source.downtime), defects: j(u.defects, u.source.defects) } as Journals
      sealedRef.current = next
      setUser(u.user); setPerms(u.perms)
      if (u.settings) setParamsState({ ...u.settings, ...(() => { try { return JSON.parse(localStorage.getItem('profil.params') || '{}') } catch { return {} } })() })
      adopt(next)
      setMode('sealed')
      setSheetState((cur) => (u.perms.sheets.includes(cur) ? cur : u.perms.sheets[0]))
      return
    }
    const me = await api.post<MeResponse>('/api/login', { login: loginName, password })
    await enter(me)
  }, [enter, adopt])

  const logout = useCallback(async () => {
    if (!__SEALED__) { try { await api.post('/api/logout') } catch { /* сессия и так закрыта */ } }
    sealedRef.current = EMPTY // расшифрованные данные в памяти больше не держим
    setUser(null); setPerms(NO_PERMS); setJournals(EMPTY); setReport(null); setPendingImport(null)
    setFiltersState({ from: '', to: '', shift: 'all', shop: 'all' })
    setMode('login')
  }, [])

  const changePassword = useCallback(async (current: string, next: string) => {
    await api.post('/api/me/password', { current, next })
    const me = await api.get<MeResponse>('/api/me')
    await enter(me)
    notify({ tone: 'success', title: 'Пароль изменён', text: 'Остальные ваши сессии закрыты.' })
  }, [enter, notify])

  const setParams = useCallback((p: Partial<Params>) => {
    setParamsState((cur) => {
      const next = { ...cur }
      if (p.shiftHours != null && p.shiftHours > 0 && p.shiftHours <= 24) next.shiftHours = p.shiftHours
      if (p.hourCost != null && p.hourCost >= 0) next.hourCost = p.hourCost
      if (p.pieceCost != null && p.pieceCost >= 0) next.pieceCost = p.pieceCost
      if (mode === 'app') {
        // на сервере ставки хранятся в базе и общие для всех; сохраняем с задержкой, пока человек печатает
        clearTimeout(saveTimer.current)
        saveTimer.current = setTimeout(() => { api.put('/api/settings', next).catch((e: ApiError) => notify({ tone: 'danger', title: 'Ставки не сохранены', text: e.message })) }, 600)
      } else {
        try { localStorage.setItem('profil.params', JSON.stringify(next)) } catch { /* нет доступа к хранилищу */ }
      }
      return next
    })
  }, [mode, notify])

  // ---------------------------------------------------------------- загрузка файлов
  const finishUpload = useCallback((results: LoadResult[], failures: string[], merged: Journals) => {
    const mismatch = periodMismatch(merged)
    const items: ReportItem[] = results.map((r) => ({ title: r.title, fileName: r.fileName, loaded: r.records.length, total: r.total, errors: r.errors }))
    const warn = items.some((i) => i.errors.length || !i.total) || !!mismatch || (failures.length > 0 && results.length > 0)
    const tone: Report['tone'] = results.length ? (warn ? 'warning' : 'success') : 'danger'
    setReport({ tone, items, failures, mismatch })
    if (results.length) {
      const n = items.reduce((s, i) => s + i.loaded, 0)
      notify({ tone: warn ? 'warning' : 'success', title: 'Данные загружены', text: 'Записей: ' + n + (warn ? '. Есть замечания — см. отчёт.' : '. Панель пересчитана.') })
    }
  }, [notify])

  const upload = useCallback(async (files: File[]) => {
    const results: LoadResult[] = [], failures: string[] = []
    for (const file of files) {
      try { results.push(await readFile(file)) } catch (e) { failures.push((e as Error).message) }
    }
    if (mode === 'app') {
      // на сервере загрузка меняет общие данные — сначала спрашиваем, заменить журнал или добавить к нему
      if (!results.length) { finishUpload(results, failures, journals); return }
      setPendingImport({ results, failures })
      return
    }
    const next = results.length ? toJournals(results, false, journals) : journals
    if (results.length) adopt(next)
    finishUpload(results, failures, next)
  }, [mode, journals, adopt, finishUpload])

  const confirmImport = useCallback(async (how: 'replace' | 'append') => {
    if (!pendingImport) return
    const { results, failures } = pendingImport
    setPendingImport(null)
    try {
      for (const r of results) {
        const records = (r.records as (Downtime | Defect)[]).map(({ dbId: _d, createdBy: _c, ...rest }) => rest)
        await api.post('/api/import', { kind: r.kind, mode: how, records })
      }
      await loadServerData()
      finishUpload(results, failures, journals)
    } catch (e) {
      const err = e as ApiError
      const errs = (err.data?.errors as string[] | undefined) ?? []
      setReport({ tone: 'danger', items: [], failures: [err.message + (errs.length ? ': ' + errs.join('; ') : '')], mismatch: '' })
    }
  }, [pendingImport, loadServerData, finishUpload, journals])

  const resetDefaults = useCallback(async () => {
    if (mode === 'app') {
      await api.post('/api/admin/reset-data')
      await loadServerData()
      notify({ tone: 'info', title: 'Исходные данные возвращены' })
      return
    }
    if (mode === 'sealed') {
      adopt(sealedRef.current)
      setReport(null)
      notify({ tone: 'info', title: 'Исходные данные возвращены' })
      return
    }
    if (__STANDALONE__) {
      const { loadDefaultJournals } = await import('@/data/default')
      adopt(toJournals(loadDefaultJournals(), true, EMPTY))
      setReport(null)
      notify({ tone: 'info', title: 'Исходные данные возвращены' })
    }
  }, [mode, adopt, loadServerData, notify])

  // ---------------------------------------------------------------- записи журналов
  const saveRecord = useCallback(async (kind: Kind, rec: Record<string, unknown>, dbId?: number) => {
    if (dbId == null) await api.post('/api/records/' + kind, { record: rec })
    else await api.put('/api/records/' + kind + '/' + dbId, { record: rec })
    await loadServerData(true)
    const date = String(rec.date ?? '')
    const cur = filtersRef.current
    const widened = !!date && !!cur.from && (date < cur.from || date > cur.to)
    if (widened) setFiltersState((c) => ({ ...c, from: date < c.from ? date : c.from, to: date > c.to ? date : c.to }))
    notify({ tone: 'success', title: dbId == null ? 'Запись добавлена' : 'Запись сохранена', text: widened ? 'Дата записи вне выбранного периода — период расширен.' : undefined })
  }, [loadServerData, notify])

  const deleteRecord = useCallback(async (kind: Kind, dbId: number) => {
    await api.del('/api/records/' + kind + '/' + dbId)
    await loadServerData(true)
    notify({ tone: 'success', title: 'Запись удалена' })
  }, [loadServerData, notify])

  const canReset = mode === 'demo' || mode === 'sealed' ? !((journals.downtime?.isDefault ?? true) && (journals.defects?.isDefault ?? true)) : false

  const value: Store = {
    mode, serverInfo, user, perms, showMoney, journals, filters, params, sheet, report, toast, bounds, presets, shops, F, summary, insights, canReset, pendingImport,
    setSheet, setFilters, setParams, upload, confirmImport, cancelImport: () => setPendingImport(null), resetDefaults: () => { void resetDefaults() }, dismissReport: () => setReport(null),
    notify, login, logout, changePassword, saveRecord, deleteRecord,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
