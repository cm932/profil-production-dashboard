// Модель: даты, фильтры и расчёт показателей. Все даты — строки ГГГГ-ММ-ДД, все расчёты дат идут в UTC
// (иначе в часовом поясе UTC+3 «плюс 7 дней» превращается в 6).
import { SHIFT_NAME, ruDate } from './format'
import type { Defect, Downtime, Filters, Journal, Params } from './types'

export const addDays = (iso: string, n: number) => {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
export const daysBetween = (a: string, b: string) =>
  Math.round((new Date(b + 'T00:00:00Z').getTime() - new Date(a + 'T00:00:00Z').getTime()) / 864e5) + 1

export interface Journals {
  downtime: Journal<Downtime> | null
  defects: Journal<Defect> | null
}

export function dataBounds(j: Journals): { min: string; max: string } | null {
  const dates = (j.downtime?.records ?? []).map((r) => r.date).concat((j.defects?.records ?? []).map((r) => r.date)).sort()
  return dates.length ? { min: dates[0], max: dates[dates.length - 1] } : null
}

export interface Filtered {
  D: Downtime[]      // простои с учётом периода, смены и цеха
  B: Defect[]        // брак с учётом периода и смены (цеха в журнале брака нет)
  Dall: Downtime[]   // простои без фильтра цеха: соседний передел может быть в другом цехе
}

export function applyFilters(j: Journals, f: Filters): Filtered {
  const inP = (r: { date: string }) => r.date >= f.from && r.date <= f.to
  const inS = (r: { shift: number }) => f.shift === 'all' || r.shift === f.shift
  const all = (j.downtime?.records ?? []).filter((r) => inP(r) && inS(r))
  return {
    D: all.filter((r) => f.shop === 'all' || r.shop === f.shop),
    B: (j.defects?.records ?? []).filter((r) => inP(r) && inS(r)),
    Dall: all,
  }
}

export const shownShifts = (f: Filters): (1 | 2)[] => (f.shift === 'all' ? [1, 2] : [f.shift])

/** single — у пользователя один цех (начальник цеха): ему по цеху отобраны и простои, и брак, пометка «(простои)» не нужна */
export function filterCaption(f: Filters, single = false) {
  const period = f.from && f.to ? ruDate(f.from) + ' — ' + ruDate(f.to) : 'весь период'
  const shift = f.shift === 'all' ? 'обе смены' : 'смена: ' + SHIFT_NAME[f.shift].toLowerCase()
  const shop = f.shop === 'all' ? 'все цеха' : f.shop.toLowerCase() + (single ? '' : ' (простои)')
  return period + ' · ' + shift + ' · ' + shop
}

export function sumBy<T>(arr: T[], key: (r: T) => string, val: (r: T) => number): Map<string, number> {
  const m = new Map<string, number>()
  for (const r of arr) m.set(key(r), (m.get(key(r)) ?? 0) + val(r))
  return m
}
export const sortedDesc = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1])
export const sum = <T,>(a: T[], f: (r: T) => number) => a.reduce((s, r) => s + f(r), 0)

export interface Summary {
  lossMin: number
  plannedMin: number
  pieces: number
  machines: number
  days: number
  shifts: number
  fundMin: number
  availability: number
  lossRub: number
  defectRub: number
  defectCases: number
  orders: number
}

export function computeSummary(j: Journals, f: Filters, p: Params, F: Filtered): Summary {
  const lossMin = sum(F.D.filter((r) => !r.planned), (r) => r.min)
  const plannedMin = sum(F.D.filter((r) => r.planned), (r) => r.min)
  const pieces = sum(F.B, (r) => r.qty)
  // Фонд времени: станки (из журнала с учётом цеха) × дни периода × число смен × длительность смены
  const machines = new Set((j.downtime?.records ?? []).filter((r) => f.shop === 'all' || r.shop === f.shop).map((r) => r.machine)).size
  const days = f.from && f.to ? daysBetween(f.from, f.to) : 0
  const shifts = f.shift === 'all' ? 2 : 1
  const fundMin = machines * days * shifts * p.shiftHours * 60
  return {
    lossMin, plannedMin, pieces, machines, days, shifts, fundMin,
    availability: fundMin ? (fundMin - lossMin - plannedMin) / fundMin : 0,
    lossRub: (lossMin / 60) * p.hourCost,
    defectRub: pieces * p.pieceCost,
    defectCases: F.B.length,
    orders: new Set(F.B.map((r) => r.order).filter(Boolean)).size,
  }
}

/** Разница периодов журналов: панель считает по общему периоду, а доступность по «дырявым» данным неточна. */
export function periodMismatch(j: Journals): string {
  const b = (x: Journal<{ date: string }> | null) => {
    if (!x || !x.records.length) return null
    const d = x.records.map((r) => r.date).sort()
    return { from: d[0], to: d[d.length - 1] }
  }
  const a = b(j.downtime), c = b(j.defects)
  if (!a || !c || (a.from === c.from && a.to === c.to)) return ''
  return (
    'Периоды журналов не совпадают — простои ' + ruDate(a.from) + ' — ' + ruDate(a.to) + ', брак ' + ruDate(c.from) + ' — ' + ruDate(c.to) +
    '. Панель показывает общий период, поэтому доступность станков и сравнения по неделям могут быть неточными: сузьте фильтр «Период» до дат, где есть оба журнала.'
  )
}

// ---------- Недели, выровненные по концу периода ----------
export interface Win { from: string; to: string; label: string; title: string }

/** Неполная неделя в начале периода не берётся, чтобы не искажать сравнение. */
export function windows(from: string, to: string): Win[] {
  if (!from || !to) return []
  const n = Math.floor(daysBetween(from, to) / 7)
  const out: Win[] = []
  const dm = (d: string) => d.slice(8) + '.' + d.slice(5, 7)
  for (let i = 0; i < n; i++) {
    const end = addDays(to, -7 * (n - 1 - i)), start = addDays(end, -6)
    out.push({ from: start, to: end, label: dm(start), title: dm(start) + ' — ' + dm(end) })
  }
  return out
}
export const inWin = (r: { date: string }, w: Win) => r.date >= w.from && r.date <= w.to
