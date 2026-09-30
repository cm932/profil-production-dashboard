// Графики панели на Bklit UI (столбцы, линии). Цвета — токены VOLT (viz.css), числа — постоянные подписи.
// Каждый график занимает всю высоту своей карточки (Frame измеряет её), поэтому лист собирается в экран без прокрутки.
// У каждого графика атрибут data-sum: сумма значений, поданных в график, — по нему независимая сверка сравнивает график с исходными данными.
import { useLayoutEffect, useRef, useState } from 'react'
import { curveMonotoneX } from '@visx/curve'
import { Bar } from '@/components/charts/bar'
import { BarChart } from '@/components/charts/bar-chart'
import { BarXAxis } from '@/components/charts/bar-x-axis'
import { BarYAxis } from '@/components/charts/bar-y-axis'
import { Grid } from '@/components/charts/grid'
import { Line } from '@/components/charts/line'
import { LineChart } from '@/components/charts/line-chart'
import { ChartTooltip } from '@/components/charts/tooltip'
import { reasonColor, reasonRank, shiftColor } from '@/lib/colors'
import { hours, nf, SHIFT_NAME } from '@/lib/format'
import { sortedDesc, sum, sumBy, type Win } from '@/lib/model'
import type { Defect, Downtime } from '@/lib/types'
import { BarValueLabels, DateTicks, SeriesEndLabels, ValueTicks } from './BarValueLabels'

const DUR = 480 // мс: график рисуется быстро (правило VOLT — не дольше 600)

/** Доля зазора между полосами так, чтобы толщина столбца была около target px (плотный стиль VOLT, а не «жирные» плашки). */
const gapFor = (n: number, height: number, vMargins: number, target: number) => {
  const step = (height - vMargins) / Math.max(1, n)
  return Math.max(0.12, Math.min(0.72, 1 - target / step))
}

/** Рамка графика: занимает всю доступную высоту карточки и сообщает её содержимому (нужна для толщины столбцов). */
function Frame({ name, sum: s, height, children }: { name: string; sum: number; height?: number; children: (h: number) => React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [h, setH] = useState(height ?? 260)
  useLayoutEffect(() => {
    if (height || !ref.current) return
    const el = ref.current
    const ro = new ResizeObserver(() => setH(Math.max(120, Math.round(el.clientHeight))))
    ro.observe(el)
    setH(Math.max(120, Math.round(el.clientHeight)))
    return () => ro.disconnect()
  }, [height])
  return (
    <div ref={ref} className={height ? 'chart-box' : 'chart-box chart-fill'} style={height ? { height } : undefined} data-chart={name} data-sum={Math.round(s * 1000) / 1000}>
      {children(h)}
    </div>
  )
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="legend">
      {items.map((i) => (
        <span key={i.label}><i style={{ background: i.color }} />{i.label}</span>
      ))}
    </div>
  )
}

const grid = <Grid vertical horizontal={false} strokeDasharray="0" numTicksColumns={5} />
const gridH = <Grid horizontal vertical={false} strokeDasharray="0" numTicksRows={4} />

// ============ Простои ============

/** Парето причин: столбцы отсортированы, у каждой причины свой (закреплённый) цвет; в подписи — часы и доля, накопительная — в подсказке. */
export function ParetoChart({ U, height }: { U: Downtime[]; height?: number }) {
  const rows = sortedDesc(sumBy(U, (r) => r.reason, (r) => r.min))
  const total = sum(rows, (r) => r[1])
  let cum = 0
  const cumShare = rows.map(([, v]) => ((cum += v) / total) * 100)
  const data = rows.map(([reason, min]) => ({ name: reason, [reason]: min / 60 }))
  return (
    <Frame name="pareto" sum={total / 60} height={height}>
      {(h) => (
        <BarChart data={data} orientation="horizontal" stacked aspectRatio="auto" className="h-full" animationDuration={DUR}
          margin={{ top: 4, right: 116, bottom: 26, left: 156 }} barGap={gapFor(rows.length, h, 30, 26)}>
          {grid}
          {rows.map(([reason]) => <Bar key={reason} dataKey={reason} fill={reasonColor(reason)} lineCap={4} />)}
          <BarYAxis />
          <ValueTicks format={(v) => nf(v) + ' ч'} />
          <BarValueLabels mode="stack" format={({ index }) => nf(rows[index][1] / 60, 1) + ' ч · ' + nf((rows[index][1] / total) * 100) + '%'} />
          <ChartTooltip showCrosshair={false} showDots={false} rows={(pt) => {
            const i = rows.findIndex((r) => r[0] === pt.name)
            if (i < 0) return []
            return [
              { color: reasonColor(rows[i][0]), label: 'Потери', value: nf(rows[i][1]) + ' мин (' + nf(rows[i][1] / 60, 1) + ' ч)' },
              { color: 'var(--text-muted)', label: 'Доля', value: nf((rows[i][1] / total) * 100, 1) + '%' },
              { color: 'var(--text-muted)', label: 'Накопительно', value: nf(cumShare[i], 1) + '%' },
            ]
          }} />
        </BarChart>
      )}
    </Frame>
  )
}

/** Станки: стопка по причинам, итог по станку справа. */
export function MachinesByReasonChart({ U, height }: { U: Downtime[]; height?: number }) {
  const opOf: Record<string, string> = {}
  U.forEach((r) => { opOf[r.machine] = r.op })
  const machines = sortedDesc(sumBy(U, (r) => r.machine, (r) => r.min)).map((x) => x[0])
  const reasons = [...new Set(U.map((r) => r.reason))].sort((a, b) => reasonRank(a) - reasonRank(b))
  const grid2 = sumBy(U, (r) => r.machine + '|' + r.reason, (r) => r.min)
  const data = machines.map((m) => {
    const row: Record<string, unknown> = { name: m + ' · ' + (opOf[m] ?? '').toLowerCase() }
    reasons.forEach((re) => { row[re] = (grid2.get(m + '|' + re) ?? 0) / 60 })
    return row
  })
  return (
    <>
      <Legend items={reasons.map((r) => ({ label: r, color: reasonColor(r) }))} />
      <Frame name="machines-reason" sum={sum(U, (r) => r.min) / 60} height={height}>
        {(h) => (
          <BarChart data={data} orientation="horizontal" stacked stackGap={2} aspectRatio="auto" className="h-full" animationDuration={DUR}
            margin={{ top: 4, right: 76, bottom: 26, left: 120 }} barGap={gapFor(machines.length, h, 30, 30)}>
            {grid}
            {reasons.map((re) => <Bar key={re} dataKey={re} fill={reasonColor(re)} lineCap={3} stackGap={2} />)}
            <BarYAxis />
            <ValueTicks format={(v) => nf(v) + ' ч'} />
            <BarValueLabels mode="stack" stackGap={2} format={({ total }) => nf(total, 1) + ' ч'} />
            <ChartTooltip showCrosshair={false} showDots={false} rows={(pt) =>
              reasons.filter((re) => typeof pt[re] === 'number' && (pt[re] as number) > 0)
                .map((re) => ({ color: reasonColor(re), label: re, value: nf((pt[re] as number) * 60) + ' мин' }))} />
          </BarChart>
        )}
      </Frame>
    </>
  )
}

/** Группы «день / ночь» по станкам (ч) или по операциям (шт) — один компонент на оба случая. */
function ShiftGroups({ name, cats, values, shifts, unit, dec, height }: {
  name: string; cats: string[]; values: Map<string, number>; shifts: (1 | 2)[]; unit: string; dec: number; height?: number
}) {
  const data = cats.map((c) => {
    const row: Record<string, unknown> = { name: c }
    shifts.forEach((s) => { row['s' + s] = values.get(c + '|' + s) ?? 0 })
    return row
  })
  let total = 0
  values.forEach((v) => { total += v })
  return (
    <>
      <Legend items={shifts.map((s) => ({ label: SHIFT_NAME[s], color: shiftColor(s) }))} />
      <Frame name={name} sum={total} height={height}>
        {(h) => (
          <BarChart data={data} orientation="horizontal" aspectRatio="auto" className="h-full" animationDuration={DUR}
            margin={{ top: 4, right: 76, bottom: 26, left: 84 }} barGap={gapFor(cats.length, h, 30, shifts.length * 18 + (shifts.length - 1) * 4)}>
            {grid}
            {shifts.map((s) => <Bar key={s} dataKey={'s' + s} fill={shiftColor(s)} lineCap={3} />)}
            <BarYAxis />
            <ValueTicks format={(v) => nf(v) + (unit === 'ч' ? ' ч' : '')} />
            <BarValueLabels mode="each" format={({ value }) => nf(value, dec) + (unit === 'ч' ? ' ч' : '')} />
            <ChartTooltip showCrosshair={false} showDots={false} rows={(pt) =>
              shifts.map((s) => ({ color: shiftColor(s), label: SHIFT_NAME[s], value: nf(pt['s' + s] as number, dec) + ' ' + unit }))} />
          </BarChart>
        )}
      </Frame>
    </>
  )
}

export function MachinesByShiftChart({ U, shifts, height }: { U: Downtime[]; shifts: (1 | 2)[]; height?: number }) {
  const machines = sortedDesc(sumBy(U, (r) => r.machine, (r) => r.min)).map((x) => x[0])
  const v = new Map<string, number>()
  sumBy(U, (r) => r.machine + '|' + r.shift, (r) => r.min).forEach((min, k) => v.set(k, min / 60))
  return <ShiftGroups name="machines-shift" cats={machines} values={v} shifts={shifts} unit="ч" dec={1} height={height} />
}

// ============ Брак ============

export function OpsByShiftChart({ B, shifts, height }: { B: Defect[]; shifts: (1 | 2)[]; height?: number }) {
  const ops = sortedDesc(sumBy(B, (r) => r.op, (r) => r.qty)).map((x) => x[0])
  const v = sumBy(B, (r) => r.op + '|' + r.shift, (r) => r.qty)
  return <ShiftGroups name="ops-shift" cats={ops} values={v} shifts={shifts} unit="шт" dec={0} height={height} />
}

/** Динамика брака по дням: столбцы-стопки «день + ночь». */
export function DailyDefectsChart({ B, days, shifts, height }: { B: Defect[]; days: string[]; shifts: (1 | 2)[]; height?: number }) {
  const m = sumBy(B, (r) => r.date + '|' + r.shift, (r) => r.qty)
  const data = days.map((d) => {
    const row: Record<string, unknown> = { name: d.slice(8) + '.' + d.slice(5, 7), full: d }
    shifts.forEach((s) => { row['s' + s] = m.get(d + '|' + s) ?? 0 })
    return row
  })
  const total = sum(B, (r) => r.qty)
  return (
    <>
      <Legend items={shifts.map((s) => ({ label: SHIFT_NAME[s], color: shiftColor(s) }))} />
      <Frame name="daily-defects" sum={total} height={height}>
        {() => (
          <BarChart data={data} stacked stackGap={2} aspectRatio="auto" className="h-full" animationDuration={DUR}
            margin={{ top: 8, right: 8, bottom: 30, left: 36 }} barGap={0.28}>
            {gridH}
            {shifts.map((s) => <Bar key={s} dataKey={'s' + s} fill={shiftColor(s)} lineCap={3} stackGap={2} />)}
            <BarXAxis maxLabels={7} />
            <ValueTicks format={(v) => nf(v)} />
            <ChartTooltip showCrosshair={false} showDots={false} rows={(pt) =>
              shifts.map((s) => ({ color: shiftColor(s), label: SHIFT_NAME[s], value: nf(pt['s' + s] as number) + ' шт' }))} />
          </BarChart>
        )}
      </Frame>
    </>
  )
}

/** Типы дефектов: доля от всего брака в подписи, операция-источник — в подсказке. */
export function DefectTypesChart({ B, height }: { B: Defect[]; height?: number }) {
  const opOf: Record<string, string> = {}
  B.forEach((r) => { opOf[r.type] = r.op })
  const rows = sortedDesc(sumBy(B, (r) => r.type, (r) => r.qty))
  const total = sum(rows, (r) => r[1])
  const data = rows.map(([t, q]) => ({ name: t, qty: q }))
  return (
    <Frame name="defect-types" sum={total} height={height}>
      {(h) => (
        <BarChart data={data} orientation="horizontal" aspectRatio="auto" className="h-full" animationDuration={DUR}
          margin={{ top: 4, right: 100, bottom: 26, left: 148 }} barGap={gapFor(rows.length, h, 30, 26)}>
          {grid}
          <Bar dataKey="qty" fill="var(--accent)" lineCap={4} />
          <BarYAxis />
          <ValueTicks format={(v) => nf(v)} />
          <BarValueLabels mode="each" format={({ value }) => nf(value) + ' шт · ' + nf((value / total) * 100) + '%'} />
          <ChartTooltip showCrosshair={false} showDots={false} rows={(pt) => [
            { color: 'var(--accent)', label: 'Брак', value: nf(pt.qty as number) + ' шт' },
            { color: 'var(--text-muted)', label: 'Операция', value: opOf[pt.name as string] ?? '' },
          ]} />
        </BarChart>
      )}
    </Frame>
  )
}

// ============ Линии по неделям ============

export interface LineSeries { label: string; color: string; data: number[] }

/** Недели по оси X, день и ночь линиями. Общий максимум передаётся снаружи, чтобы шкалы соседних графиков совпадали. */
export function WeeklyLines({ name, wins, series, ymax, height, decimals = 0, unit = 'шт' }: {
  name: string; wins: Win[]; series: LineSeries[]; ymax?: number; height?: number; unit?: string; decimals?: number
}) {
  const data = wins.map((w, i) => {
    const row: Record<string, unknown> = { date: new Date(w.from + 'T12:00:00'), cap: ymax ?? 0, title: w.title, label: w.label }
    series.forEach((s, si) => { row['v' + si] = s.data[i] })
    return row
  })
  const total = sum(series, (s) => sum(s.data, (v) => v))
  // Поля по краям оси времени: иначе первая и последняя точки обрезаются пополам областью графика
  const day = 864e5
  const pad: [Date, Date] = [new Date(+(data[0].date as Date) - 3 * day), new Date(+(data[data.length - 1].date as Date) + 3 * day)]
  return (
    <Frame name={name} sum={total} height={height}>
      {() => (
        <LineChart data={data} xDataKey="date" aspectRatio="auto" className="h-full" animationDuration={DUR} xDomain={pad}
          margin={{ top: 12, right: 36, bottom: 28, left: 34 }}>
          {gridH}
          {ymax != null && <Line dataKey="cap" stroke="transparent" strokeWidth={0} showHighlight={false} fadeEdges={false} />}
          {series.map((s, i) => (
            <Line key={s.label} dataKey={'v' + i} stroke={s.color} strokeWidth={2.5} curve={curveMonotoneX} fadeEdges={false} showMarkers
              markers={{ radius: 4.5, fill: s.color, stroke: 'var(--bg-surface)', strokeWidth: 2 } as never} />
          ))}
          <DateTicks format={(row) => String(row.label)} />
          <SeriesEndLabels keys={series.map((s, i) => ({ key: 'v' + i, color: s.color }))} format={(v) => nf(v, decimals)} />
          <ValueTicks format={(v) => nf(v, decimals)} />
          <ChartTooltip showDatePill={false} rows={(pt) => series.map((s, i) => ({ color: s.color, label: s.label, value: nf(pt['v' + i] as number, decimals) + ' ' + unit }))} />
        </LineChart>
      )}
    </Frame>
  )
}

/** Мини-график в детали вывода: столбцы-стопки по дням. */
export function MiniColumns({ name, labels, titles, series, height }: {
  name: string; labels: string[]; titles: string[]; series: LineSeries[]; height?: number
}) {
  const data = labels.map((l, i) => {
    const row: Record<string, unknown> = { name: l, title: titles[i] }
    series.forEach((s, si) => { row['v' + si] = s.data[i] })
    return row
  })
  return (
    <>
      <Legend items={series.map((s) => ({ label: s.label, color: s.color }))} />
      <Frame name={name} sum={sum(series, (s) => sum(s.data, (v) => v))} height={height}>
        {() => (
          <BarChart data={data} stacked stackGap={2} aspectRatio="auto" className="h-full" animationDuration={DUR}
            margin={{ top: 6, right: 6, bottom: 26, left: 34 }} barGap={0.3}>
            {gridH}
            {series.map((s, i) => <Bar key={s.label} dataKey={'v' + i} fill={s.color} lineCap={3} stackGap={2} />)}
            <BarXAxis maxLabels={7} />
            <ValueTicks count={3} format={(v) => nf(v, 1)} />
            <ChartTooltip showCrosshair={false} showDots={false} rows={(pt) =>
              series.map((s, i) => ({ color: s.color, label: s.label, value: hours((pt['v' + i] as number) * 60) + ' ч' }))} />
          </BarChart>
        )}
      </Frame>
    </>
  )
}
