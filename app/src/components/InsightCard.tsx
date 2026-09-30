import { motion } from 'motion/react'
import { reveal } from '@/lib/motion'
import type { Insight, Seg } from '@/lib/insights'
import { MiniColumns, WeeklyLines } from '@/components/viz/charts'
import { Badge, Card, type Tone } from '@/components/ui'

const LEVEL: Record<Insight['level'], { tone: Tone; label: string }> = {
  crit: { tone: 'danger', label: 'Приоритет' },
  warn: { tone: 'warning', label: 'Внимание' },
  info: { tone: 'info', label: 'Контекст' },
}

const Body = ({ segs }: { segs: Seg[] }) => (
  <p>{segs.map((s, i) => (typeof s === 'string' ? <span key={i}>{s}</span> : <b key={i}>{s.b}</b>))}</p>
)

/** Карточка вывода. Статус читается цветом и формой сразу (точка + подпись капсом);
 *  акцентная рамка со свечением — только у главного вывода на экране (правило VOLT). */
export function InsightCard({ x, index, accent }: { x: Insight; index: number; accent?: boolean }) {
  const lv = LEVEL[x.level]
  const m = x.mini
  return (
    <motion.div {...reveal(index)} data-insight={x.level}>
      <Card accent={accent} className="insight">
        <div className="insight-top">
          <Badge tone={lv.tone} dot>{lv.label}</Badge>
        </div>
        <h3>{x.title}</h3>
        <Body segs={x.body} />
        {m && (
          <div>
            <div className="mini-note">{m.note}</div>
            {m.type === 'columns' ? (
              <MiniColumns name={'mini-' + index} labels={m.labels} titles={m.titles} series={m.series} />
            ) : (
              <WeeklyLines name={'mini-' + index} wins={m.wins ?? []} series={m.series} height={160} />
            )}
          </div>
        )}
        <div className="action"><b>Что делать</b><span>{x.action}</span></div>
      </Card>
    </motion.div>
  )
}
