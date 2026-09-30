import { useState } from 'react'
import { Card, FitCard } from '@/components/ui'
import { Heatmap } from '@/components/viz/Heatmap'
import { MachinesByReasonChart, MachinesByShiftChart, ParetoChart } from '@/components/viz/charts'
import { hours } from '@/lib/format'
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
      <FitCard i={0} className="heat-card"
        title="Загрузка станков по дням"
        sub="Внеплановые простои, минуты за день. Выберите причину — увидите, где именно она встречается."
        aside={
          <div id="plannedBox" className="planned-strip" data-planned-min={plannedTotal}>
            {plannedTotal
              ? <><span className="planned-k">Плановое ТО — не потеря</span><b>{hours(plannedTotal)} ч</b><span className="planned-list">{plannedByM.map(([m, v]) => m + ' ' + hours(v)).join(' · ')}</span></>
              : <span className="planned-k">Плановых работ за период нет</span>}
          </div>
        }
      >
        <div className="chips heat-chips" role="group" aria-label="Причина простоя">
          {['all', ...reasons].map((r) => (
            <button key={r} className="chip" aria-pressed={r === cur} data-r={r} onClick={() => setReason(r)}>{r === 'all' ? 'Все причины' : r}</button>
          ))}
        </div>
        <Heatmap U={HU} from={filters.from} to={filters.to} signature={cur + '|' + filters.from + filters.to + filters.shift + filters.shop} />
      </FitCard>

      <div className="fit-row cols-3">
        <FitCard i={1} title="Парето причин" sub="от главной причины к второстепенным; накопительная доля — в подсказке">
          <ParetoChart U={U} />
        </FitCard>
        <FitCard i={2} title="Простои по станкам и причинам" sub="итог по станку — справа">
          <MachinesByReasonChart U={U} />
        </FitCard>
        <FitCard i={3} title="Станки: день и ночь" sub="внеплановые простои по сменам, часы">
          <MachinesByShiftChart U={U} shifts={shownShifts(filters)} />
        </FitCard>
      </div>
    </SheetFrame>
  )
}
