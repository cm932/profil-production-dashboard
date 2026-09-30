import { useState } from 'react'
import { motion } from 'motion/react'
import { Card, CardHead } from '@/components/ui'
import { Heatmap } from '@/components/viz/Heatmap'
import { MachinesByReasonChart, MachinesByShiftChart, ParetoChart } from '@/components/viz/charts'
import { hours, nf } from '@/lib/format'
import { reveal } from '@/lib/motion'
import { shownShifts, sortedDesc, sumBy } from '@/lib/model'
import { useStore } from '@/store'
import { SheetFrame } from './SheetFrame'

export function Downtime() {
  const { F, filters } = useStore()
  const [reason, setReason] = useState('all')
  const U = F.D.filter((r) => !r.planned)
  const P = F.D.filter((r) => r.planned)

  if (!U.length) return <SheetFrame id="downtime"><Card className="empty">Нет внеплановых простоев за выбранный период, смену и цех.</Card></SheetFrame>

  const reasons = [...new Set(U.map((r) => r.reason))].sort()
  const cur = reasons.includes(reason) ? reason : 'all'
  const HU = cur === 'all' ? U : U.filter((r) => r.reason === cur)
  const plannedTotal = P.reduce((s, r) => s + r.min, 0)
  const plannedByM = sortedDesc(sumBy(P, (r) => r.machine, (r) => r.min))

  return (
    <SheetFrame id="downtime">
      <motion.div {...reveal(0)}>
        <Card className="wide">
          <CardHead
            title="Загрузка станков по дням"
            sub="внеплановые простои, минуты за день; станки отсортированы по потерям — видно, когда и какой станок «встал». Выберите причину, чтобы увидеть, где она встречается"
          />
          <div className="chips heat-chips" role="group" aria-label="Причина простоя" style={{ marginBottom: 'var(--s-4)' }}>
            {['all', ...reasons].map((r) => (
              <button key={r} className="chip" aria-pressed={r === cur} data-r={r} onClick={() => setReason(r)}>{r === 'all' ? 'Все причины' : r}</button>
            ))}
          </div>
          <Heatmap U={HU} from={filters.from} to={filters.to} signature={cur + '|' + filters.from + filters.to + filters.shift + filters.shop} />
        </Card>
      </motion.div>

      <div className="grid-2">
        <motion.div {...reveal(1)}>
          <Card>
            <CardHead title="Парето причин" sub="от главной причины к второстепенным; в подписи — часы и доля потерь, накопительная доля — в подсказке" />
            <ParetoChart U={U} />
          </Card>
        </motion.div>
        <motion.div {...reveal(2)}>
          <Card>
            <CardHead title="Простои по станкам и причинам" sub="стопка — причины, число справа — итог по станку" />
            <MachinesByReasonChart U={U} />
          </Card>
        </motion.div>
      </div>

      <div className="grid-2">
        <motion.div {...reveal(3)}>
          <Card>
            <CardHead title="Станки: день и ночь" sub="внеплановые простои по сменам, часы" />
            <MachinesByShiftChart U={U} shifts={shownShifts(filters)} />
          </Card>
        </motion.div>
        <motion.div {...reveal(4)}>
          <Card>
            <CardHead title="Плановое ТО отдельно" sub="плановое ТО — не потеря, поэтому в графики потерь не входит" />
            {plannedTotal ? (
              <div id="plannedBox" data-planned-min={plannedTotal}>
                <p className="planned-total"><b className="num" style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-xl)' }}>{hours(plannedTotal)} ч</b> <span className="hint">за период ({nf(plannedTotal)} мин)</span></p>
                <ul className="plain">
                  {plannedByM.map(([m, v]) => <li key={m}><span>{m}</span><b>{hours(v)} ч</b></li>)}
                </ul>
              </div>
            ) : (
              <div id="plannedBox" data-planned-min={0} className="hint">Плановых работ за выбранный период нет.</div>
            )}
          </Card>
        </motion.div>
      </div>
    </SheetFrame>
  )
}
