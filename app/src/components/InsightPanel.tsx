import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Badge, Card, type Tone } from '@/components/ui'
import { MiniColumns, WeeklyLines } from '@/components/viz/charts'
import type { Insight, Seg } from '@/lib/insights'
import { EASE_OUT, reveal } from '@/lib/motion'

const LEVEL: Record<Insight['level'], { tone: Tone; label: string }> = {
  crit: { tone: 'danger', label: 'Приоритет' },
  warn: { tone: 'warning', label: 'Внимание' },
  info: { tone: 'info', label: 'Контекст' },
}

/** Делит длинный текст вывода на короткие предложения — каждое становится отдельным пунктом (так читается, а не «стена текста»). */
function toSentences(segs: Seg[]): Seg[][] {
  const out: Seg[][] = [[]]
  let ended = false // предыдущий фрагмент закончился точкой — следующий с заглавной буквы начинает новое предложение
  for (const s of segs) {
    if (typeof s !== 'string') { out[out.length - 1].push(s); ended = false; continue }
    let str = s
    if (ended && /^\s+[А-ЯЁA-Z«0-9]/.test(str)) { out.push([]); str = str.trimStart() }
    str.split(/(?<=[.!?])\s+(?=[А-ЯЁA-Z«0-9])/).forEach((part, i) => {
      if (i > 0) out.push([])
      if (part) out[out.length - 1].push(part)
    })
    ended = /[.!?]$/.test(str.trimEnd())
  }
  return out.filter((x) => x.length)
}

const Sentence = ({ segs }: { segs: Seg[] }) => (
  <li>{segs.map((s, i) => (typeof s === 'string' ? <span key={i}>{s}</span> : <b key={i}>{s.b}</b>))}</li>
)

/** Выводы «мастер — деталь»: слева короткий список с главной цифрой, справа выбранный вывод целиком.
 *  Акцентная рамка со свечением — только у главного вывода на экране (правило VOLT). */
export function InsightPanel({ insights, note }: { insights: Insight[]; note?: string }) {
  const [sel, setSel] = useState(0)
  if (!insights.length) {
    return <Card className="empty">Для выбранного периода и смены выводов нет: данных мало для сравнения недель или резких отклонений не найдено.</Card>
  }
  const cur = Math.min(sel, insights.length - 1)
  const x = insights[cur]
  const m = x.mini
  const facts = toSentences(x.body)

  return (
    <motion.div {...reveal(1)} className="fit-card ip">
      <Card accent={insights[0].level === 'crit' && cur === 0} className="ip-card">
        <div className="ip-list" role="tablist" aria-label="Выводы">
          {insights.map((it, i) => {
            const lv = LEVEL[it.level]
            return (
              <button key={it.title} role="tab" aria-selected={i === cur} data-insight={it.level} className="ip-item" onClick={() => setSel(i)}>
                <Badge tone={lv.tone} dot>{lv.label}</Badge>
                <span className="ip-title">{it.title}</span>
                <span className="ip-headline">{it.headline}</span>
              </button>
            )
          })}
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={cur} className="ip-detail"
            initial={{ opacity: 0, transform: 'translateY(6px)' }} animate={{ opacity: 1, transform: 'translateY(0px)' }}
            exit={{ opacity: 0, transition: { duration: 0.08 } }} transition={{ duration: 0.18, ease: EASE_OUT }}
          >
            <h3>{x.title}</h3>
            <ul className="facts">{facts.map((f, i) => <Sentence key={i} segs={f} />)}</ul>
            {m && (
              <div className="ip-mini">
                <div className="mini-note">{m.note}</div>
                <div className="ip-mini-chart">
                  {m.type === 'columns'
                    ? <MiniColumns name="mini-columns" labels={m.labels} titles={m.titles} series={m.series} />
                    : <WeeklyLines name="mini-lines" wins={m.wins ?? []} series={m.series} />}
                </div>
              </div>
            )}
            <div className="action"><b>Что делать</b><span>{x.action}</span></div>
            {note && m?.type === 'lines' && <p className="hint ip-note">{note}</p>}
          </motion.div>
        </AnimatePresence>
      </Card>
    </motion.div>
  )
}
