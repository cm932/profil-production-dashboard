import { motion } from 'motion/react'
import { Card, CardHead } from '@/components/ui'
import { DailyDefectsChart, DefectTypesChart, Legend, OpsByShiftChart, WeeklyLines } from '@/components/viz/charts'
import { shiftColor } from '@/lib/colors'
import { reveal } from '@/lib/motion'
import { addDays, inWin, shownShifts, sortedDesc, sum, sumBy, windows } from '@/lib/model'
import { useStore } from '@/store'
import { SheetFrame } from './SheetFrame'

export function Defects() {
  const { F, filters } = useStore()
  const B = F.B
  if (!B.length) return <SheetFrame id="defects"><Card className="empty">Нет брака за выбранный период и смену.</Card></SheetFrame>

  const shifts = shownShifts(filters)
  const wins = windows(filters.from, filters.to)
  const ops = sortedDesc(sumBy(B, (r) => r.op, (r) => r.qty)).map((x) => x[0])
  const days: string[] = []
  for (let d = filters.from; d <= filters.to; d = addDays(d, 1)) days.push(d)

  // Одинаковая шкала на всех малых графиках — чтобы операции можно было сравнивать между собой
  const cnt = (op: string, s: 1 | 2) => wins.map((w) => sum(B.filter((r) => r.op === op && r.shift === s && inWin(r, w)), (r) => r.qty))
  const series = ops.map((o) => shifts.map((s) => ({ label: s === 1 ? 'День' : 'Ночь', color: shiftColor(s), data: cnt(o, s) })))
  const ymax = Math.max(1, ...series.flat().flatMap((x) => x.data))
  const top = Math.ceil((ymax * 1.1) / 5) * 5

  return (
    <SheetFrame id="defects">
      <div className="grid-2">
        <motion.div {...reveal(0)}>
          <Card>
            <CardHead title="Динамика брака по дням" sub="забраковано деталей за день; цвет — смена" />
            <DailyDefectsChart B={B} days={days} shifts={shifts} />
          </Card>
        </motion.div>
        <motion.div {...reveal(1)}>
          <Card>
            <CardHead title="Брак по операциям и сменам" sub="операция-источник, где возник дефект" />
            <OpsByShiftChart B={B} shifts={shifts} />
          </Card>
        </motion.div>
      </div>

      {wins.length >= 2 && (
        <>
          <div>
            <h2 className="block-title">Недели: день и ночь по каждой операции</h2>
            <p className="eyebrow block-sub">одинаковая шкала на всех графиках, чтобы операции можно было сравнивать</p>
          </div>
          <Legend items={shifts.map((s) => ({ label: s === 1 ? 'День' : 'Ночь', color: shiftColor(s) }))} />
          <div className="grid-4">
            {ops.map((o, i) => (
              <motion.div key={o} {...reveal(i + 2)}>
                <Card>
                  <CardHead title={o} />
                  <WeeklyLines name={'week-' + i} wins={wins} series={series[i]} ymax={top} />
                </Card>
              </motion.div>
            ))}
          </div>
        </>
      )}

      <div className="grid-2">
        <motion.div {...reveal(6)}>
          <Card>
            <CardHead title="Типы дефектов" sub="каждый тип привязан к операции-источнику (в подсказке)" />
            <DefectTypesChart B={B} />
          </Card>
        </motion.div>
      </div>
    </SheetFrame>
  )
}
