import { useMemo, useState } from 'react'
import { Segmented } from '@/components/ui'
import { hours, nf, ruDate, SHIFT_NAME } from '@/lib/format'
import { sum } from '@/lib/model'
import type { Defect, Downtime } from '@/lib/types'
import { useStore } from '@/store'
import { SheetFrame } from './SheetFrame'

type Kind = 'downtime' | 'defects'
interface Col { key: string; title: string; num?: boolean; mono?: boolean; dim?: boolean; fmt?: (v: never) => string }

const COLS: Record<Kind, Col[]> = {
  downtime: [
    { key: 'id', title: 'ID', mono: true }, { key: 'date', title: 'Дата', fmt: ruDate as (v: never) => string, mono: true }, { key: 'machine', title: 'Станок' },
    { key: 'machineName', title: 'Наименование', dim: true }, { key: 'op', title: 'Операция' }, { key: 'shop', title: 'Цех' },
    { key: 'shift', title: 'Смена', fmt: ((v: number) => SHIFT_NAME[v]) as (v: never) => string }, { key: 'reason', title: 'Причина простоя' },
    { key: 'planned', title: 'Плановый', fmt: ((v: boolean) => (v ? 'да' : 'нет')) as (v: never) => string }, { key: 'min', title: 'Длительность, мин', num: true },
  ],
  defects: [
    { key: 'id', title: '№', mono: true }, { key: 'date', title: 'Дата контроля', fmt: ruDate as (v: never) => string, mono: true }, { key: 'type', title: 'Тип дефекта' },
    { key: 'op', title: 'Операция-источник' }, { key: 'qty', title: 'Кол-во, шт', num: true }, { key: 'order', title: 'Заказ', mono: true },
    { key: 'shift', title: 'Смена', fmt: ((v: number) => SHIFT_NAME[v]) as (v: never) => string },
  ],
}

export function DataSheet() {
  const { F, journals } = useStore()
  const [kind, setKind] = useState<Kind>('downtime')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<{ key: string | null; dir: 1 | -1 }>({ key: null, dir: 1 })
  const cols = COLS[kind]

  const rows = useMemo(() => {
    let r = (kind === 'downtime' ? F.D : F.B) as (Downtime | Defect)[]
    const needle = q.trim().toLowerCase()
    if (needle) r = r.filter((row) => cols.some((c) => String(c.fmt ? (c.fmt as (v: unknown) => string)((row as unknown as Record<string, unknown>)[c.key]) : (row as unknown as Record<string, unknown>)[c.key]).toLowerCase().includes(needle)))
    if (sort.key) {
      const k = sort.key
      r = r.slice().sort((a, b) => {
        const x = (a as unknown as Record<string, number | string | boolean>)[k], y = (b as unknown as Record<string, number | string | boolean>)[k]
        return (x > y ? 1 : x < y ? -1 : 0) * sort.dir
      })
    }
    return r
  }, [F, kind, q, sort, cols])

  const j = journals[kind]
  const dtRows = kind === 'downtime' ? (rows as Downtime[]) : []
  const totMin = sum(dtRows, (r) => r.min)
  const totLoss = sum(dtRows.filter((r) => !r.planned), (r) => r.min)
  const totPcs = kind === 'defects' ? sum(rows as Defect[], (r) => r.qty) : 0

  return (
    <SheetFrame id="data">
      <div className="table-tools">
        <Segmented label="Журнал" value={kind} onChange={(v) => { setKind(v); setSort({ key: null, dir: 1 }) }}
          items={[{ id: 'downtime', label: 'Журнал простоев' }, { id: 'defects', label: 'Журнал брака' }]} />
        <input id="dSearch" className="input" type="search" placeholder="Поиск по любому полю…" aria-label="Поиск" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="table-totals" id="dTotals" data-kind={kind} data-rows={rows.length}
        data-total-min={kind === 'downtime' ? totMin : undefined} data-loss-min={kind === 'downtime' ? totLoss : undefined} data-pieces={kind === 'defects' ? totPcs : undefined}>
        Показано записей: <b>{nf(rows.length)}</b> из {nf(j?.records.length ?? 0)}
        {kind === 'downtime'
          ? <> · Длительность: <b>{nf(totMin)} мин</b> ({hours(totMin)} ч), из них внеплановые <b>{nf(totLoss)} мин</b> ({hours(totLoss)} ч)</>
          : <> · Забраковано: <b>{nf(totPcs)} шт</b></>}
        {j && <> · Источник: {j.fileName}</>}
      </div>
      <div className="table-wrap">
        <table className="tbl" id="dTable">
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.key} className={c.num ? 'r' : undefined} onClick={() => setSort((s) => (s.key === c.key ? { key: c.key, dir: (s.dir * -1) as 1 | -1 } : { key: c.key, dir: 1 }))}>
                  {c.title}{sort.key === c.key && <span className="arr">{sort.dir > 0 ? '▲' : '▼'}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {cols.map((c) => {
                  const v = (r as unknown as Record<string, unknown>)[c.key]
                  return <td key={c.key} className={[c.num ? 'r' : '', c.mono ? 'mono' : '', c.dim ? 'dim' : ''].join(' ').trim() || undefined}>{c.fmt ? (c.fmt as (x: unknown) => string)(v) : String(v)}</td>
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SheetFrame>
  )
}
