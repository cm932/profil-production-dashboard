import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Pencil, Plus, Trash2 } from 'lucide-react'
import { Dialog } from '@/components/Dialog'
import { RecordDialog } from '@/components/RecordDialog'
import { Button, Segmented } from '@/components/ui'
import { useExporting } from '@/hooks/useExporting'
import { hours, nf, ruDate, SHIFT_NAME } from '@/lib/format'
import { sum } from '@/lib/model'
import { canModifyRecord } from '@/lib/roles'
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

const ROW_H = 46 // высота строки таблицы (VOLT: 44 + линия)

export function DataSheet() {
  const { F, filters, journals, user, perms, mode, deleteRecord } = useStore()
  const exporting = useExporting()
  // оператору ОТК простои недоступны — журнал простоев ему не показываем
  const kinds: Kind[] = user?.role === 'otk' ? ['defects'] : ['downtime', 'defects']
  const [kind, setKind] = useState<Kind>(kinds[0])
  const [editing, setEditing] = useState<{ rec: Downtime | Defect | null } | null>(null)
  const [deleting, setDeleting] = useState<Downtime | Defect | null>(null)
  const [delErr, setDelErr] = useState('')
  const canAdd = mode === 'app' && !!perms.records[kind]
  const showActions = mode === 'app' && !!perms.records[kind]
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<{ key: string | null; dir: 1 | -1 }>({ key: null, dir: 1 })
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(12)
  const wrapRef = useRef<HTMLDivElement>(null)
  const cols = COLS[kind]

  // Строк на странице — сколько помещается в карточку: таблица без прокрутки, листается пагинацией
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const calc = () => setPageSize(Math.max(5, Math.floor((el.clientHeight - 44) / ROW_H)))
    calc()
    const ro = new ResizeObserver(calc)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

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

  const pages = Math.max(1, Math.ceil(rows.length / pageSize))
  useEffect(() => { setPage(0) }, [filters, kind, q, sort]) // не при обновлении данных: после правки записи человек остаётся на своей странице
  const cur = Math.min(page, pages - 1)
  // В PDF нужны все строки (на экране — одна страница)
  const shown = exporting ? rows : rows.slice(cur * pageSize, cur * pageSize + pageSize)

  const j = journals[kind]
  const dtRows = kind === 'downtime' ? (rows as Downtime[]) : []
  const totMin = sum(dtRows, (r) => r.min)
  const totLoss = sum(dtRows.filter((r) => !r.planned), (r) => r.min)
  const totPcs = kind === 'defects' ? sum(rows as Defect[], (r) => r.qty) : 0

  return (
    <SheetFrame id="data">
      <div className="table-tools">
        <div className="tools-left no-print">
        <Segmented label="Журнал" value={kind} onChange={(v) => { setKind(v); setSort({ key: null, dir: 1 }) }}
          items={kinds.map((k) => ({ id: k, label: k === 'downtime' ? 'Журнал простоев' : 'Журнал брака' }))} />
        <input id="dSearch" className="input" type="search" placeholder="Поиск по любому полю…" aria-label="Поиск" value={q} onChange={(e) => setQ(e.target.value)} />
        {canAdd && <Button id="addRecord" onClick={() => setEditing({ rec: null })}><Plus size={16} strokeWidth={1.5} />Добавить запись</Button>}
        </div>
        <div className="table-totals" id="dTotals" data-kind={kind} data-rows={rows.length}
          data-total-min={kind === 'downtime' ? totMin : undefined} data-loss-min={kind === 'downtime' ? totLoss : undefined} data-pieces={kind === 'defects' ? totPcs : undefined}>
          Записей: <b>{nf(rows.length)}</b> из {nf(j?.records.length ?? 0)}
          {kind === 'downtime'
            ? <> · Длительность: <b>{nf(totMin)} мин</b> ({hours(totMin)} ч), внеплановые <b>{nf(totLoss)} мин</b> ({hours(totLoss)} ч)</>
            : <> · Забраковано: <b>{nf(totPcs)} шт</b></>}
          {j && <> · {j.fileName}</>}
        </div>
      </div>

      <div className="card fit-card table-card">
        <div className="table-wrap" ref={wrapRef}>
          <table className="tbl" id="dTable">
            <thead>
              <tr>
                {cols.map((c) => (
                  <th key={c.key} className={c.num ? 'r' : undefined} onClick={() => setSort((s) => (s.key === c.key ? { key: c.key, dir: (s.dir * -1) as 1 | -1 } : { key: c.key, dir: 1 }))}>
                    {c.title}{sort.key === c.key && <span className="arr">{sort.dir > 0 ? '▲' : '▼'}</span>}
                  </th>
                ))}
                {showActions && <th className="no-print" style={{ cursor: 'default' }}>Действия</th>}
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => (
                <tr key={i}>
                  {cols.map((c) => {
                    const v = (r as unknown as Record<string, unknown>)[c.key]
                    return <td key={c.key} className={[c.num ? 'r' : '', c.mono ? 'mono' : '', c.dim ? 'dim' : ''].join(' ').trim() || undefined}>{c.fmt ? (c.fmt as (x: unknown) => string)(v) : String(v)}</td>
                  })}
                  {showActions && (
                    <td className="no-print row-actions">
                      {canModifyRecord(user, perms, kind, r) && (
                        <>
                          <Button size="sm" variant="ghost" aria-label="Изменить запись" onClick={() => setEditing({ rec: r })}><Pencil size={15} strokeWidth={1.5} /></Button>
                          <Button size="sm" variant="ghost" aria-label="Удалить запись" onClick={() => { setDelErr(''); setDeleting(r) }}><Trash2 size={15} strokeWidth={1.5} /></Button>
                        </>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <nav className="pager no-print" aria-label="Страницы таблицы">
        <span className="pager-info">Строки {rows.length ? cur * pageSize + 1 : 0}–{Math.min(rows.length, cur * pageSize + pageSize)} из {nf(rows.length)}</span>
        <div className="pager-btns">
          <Button size="sm" variant="ghost" aria-label="Первая страница" disabled={cur === 0} onClick={() => setPage(0)}><ChevronsLeft size={16} strokeWidth={1.5} /></Button>
          <Button size="sm" variant="ghost" aria-label="Предыдущая страница" disabled={cur === 0} onClick={() => setPage(cur - 1)}><ChevronLeft size={16} strokeWidth={1.5} /></Button>
          <span className="pager-page">Страница <b>{cur + 1}</b> из {pages}</span>
          <Button size="sm" variant="ghost" aria-label="Следующая страница" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}><ChevronRight size={16} strokeWidth={1.5} /></Button>
          <Button size="sm" variant="ghost" aria-label="Последняя страница" disabled={cur >= pages - 1} onClick={() => setPage(pages - 1)}><ChevronsRight size={16} strokeWidth={1.5} /></Button>
        </div>
      </nav>
      {editing && <RecordDialog key={editing.rec?.dbId ?? 'new'} open kind={kind} record={editing.rec} onClose={() => setEditing(null)} />}
      <Dialog open={!!deleting} onClose={() => setDeleting(null)} title="Удалить запись?" width={440}
        footer={<div className="dialog-actions"><Button variant="ghost" onClick={() => setDeleting(null)}>Отмена</Button>
          <Button variant="danger" id="confirmDelete" onClick={async () => { try { await deleteRecord(kind, deleting!.dbId!); setDeleting(null) } catch (e) { setDelErr((e as Error).message) } }}>Удалить</Button></div>}>
        <p>Запись {deleting ? 'от ' + ruDate(deleting.date) : ''} будет удалена из журнала. Действие попадёт в журнал действий.</p>
        {delErr && <div className="auth-error" role="alert">{delErr}</div>}
      </Dialog>
    </SheetFrame>
  )
}
