// Тепловая карта «станок × день»: интенсивность = внеплановые минуты простоя за день.
// Собственная, а не из Bklit: календарь Bklit устроен как «недели × дни недели», а здесь нужна матрица станков с числами в клетках.
// Появление — волна на anime.js (stagger по сетке); при prefers-reduced-motion клетки просто показываются.
import { useEffect, useMemo, useRef } from 'react'
import { animate, stagger } from 'animejs'
import { hours } from '@/lib/format'
import { addDays, sortedDesc, sumBy } from '@/lib/model'
import { prefersReduced } from '@/lib/motion'
import type { Downtime } from '@/lib/types'

const dm = (d: string) => d.slice(8) + '.' + d.slice(5, 7)
const isMonday = (d: string) => new Date(d + 'T00:00:00Z').getUTCDay() === 1

export function Heatmap({ U, from, to, signature }: { U: Downtime[]; from: string; to: string; signature: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const seen = useRef(false) // первый показ — полная волна; обновление после смены фильтра — короткая (частое действие)

  const m = useMemo(() => {
    const days: string[] = []
    for (let d = from; d <= to; d = addDays(d, 1)) days.push(d)
    const opOf: Record<string, string> = {}
    U.forEach((r) => { opOf[r.machine] = r.op })
    const totals = sumBy(U, (r) => r.machine, (r) => r.min)
    const machines = sortedDesc(totals).map((x) => x[0])
    const cell = new Map<string, number>()
    const reasonsIn = new Map<string, Map<string, number>>()
    for (const r of U) {
      const k = r.machine + '|' + r.date
      cell.set(k, (cell.get(k) ?? 0) + r.min)
      const rm = reasonsIn.get(k) ?? new Map<string, number>()
      rm.set(r.reason, (rm.get(r.reason) ?? 0) + r.min)
      reasonsIn.set(k, rm)
    }
    return { days, opOf, totals, machines, cell, reasonsIn, max: Math.max(1, ...cell.values()), sum: [...cell.values()].reduce((a, b) => a + b, 0) }
  }, [U, from, to])

  // Волна: клетки появляются от левого верхнего угла к правому нижнему
  useEffect(() => {
    const el = ref.current
    if (!el || prefersReduced()) return
    const cells = Array.from(el.querySelectorAll<HTMLElement>('.hm-cell'))
    if (!cells.length) return
    const first = !seen.current
    seen.current = true
    const anim = animate(cells, {
      opacity: [0, 1],
      translateY: [first ? 5 : 3, 0],
      duration: first ? 360 : 200,
      ease: 'outQuart',
      delay: stagger(first ? 9 : 3, { grid: [m.days.length, m.machines.length], from: 'first' }),
    })
    return () => { anim.cancel(); cells.forEach((c) => { c.style.opacity = ''; c.style.transform = '' }) }
  }, [signature, m.days.length, m.machines.length])

  const showNums = m.days.length <= 31
  const steps = [0.18, 0.4, 0.6, 0.8, 1]
  const mix = (t: number) => `color-mix(in oklab, var(--accent) ${Math.round(t * 100)}%, var(--bg-inset))`

  return (
    <div data-chart="heatmap" data-sum={m.sum}>
      <div className="hm-scroll" ref={ref}>
        <div className="hm" style={{ gridTemplateColumns: `92px repeat(${m.days.length}, minmax(26px, 1fr)) 60px` }}>
          <div />
          {m.days.map((d, i) => (
            <div key={d} className={'hm-h' + (isMonday(d) || i === 0 ? ' wk' : '')}>{isMonday(d) || i === 0 ? dm(d) : d.slice(8)}</div>
          ))}
          <div className="hm-h tot">Итого</div>
          {m.machines.map((mach) => (
            <Row key={mach} mach={mach} m={m} showNums={showNums} mix={mix} />
          ))}
        </div>
      </div>
      <div className="hm-legend">
        <span>меньше</span>
        {steps.map((t) => <i key={t} style={{ background: mix(t) }} />)}
        <span>больше</span>
        <span style={{ color: 'var(--text-muted)' }}>· число в клетке — минуты простоя за день, максимум {m.max} мин</span>
      </div>
    </div>
  )
}

function Row({ mach, m, showNums, mix }: { mach: string; m: { days: string[]; opOf: Record<string, string>; totals: Map<string, number>; cell: Map<string, number>; reasonsIn: Map<string, Map<string, number>>; max: number }; showNums: boolean; mix: (t: number) => string }) {
  return (
    <>
      <div className="hm-row">{mach}<span>{(m.opOf[mach] ?? '').toLowerCase()}</span></div>
      {m.days.map((d) => {
        const v = m.cell.get(mach + '|' + d) ?? 0
        if (!v) return <div key={d} className="hm-cell zero" title={mach + ', ' + dm(d) + ': простоев нет'} />
        const t = 0.18 + 0.82 * (v / m.max)
        const detail = [...(m.reasonsIn.get(mach + '|' + d) ?? [])].sort((a, b) => b[1] - a[1]).map((x) => x[0] + ' ' + x[1] + ' мин').join(', ')
        return (
          <div key={d} className={'hm-cell' + (t > 0.55 ? ' hot' : '')} style={{ background: mix(t) }} title={mach + ', ' + dm(d) + ': ' + v + ' мин (' + detail + ')'}>
            {showNums ? v : ''}
          </div>
        )
      })}
      <div className="hm-tot">{hours(m.totals.get(mach) ?? 0)} ч</div>
    </>
  )
}
