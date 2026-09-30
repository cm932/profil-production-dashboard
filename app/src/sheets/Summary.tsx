import { motion } from 'motion/react'
import { Settings2 } from 'lucide-react'
import { CountUp } from '@/components/CountUp'
import { AllInsights, InsightGrid } from '@/components/InsightPanel'
import { Field, Popover } from '@/components/ui'
import { hours, nf, plural, rub } from '@/lib/format'
import { EASE_OUT, reveal } from '@/lib/motion'
import { daysBetween } from '@/lib/model'
import { useStore } from '@/store'
import { SheetFrame } from './SheetFrame'

function Kpi({ i, label, value, format, unit, sub, progress, title }: {
  i: number; label: string; value: number; format: (n: number) => string; unit?: string; sub: string; progress?: number; title?: string
}) {
  return (
    <motion.div {...reveal(i)} className="tile" title={title}>
      <span className="k">{label}</span>
      <span className="v">
        <CountUp value={value} format={format} />
        {unit && <small>{unit}</small>}
      </span>
      {progress != null && (
        <div className="progress" aria-hidden>
          <motion.i
            style={{ transformOrigin: 'left', width: '100%' }}
            initial={{ transform: 'scaleX(0)' }} animate={{ transform: 'scaleX(' + Math.max(0, Math.min(1, progress)) + ')' }}
            transition={{ duration: 0.6, ease: EASE_OUT, delay: 0.1 }}
          />
        </div>
      )}
      <span className="d">{sub}</span>
    </motion.div>
  )
}

export function Summary() {
  const { summary: s, filters, params, setParams, insights, showMoney } = useStore()
  const shiftH = params.shiftHours
  const note = filters.from && daysBetween(filters.from, filters.to) >= 14
    ? 'Недели считаются от конца выбранного периода (по 7 дней); неполная неделя в начале в сравнении не участвует.' : ''

  // Допущения лежат в кнопке в шапке листа; в PDF та же информация — строкой под заголовком (кнопки в PDF нет)
  const assumptions = (
    <Popover label="Допущения" icon={<Settings2 size={16} strokeWidth={1.5} />}>
      <div className="assumptions-grid" id="assumptions">
        <Field label="Длительность смены, ч"><input id="pShift" className="input" type="number" min={1} max={24} step={0.5} value={params.shiftHours} onChange={(e) => setParams({ shiftHours: +e.target.value })} /></Field>
        <Field label="Стоимость станко-часа простоя, ₽"><input id="pHour" className="input" type="number" min={0} step={100} value={params.hourCost} onChange={(e) => setParams({ hourCost: +e.target.value })} /></Field>
        <Field label="Стоимость бракованной детали, ₽"><input id="pPiece" className="input" type="number" min={0} step={100} value={params.pieceCost} onChange={(e) => setParams({ pieceCost: +e.target.value })} /></Field>
      </div>
      <p className="hint">В исходных журналах нет денег и объёма выпуска: доступность считается от фонда времени (станки × дни × смены × длительность смены), а рубли — по этим ставкам. Это оценка.</p>
    </Popover>
  )

  return (
    <SheetFrame id="summary" actions={<><AllInsights insights={insights} note={note} />{showMoney && assumptions}</>}
      captionExtra={showMoney ? 'ставки: ' + nf(params.hourCost) + ' ₽/ч простоя, ' + nf(params.pieceCost) + ' ₽/деталь, смена ' + nf(params.shiftHours, 1) + ' ч' : undefined}>
      <div className="kpis" id="kpis" data-cols={showMoney ? 4 : 3} data-loss-min={s.lossMin} data-planned-min={s.plannedMin} data-pieces={s.pieces} data-cases={s.defectCases} data-orders={s.orders}>
        <Kpi i={0} label="Потери времени" value={s.lossMin / 60} format={(n) => nf(n, 1)} unit="ч"
          sub={'внеплановые простои ≈ ' + nf(s.lossMin / 60 / shiftH, 1) + ' смен'} title={'Плановое ТО (' + hours(s.plannedMin) + ' ч) в потери не входит'} />
        <Kpi i={1} label="Доступность станков" value={s.fundMin ? s.availability * 100 : 0} format={(n) => (s.fundMin ? nf(n, 1) : '—')} unit="%" progress={s.fundMin ? s.availability : 0}
          sub={'от фонда ' + nf(s.fundMin / 60) + ' станко-ч'} title={'Фонд: ' + s.machines + ' станков × ' + s.days + ' дн. × ' + s.shifts + ' смены × ' + nf(shiftH, 1) + ' ч'} />
        <Kpi i={2} label="Брак" value={s.pieces} format={(n) => nf(n)} unit="шт"
          sub={s.defectCases + ' ' + plural(s.defectCases, 'случай', 'случая', 'случаев') + ' в ' + s.orders + ' ' + plural(s.orders, 'заказе', 'заказах', 'заказах')} />
        {/* деньги видят только роли, которым они положены (сервер ставки остальным не отдаёт) */}
        {showMoney && <Kpi i={3} label="Потери в деньгах, оценка" value={s.lossRub + s.defectRub} format={(n) => rub(n)}
          sub={'простои ' + rub(s.lossRub) + ' + брак ' + rub(s.defectRub)} />}
      </div>

      <InsightGrid insights={insights} note={note} />
    </SheetFrame>
  )
}
