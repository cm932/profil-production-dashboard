// Форма добавления и правки записи журнала. Значения подсказываются из уже накопленных данных (станки, операции, причины),
// но сервер проверяет всё заново: форма только помогает не ошибиться.
import { useMemo, useState, type FormEvent } from 'react'
import { Dialog } from '@/components/Dialog'
import { Button, Field } from '@/components/ui'
import type { ApiError } from '@/lib/api'
import type { Defect, Downtime, Kind } from '@/lib/types'
import { useStore } from '@/store'

interface Props { open: boolean; kind: Kind; record: Downtime | Defect | null; onClose: () => void }

const today = () => new Date().toISOString().slice(0, 10)

export function RecordDialog({ open, kind, record, onClose }: Props) {
  const { journals, user, saveRecord } = useStore()
  const edit = record?.dbId != null
  const dt = record as Downtime | null
  const df = record as Defect | null

  const lists = useMemo(() => {
    const D = journals.downtime?.records ?? []
    const B = journals.defects?.records ?? []
    const machines = new Map<string, { name: string; op: string; shop: string }>()
    D.forEach((r) => machines.set(r.machine, { name: r.machineName, op: r.op, shop: r.shop }))
    return {
      machines, ops: [...new Set([...D.map((r) => r.op), ...B.map((r) => r.op)])].sort(),
      shops: [...new Set(D.map((r) => r.shop).filter(Boolean))].sort(),
      reasons: [...new Set(D.map((r) => r.reason))].sort(), types: [...new Set(B.map((r) => r.type))].sort(),
    }
  }, [journals])

  const [f, setF] = useState<Record<string, string | boolean>>((): Record<string, string | boolean> => kind === 'downtime'
    ? { date: dt?.date ?? today(), machine: dt?.machine ?? '', machineName: dt?.machineName ?? '', op: dt?.op ?? '', shop: user?.role === 'chief' ? (user.shop ?? '') : (dt?.shop ?? ''), shift: String(dt?.shift ?? 1), reason: dt?.reason ?? '', planned: dt?.planned ?? false, min: String(dt?.min ?? '') }
    : { date: df?.date ?? today(), type: df?.type ?? '', op: df?.op ?? '', qty: String(df?.qty ?? ''), order: df?.order ?? '', shift: String(df?.shift ?? 1) })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k: string, v: string | boolean) => setF((cur) => ({ ...cur, [k]: v }))

  // Выбрали известный станок — подставляем его наименование, операцию и цех
  const pickMachine = (m: string) => {
    const k = lists.machines.get(m)
    setF((cur) => ({ ...cur, machine: m, ...(k ? { machineName: k.name, op: k.op, shop: user?.role === 'chief' ? cur.shop : k.shop } : {}) }))
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setErr('')
    const rec = kind === 'downtime'
      ? { date: f.date, machine: f.machine, machineName: f.machineName, op: f.op, shop: f.shop, shift: Number(f.shift), reason: f.reason, planned: !!f.planned, min: f.min === '' ? NaN : Number(f.min) }
      : { date: f.date, type: f.type, op: f.op, qty: f.qty === '' ? NaN : Number(f.qty), order: f.order, shift: Number(f.shift) }
    try { await saveRecord(kind, rec, edit ? record!.dbId : undefined); onClose() } catch (x) { setErr((x as ApiError).message) } finally { setBusy(false) }
  }

  const title = (edit ? 'Правка записи' : 'Новая запись') + (kind === 'downtime' ? ': простой' : ': брак')
  const shiftField = (
    <Field label="Смена"><select className="select" value={String(f.shift)} onChange={(e) => set('shift', e.target.value)}><option value="1">День</option><option value="2">Ночь</option></select></Field>
  )

  return (
    <Dialog open={open} onClose={onClose} title={title} width={560}>
      <form onSubmit={submit} className="rec-form" id="recordForm">
        <div className="rec-grid">
          <Field label="Дата"><input data-autofocus className="input" type="date" required value={String(f.date)} onChange={(e) => set('date', e.target.value)} /></Field>
          {shiftField}
          {kind === 'downtime' ? (
            <>
              <Field label="Станок"><input className="input" list="dl-machines" required value={String(f.machine)} onChange={(e) => pickMachine(e.target.value)} /><datalist id="dl-machines">{[...lists.machines.keys()].map((m) => <option key={m} value={m} />)}</datalist></Field>
              <Field label="Наименование станка"><input className="input" value={String(f.machineName)} onChange={(e) => set('machineName', e.target.value)} /></Field>
              <Field label="Операция"><input className="input" list="dl-ops" required value={String(f.op)} onChange={(e) => set('op', e.target.value)} /></Field>
              <Field label="Цех">
                {user?.role === 'chief'
                  ? <input className="input" value={String(f.shop)} readOnly aria-readonly title="Начальник цеха записывает только в свой цех" />
                  : <select className="select" value={String(f.shop)} onChange={(e) => set('shop', e.target.value)}><option value="">—</option>{lists.shops.map((s) => <option key={s}>{s}</option>)}</select>}
              </Field>
              <Field label="Причина простоя"><input className="input" list="dl-reasons" required value={String(f.reason)} onChange={(e) => { set('reason', e.target.value); if (e.target.value === 'Плановое ТО') set('planned', true) }} /></Field>
              <Field label="Плановый простой (ТО)">
                <select className="select" value={f.planned ? 'да' : 'нет'} onChange={(e) => set('planned', e.target.value === 'да')}><option>нет</option><option>да</option></select>
              </Field>
              <Field label="Длительность, мин"><input className="input" type="number" min={0} max={1440} step={1} required value={String(f.min)} onChange={(e) => set('min', e.target.value)} /></Field>
            </>
          ) : (
            <>
              <Field label="Тип дефекта"><input className="input" list="dl-types" required value={String(f.type)} onChange={(e) => set('type', e.target.value)} /></Field>
              <Field label="Операция-источник"><input className="input" list="dl-ops" required value={String(f.op)} onChange={(e) => set('op', e.target.value)} /></Field>
              <Field label="Количество, шт"><input className="input" type="number" min={0} max={10000} step={1} required value={String(f.qty)} onChange={(e) => set('qty', e.target.value)} /></Field>
              <Field label="Заказ"><input className="input" value={String(f.order)} placeholder="З-1234" onChange={(e) => set('order', e.target.value)} /></Field>
            </>
          )}
        </div>
        <datalist id="dl-ops">{lists.ops.map((o) => <option key={o} value={o} />)}</datalist>
        <datalist id="dl-reasons">{lists.reasons.map((o) => <option key={o} value={o} />)}</datalist>
        <datalist id="dl-types">{lists.types.map((o) => <option key={o} value={o} />)}</datalist>
        {err && <div className="auth-error" role="alert">{err}</div>}
        <div className="dialog-actions">
          <Button type="button" variant="ghost" onClick={onClose}>Отмена</Button>
          <Button type="submit" variant="secondary" disabled={busy}>{busy ? 'Сохраняю…' : edit ? 'Сохранить' : 'Добавить запись'}</Button>
        </div>
      </form>
    </Dialog>
  )
}
