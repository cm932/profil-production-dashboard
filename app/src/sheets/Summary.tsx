import { motion } from 'motion/react'
import { CountUp } from '@/components/CountUp'
import { InsightCard } from '@/components/InsightCard'
import { Card, CardHead, Field } from '@/components/ui'
import { OpsByShiftChart, ParetoChart } from '@/components/viz/charts'
import { hours, nf, plural, rub } from '@/lib/format'
import { EASE_OUT, reveal } from '@/lib/motion'
import { daysBetween, shownShifts } from '@/lib/model'
import { useStore } from '@/store'
import { SheetFrame } from './SheetFrame'

function Kpi({ i, label, value, format, unit, sub, progress, attrs }: {
  i: number; label: string; value: number; format: (n: number) => string; unit?: string; sub: string; progress?: number; attrs?: Record<string, number>
}) {
  return (
    <motion.div {...reveal(i)} className="tile" {...Object.fromEntries(Object.entries(attrs ?? {}).map(([k, v]) => ['data-' + k, v]))}>
      <span className="k">{label}</span>
      <span className="v">
        <CountUp value={value} format={format} />
        {unit && <small>{unit}</small>}
      </span>
      {progress != null && (
        <div className="progress" aria-hidden>
          <motion.i
            style={{ transformOrigin: 'left', width: '100%' }}
            initial={{ scaleX: 0 }} animate={{ scaleX: Math.max(0, Math.min(1, progress)) }}
            transition={{ duration: 0.6, ease: EASE_OUT, delay: 0.1 }}
          />
        </div>
      )}
      <span className="d">{sub}</span>
    </motion.div>
  )
}

export function Summary() {
  const { summary: s, F, filters, params, setParams, insights } = useStore()
  const shiftH = params.shiftHours
  const note = filters.from && daysBetween(filters.from, filters.to) >= 14
    ? 'Недели считаются от конца выбранного периода (по 7 дней); неполная неделя в начале периода в сравнении не участвует.' : ''
  const U = F.D.filter((r) => !r.planned)

  return (
    <SheetFrame id="summary">
      <div className="kpis" id="kpis" data-loss-min={s.lossMin} data-planned-min={s.plannedMin} data-pieces={s.pieces} data-cases={s.defectCases} data-orders={s.orders}>
        <Kpi i={0} label="Потери времени (внеплановые простои)" value={s.lossMin / 60} format={(n) => nf(n, 1)} unit="ч"
          sub={'≈ ' + nf(s.lossMin / 60 / shiftH, 1) + ' смен станка · плановое ТО ещё ' + hours(s.plannedMin) + ' ч'} />
        <Kpi i={1} label="Доступность оборудования" value={s.fundMin ? s.availability * 100 : 0} format={(n) => (s.fundMin ? nf(n, 1) : '—')} unit="%" progress={s.fundMin ? s.availability : 0}
          sub={'фонд ' + nf(s.fundMin / 60) + ' станко-ч: ' + s.machines + ' ст. × ' + s.days + ' дн. × ' + s.shifts + ' см. × ' + nf(shiftH, 1) + ' ч'} />
        <Kpi i={2} label="Брак" value={s.pieces} format={(n) => nf(n)} unit="шт"
          sub={s.defectCases + ' ' + plural(s.defectCases, 'случай', 'случая', 'случаев') + ' в ' + s.orders + ' ' + plural(s.orders, 'заказе', 'заказах', 'заказах')} />
        <Kpi i={3} label="Потери в деньгах (оценка)" value={s.lossRub + s.defectRub} format={(n) => rub(n)}
          sub={'простои ' + rub(s.lossRub) + ' + брак ' + rub(s.defectRub)} />
      </div>

      <div>
        <h2 className="block-title">Что видно по данным</h2>
        <p className="eyebrow block-sub">выводы пересчитываются вместе с фильтрами</p>
      </div>
      {insights.length ? (
        <div className="insights">
          {insights.map((x, i) => <InsightCard key={x.title} x={x} index={i} accent={i === 0 && x.level === 'crit'} />)}
          {note && <p className="hint insight-foot">{note}</p>}
        </div>
      ) : (
        <Card className="empty">Для выбранного периода и смены выводов нет: данных мало для сравнения недель или резких отклонений не найдено.</Card>
      )}

      <h2 className="block-title">Ключевые графики</h2>
      <div className="grid-2">
        <Card>
          <CardHead title="Где теряем время: причины простоев" sub="внеплановые простои, часы и доля от потерь" />
          {U.length ? <ParetoChart U={U} height={260} /> : <div className="empty">Нет простоев за выбранный период</div>}
        </Card>
        <Card>
          <CardHead title="Где возникает брак: операции и смены" sub="забраковано деталей" />
          {F.B.length ? <OpsByShiftChart B={F.B} shifts={shownShifts(filters)} height={260} /> : <div className="empty">Нет брака за выбранный период</div>}
        </Card>
      </div>

      <details className="card assumptions" id="assumptions">
        <summary>Допущения для расчёта времени и денег</summary>
        <div className="assumptions-grid">
          <Field label="Длительность смены, ч"><input id="pShift" className="input" type="number" min={1} max={24} step={0.5} value={params.shiftHours} onChange={(e) => setParams({ shiftHours: +e.target.value })} /></Field>
          <Field label="Стоимость станко-часа простоя, ₽"><input id="pHour" className="input" type="number" min={0} step={100} value={params.hourCost} onChange={(e) => setParams({ hourCost: +e.target.value })} /></Field>
          <Field label="Стоимость бракованной детали, ₽"><input id="pPiece" className="input" type="number" min={0} step={100} value={params.pieceCost} onChange={(e) => setParams({ pieceCost: +e.target.value })} /></Field>
        </div>
        <p className="hint">В исходных журналах нет денег и объёма выпуска. Поэтому доступность считается от фонда времени (станки × дни × смены × длительность смены), а рубли — по этим ставкам.
          Это оценка; ставки можно поменять, и панель пересчитается.</p>
      </details>
    </SheetFrame>
  )
}
