import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { loadDefaultJournals } from '@/data/default'
import { buildInsights, type Insight } from '@/lib/insights'
import { addDays, applyFilters, computeSummary, dataBounds, periodMismatch, type Filtered, type Journals, type Summary } from '@/lib/model'
import { readFile } from '@/lib/parse'
import type { Filters, LoadResult, Params, SheetId } from '@/lib/types'

export interface Preset { label: string; title?: string; from: string; to: string }

export interface ReportItem { title: string; fileName: string; loaded: number; total: number; errors: string[] }
export interface Report {
  tone: 'success' | 'warning' | 'danger'
  items: ReportItem[]
  failures: string[]
  mismatch: string
}
export interface ToastMsg { id: number; tone: 'success' | 'warning' | 'danger' | 'info'; title: string; text?: string }

interface Store {
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
  isDefault: boolean
  setSheet: (s: SheetId) => void
  setFilters: (p: Partial<Filters>) => void
  setParams: (p: Partial<Params>) => void
  upload: (files: File[]) => Promise<void>
  resetDefaults: () => void
  dismissReport: () => void
  notify: (t: Omit<ToastMsg, 'id'>) => void
}

const Ctx = createContext<Store | null>(null)
export const useStore = () => {
  const s = useContext(Ctx)
  if (!s) throw new Error('useStore вне провайдера')
  return s
}

const SHEETS: SheetId[] = ['summary', 'downtime', 'defects', 'data']
const sheetFromHash = (): SheetId => {
  const h = location.hash.slice(1) as SheetId
  return SHEETS.includes(h) ? h : 'summary'
}

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

export function StoreProvider({ children }: { children: ReactNode }) {
  const [journals, setJournals] = useState<Journals>(() => toJournals(loadDefaultJournals(), true, { downtime: null, defects: null }))
  const [params, setParamsState] = useState<Params>(loadParams)
  const [sheet, setSheetState] = useState<SheetId>(sheetFromHash)
  const [report, setReport] = useState<Report | null>(null)
  const [toast, setToast] = useState<ToastMsg | null>(null)
  const toastId = useRef(0)

  const bounds = useMemo(() => dataBounds(journals), [journals])
  const [filters, setFiltersState] = useState<Filters>(() => ({ from: bounds?.min ?? '', to: bounds?.max ?? '', shift: 'all', shop: 'all' }))

  const shops = useMemo(() => [...new Set((journals.downtime?.records ?? []).map((r) => r.shop).filter(Boolean))].sort(), [journals])

  // Быстрые периоды: весь период и недели по 7 дней от начала данных
  const presets = useMemo<Preset[]>(() => {
    if (!bounds) return []
    const out: Preset[] = [{ label: 'Весь период', from: bounds.min, to: bounds.max }]
    const dm = (d: string) => d.slice(8) + '.' + d.slice(5, 7) + '.' + d.slice(0, 4)
    for (let start = bounds.min, i = 1; start <= bounds.max; start = addDays(start, 7), i++) {
      const end = addDays(start, 6) > bounds.max ? bounds.max : addDays(start, 6)
      out.push({ label: 'Нед. ' + i, title: dm(start) + ' — ' + dm(end), from: start, to: end })
    }
    return out
  }, [bounds])

  const F = useMemo(() => applyFilters(journals, filters), [journals, filters])
  const summary = useMemo(() => computeSummary(journals, filters, params, F), [journals, filters, params, F])
  const insights = useMemo(() => buildInsights({ F, f: filters, p: params, s: summary }), [F, filters, params, summary])

  const setFilters = useCallback((p: Partial<Filters>) => {
    setFiltersState((cur) => {
      const next = { ...cur, ...p }
      // период: «с» не позже «по»
      if (p.from && next.to && p.from > next.to) next.to = p.from
      if (p.to && next.from && p.to < next.from) next.from = p.to
      return next
    })
  }, [])

  const setParams = useCallback((p: Partial<Params>) => {
    setParamsState((cur) => {
      const next = { ...cur }
      if (p.shiftHours != null && p.shiftHours > 0 && p.shiftHours <= 24) next.shiftHours = p.shiftHours
      if (p.hourCost != null && p.hourCost >= 0) next.hourCost = p.hourCost
      if (p.pieceCost != null && p.pieceCost >= 0) next.pieceCost = p.pieceCost
      try { localStorage.setItem('profil.params', JSON.stringify(next)) } catch { /* нет доступа к хранилищу */ }
      return next
    })
  }, [])

  const setSheet = useCallback((s: SheetId) => {
    setSheetState(s)
    if (location.hash !== '#' + s) history.replaceState(null, '', '#' + s)
  }, [])
  useEffect(() => {
    const h = () => setSheetState(sheetFromHash())
    window.addEventListener('hashchange', h)
    return () => window.removeEventListener('hashchange', h)
  }, [])

  const notify = useCallback((t: Omit<ToastMsg, 'id'>) => setToast({ ...t, id: ++toastId.current }), [])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4200)
    return () => clearTimeout(t)
  }, [toast])

  // Новые данные → период по границам новых данных; цех сбрасывается, если такого больше нет
  const adopt = useCallback((next: Journals) => {
    const b = dataBounds(next)
    const s = new Set((next.downtime?.records ?? []).map((r) => r.shop))
    setJournals(next)
    setFiltersState((cur) => ({ ...cur, from: b?.min ?? '', to: b?.max ?? '', shop: cur.shop !== 'all' && !s.has(cur.shop) ? 'all' : cur.shop }))
  }, [])

  const upload = useCallback(async (files: File[]) => {
    const results: LoadResult[] = [], failures: string[] = []
    for (const file of files) {
      try { results.push(await readFile(file)) } catch (e) { failures.push((e as Error).message) }
    }
    const next = results.length ? toJournals(results, false, journals) : journals
    if (results.length) adopt(next)
    const mismatch = periodMismatch(next)
    const items: ReportItem[] = results.map((r) => ({ title: r.title, fileName: r.fileName, loaded: r.records.length, total: r.total, errors: r.errors }))
    const warn = items.some((i) => i.errors.length || !i.total) || !!mismatch || (failures.length > 0 && results.length > 0)
    const tone: Report['tone'] = results.length ? (warn ? 'warning' : 'success') : 'danger'
    setReport({ tone, items, failures, mismatch })
    if (results.length) {
      const n = items.reduce((s, i) => s + i.loaded, 0)
      notify({ tone: warn ? 'warning' : 'success', title: 'Данные загружены', text: 'Записей: ' + n + (warn ? '. Есть замечания — см. отчёт под шапкой.' : '. Панель пересчитана.') })
    }
  }, [journals, adopt, notify])

  const resetDefaults = useCallback(() => {
    adopt(toJournals(loadDefaultJournals(), true, { downtime: null, defects: null }))
    setReport(null)
    notify({ tone: 'info', title: 'Исходные данные возвращены' })
  }, [adopt, notify])

  const isDefault = !!journals.downtime?.isDefault && !!journals.defects?.isDefault

  const value: Store = {
    journals, filters, params, sheet, report, toast, bounds, presets, shops, F, summary, insights, isDefault,
    setSheet, setFilters, setParams, upload, resetDefaults, dismissReport: () => setReport(null), notify,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
