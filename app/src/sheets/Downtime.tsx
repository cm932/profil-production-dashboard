import { useState } from 'react'
import { Card, FitCard } from '@/components/ui'
import { Heatmap } from '@/components/viz/Heatmap'
import { MachinesByReasonChart, MachinesByShiftChart, ParetoChart } from '@/components/viz/charts'
import { hours, nf } from '@/lib/format'
import { shownShifts, sortedDesc, sum, sumBy } from '@/lib/model'
import { useStore } from '@/store'
import { SheetFrame } from './SheetFrame'

/** Простои: три вкладки — «по дням» (тепловая карта), «причины», «день и ночь». На экране одна вкладка крупно, в PDF — все. */
export function Downtime() {
  const { F, filters } = useStore()
  const [reason, setReason] = useState('all')
  const U = F.D.filter((r) => !r.planned)
  const P = F.D.filter((r) => r.planned)

  if (!U.length) return <SheetFrame id="downtime"><Card className="empty">Нет внеплановых простоев за выбранный период, смену и цех.</Card></SheetFrame>

  const shifts = shownShifts(filters)
  const reasons = sortedDesc(sumBy(U, (r) => r.reason, (r) => r.min)).map((x) => x[0])
  const cur = reasons.includes(reason) ? reason : 'all'
  const HU = cur === 'all' ? U : U.filter((r) => r.reason === cur)
  const plannedTotal = sum(P, (r) => r.min)
  const plannedByM = sortedDesc(sumBy(P, (r) => r.machine, (r) => r.min))
  const lossTotal = sum(U, (r) => r.min)
  const byShift = sumBy(U, (r) => String(r.shift), (r) => r.min)

  const planned = (
    <div id="plannedBox" className="planned-strip" data-planned-min={plannedTotal}>
      {plannedTotal
        ? <><span className="planned-k">Плановое ТО (не потеря)</span><b>{hours(plannedTotal)} ч</b></>
        : <span className="planned-k">Плановых работ за период нет</span>}
    </div>
  )

  return (
    <SheetFrame id="downtime" views={[
      {
        id: 'days', label: 'По дням', render: () => (
          <FitCard i={0} className="heat-card"
            title="Когда и какой станок простаивал"
            sub="Внеплановые простои, минуты за день. Выберите причину, чтобы увидеть, где она встречается."
            aside={planned}>
            <div className="chips heat-chips" role="group" aria-label="Причина простоя">
              {['all', ...reasons].map((r) => (
                <button key={r} className="chip" aria-pressed={r === cur} data-r={r} onClick={() => setReason(r)}>{r === 'all' ? 'Все причины' : r}</button>
              ))}
            </div>
            <Heatmap U={HU} from={filters.from} to={filters.to} signature={cur + '|' + filters.from + filters.to + filters.shift + filters.shop} />
          </FitCard>
        ),
      },
      {
        id: 'reasons', label: 'Причины', render: () => (
          <div className="fit-row cols-2">
            <FitCard i={0} title="Из-за чего теряем время" sub={'Внеплановые простои по причинам, всего ' + hours(lossTotal) + ' ч. Подсказка — накопительная доля.'}>
              <ParetoChart U={U} />
            </FitCard>
            <FitCard i={1} title="Какие станки и почему" sub="Часы простоя по станкам, цвет — причина">
              <MachinesByReasonChart U={U} />
            </FitCard>
          </div>
        ),
      },
      {
        id: 'shifts', label: 'День и ночь', render: () => (
          <div className="fit-row cols-2-1">
            <FitCard i={0} title="Станки: дневная и ночная смена" sub="Внеплановые простои по сменам, часы">
              <MachinesByShiftChart U={U} shifts={shifts} />
            </FitCard>
            <FitCard i={1} title="Итоги по сменам">
              <ul className="stat-list">
                {shifts.map((s) => (
                  <li key={s}><span>{s === 1 ? 'Дневная смена' : 'Ночная смена'}</span><b>{hours(byShift.get(String(s)) ?? 0)} ч</b></li>
                ))}
                <li className="stat-sep"><span>Плановое ТО — не потеря</span><b>{hours(plannedTotal)} ч</b></li>
                {plannedByM.map(([m, v]) => <li key={m} className="stat-sub"><span>{m}</span><b>{hours(v)} ч</b></li>)}
              </ul>
              <p className="hint stat-note">Плановое ТО в потери не входит: это запланированное время, его показываем отдельно{plannedTotal ? ' (' + nf((plannedTotal / (plannedTotal + lossTotal)) * 100) + '% всех остановок)' : ''}.</p>
            </FitCard>
          </div>
        ),
      },
    ]} />
  )
}
