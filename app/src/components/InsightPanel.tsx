import { useState } from 'react'
import { motion } from 'motion/react'
import { ArrowRight } from 'lucide-react'
import { Dialog } from '@/components/Dialog'
import { Badge, Card, type Tone } from '@/components/ui'
import { MiniColumns, WeeklyLines } from '@/components/viz/charts'
import type { Insight, Seg } from '@/lib/insights'
import { reveal } from '@/lib/motion'
import { useExporting } from '@/hooks/useExporting'

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

const Facts = ({ x }: { x: Insight }) => (
  <ul className="facts">
    {toSentences(x.body).map((f, i) => (
      <li key={i}>{f.map((s, j) => (typeof s === 'string' ? <span key={j}>{s}</span> : <b key={j}>{s.b}</b>))}</li>
    ))}
  </ul>
)

/** Подробности вывода: факты по пунктам, мини-график, полная рекомендация */
function Detail({ x, note, chartH = 200 }: { x: Insight; note?: string; chartH?: number }) {
  const m = x.mini
  return (
    <div className="ins-detail">
      <Facts x={x} />
      {m && (
        <div className="ins-mini">
          <div className="mini-note">{m.note}</div>
          <div className="ins-mini-chart">
            {m.type === 'columns'
              ? <MiniColumns name="mini-columns" labels={m.labels} titles={m.titles} series={m.series} height={chartH} />
              : <WeeklyLines name="mini-lines" wins={m.wins ?? []} series={m.series} height={chartH} />}
          </div>
        </div>
      )}
      <div className="action"><b>Что делать</b><span>{x.action.charAt(0).toUpperCase() + x.action.slice(1)}</span></div>
      {note && m?.type === 'lines' && <p className="hint">{note}</p>}
    </div>
  )
}

/** Выводы на Сводке: 2 × 2 карточки. В карточке — главная цифра, пояснение и «что делать» одной строкой;
 *  полный разбор с графиком — по щелчку, в окне (текст не ужимается). Акцентная рамка — только у главного вывода (правило VOLT). */
export function InsightGrid({ insights, note }: { insights: Insight[]; note?: string }) {
  const [open, setOpen] = useState<number | null>(null)
  const exporting = useExporting()
  if (!insights.length) {
    return <Card className="empty ins-empty">Для выбранного периода и смены выводов нет: данных мало для сравнения недель или резких отклонений не найдено.</Card>
  }
  const x = open != null ? insights[open] : null

  // В PDF окна нет — каждый вывод печатается целиком
  if (exporting) {
    return (
      <div className="ins-print">
        {insights.map((it) => (
          <Card key={it.title} className="ins-card ins-card--print">
            <Badge tone={LEVEL[it.level].tone} dot>{LEVEL[it.level].label}</Badge>
            <h3 className="ins-title">{it.title}</h3>
            <Detail x={it} note={note} chartH={120} />
          </Card>
        ))}
      </div>
    )
  }

  return (
    <>
      <div className="ins-grid" data-count={insights.length}>
        {insights.slice(0, 4).map((it, i) => {
          const lv = LEVEL[it.level]
          return (
            <motion.button key={it.title} {...reveal(i + 2)} type="button" data-insight={it.level}
              className={'card ins-card' + (i === 0 && it.level === 'crit' ? ' card--accent' : '')} onClick={() => setOpen(i)}
              aria-haspopup="dialog">
              <span className="ins-top">
                <Badge tone={lv.tone} dot>{lv.label}</Badge>
                <span className="ins-more">Подробнее<ArrowRight size={14} strokeWidth={1.5} /></span>
              </span>
              <span className="ins-title">{it.title}</span>
              <span className="ins-metric">{it.metric}</span>
              <span className="ins-why">{it.why}</span>
              {/* на высоких экранах места больше — показываем первые пункты разбора */}
              <span className="ins-facts">{toSentences(it.body).slice(0, 2).map((f, k) => <span key={k}>{f.map((x) => (typeof x === 'string' ? x : x.b)).join('')}</span>)}</span>
              <span className="ins-todo"><b>Что делать</b>{it.todo}</span>
            </motion.button>
          )
        })}
      </div>
      <Dialog open={!!x} onClose={() => setOpen(null)} title={x?.title ?? ''} width={720}>
        {x && <Detail x={x} note={note} />}
      </Dialog>
    </>
  )
}
