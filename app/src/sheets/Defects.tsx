import { Card, FitCard } from '@/components/ui'
import { DailyDefectsChart, DefectTypesChart, Legend, OpsByShiftChart, WeeklyLines } from '@/components/viz/charts'
import { shiftColor } from '@/lib/colors'
import { nf } from '@/lib/format'
import { addDays, inWin, shownShifts, sortedDesc, sum, sumBy, windows } from '@/lib/model'
import { useStore } from '@/store'
import { SheetFrame } from './SheetFrame'

/** Брак: две вкладки — «по дням» (динамика и операции) и «по неделям» (каждая операция отдельно, типы дефектов). */
export function Defects() {
  const { F, filters } = useStore()
  const B = F.B
  if (!B.length) return <SheetFrame id="defects"><Card className="empty">Нет брака за выбранный период и смену.</Card></SheetFrame>

  const shifts = shownShifts(filters)
  const wins = windows(filters.from, filters.to)
  const ops = sortedDesc(sumBy(B, (r) => r.op, (r) => r.qty)).map((x) => x[0])
  const days: string[] = []
  for (let d = filters.from; d <= filters.to; d = addDays(d, 1)) days.push(d)
  const total = sum(B, (r) => r.qty)

  // Одинаковая шкала на всех малых графиках — чтобы операции можно было сравнивать между собой
  const cnt = (op: string, s: 1 | 2) => wins.map((w) => sum(B.filter((r) => r.op === op && r.shift === s && inWin(r, w)), (r) => r.qty))
  const series = ops.map((o) => shifts.map((s) => ({ label: s === 1 ? 'День' : 'Ночь', color: shiftColor(s), data: cnt(o, s) })))
  const ymax = Math.max(1, ...series.flat().flatMap((x) => x.data))
  const top = Math.ceil((ymax * 1.1) / 5) * 5
  const legend = <Legend items={shifts.map((s) => ({ label: s === 1 ? 'День' : 'Ночь', color: shiftColor(s) }))} />

  return (
    <SheetFrame id="defects" views={[
      {
        id: 'days', label: 'По дням', render: () => (
          <div className="fit-row cols-2-1">
            <FitCard i={0} title="Сколько брака за день" sub={'Забраковано деталей, всего ' + nf(total) + ' шт; цвет — смена'}>
              <DailyDefectsChart B={B} days={days} shifts={shifts} />
            </FitCard>
            <FitCard i={1} title="На какой операции" sub="Операция-источник дефекта, шт">
              <OpsByShiftChart B={B} shifts={shifts} />
            </FitCard>
          </div>
        ),
      },
      {
        id: 'weeks', label: 'По неделям', render: () => (
          <div className="fit-row cols-2-1">
            <FitCard i={0} title="Недели: день и ночь по каждой операции" sub="Шкала одна на всех графиках, поэтому операции можно сравнивать" aside={legend}>
              {wins.length >= 2 ? (
                <div className="weekly-grid">
                  {ops.map((o, i) => (
                    <div key={o} className="weekly-cell">
                      <div className="weekly-title">{o}</div>
                      <WeeklyLines name={'week-' + i} wins={wins} series={series[i]} ymax={top} />
                    </div>
                  ))}
                </div>
              ) : <div className="empty">Для недельной динамики нужен период не короче двух недель.</div>}
            </FitCard>
            <FitCard i={1} title="Типы дефектов" sub="Операция-источник — в подсказке">
              <DefectTypesChart B={B} />
            </FitCard>
          </div>
        ),
      },
    ]} />
  )
}
