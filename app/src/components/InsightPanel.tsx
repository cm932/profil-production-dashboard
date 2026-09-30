import { useState } from 'react'
import { motion } from 'motion/react'
import { ChevronRight, ListChecks } from 'lucide-react'
import { Dialog } from '@/components/Dialog'
import { Badge, Button, Card, type Tone } from '@/components/ui'
import { Legend, MiniColumns, WeeklyLines } from '@/components/viz/charts'
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
              : <><Legend items={m.series.map((x) => ({ label: x.label, color: x.color }))} /><WeeklyLines name="mini-lines" wins={m.wins ?? []} series={m.series} height={chartH} /></>}
          </div>
        </div>
      )}
      <div className="action"><b>Что делать</b><span>{x.action.charAt(0).toUpperCase() + x.action.slice(1)}</span></div>
      {note && m?.type === 'lines' && <p className="hint">{note}</p>}
    </div>
  )
}

/** Выводы на Сводке: три главных — крупными карточками в ряд. В карточке — цифра, пояснение, мини-график и «что делать»;
 *  полный разбор — по «Подробнее», в окне. Остальные выводы — на уровень глубже, кнопкой «Все выводы» (частое — сразу, редкое — глубже). */
export function InsightGrid({ insights, note, limit = 3 }: { insights: Insight[]; note?: string; limit?: number }) {
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

  const shown = insights.slice(0, limit)
  return (
    <>
      <div className="ins-grid" data-count={shown.length}>
        {shown.map((it, i) => {
          const lv = LEVEL[it.level]
          const m = it.mini
          return (
            <motion.article key={it.title} {...reveal(i + 2)} data-insight={it.level}
              className={'card ins-card' + (i === 0 && it.level === 'crit' ? ' card--accent' : '')} onClick={() => setOpen(i)}>
              <div className="ins-top">
                <Badge tone={lv.tone} dot>{lv.label}</Badge>
                <button type="button" className="ins-more" aria-haspopup="dialog" onClick={(e) => { e.stopPropagation(); setOpen(i) }}>
                  Подробнее<ChevronRight size={15} strokeWidth={2} />
                </button>
              </div>
              <h3 className="ins-title">{it.title}</h3>
              <div className="ins-metric">{it.metric}</div>
              <p className="ins-why">{it.why}</p>
              {m ? (
                <div className="ins-chart" aria-hidden>
                  {m.type === 'columns'
                    ? <MiniColumns name={'ins-mini-' + i} labels={m.labels} titles={m.titles} series={m.series} />
                    : <><Legend items={m.series.map((x) => ({ label: x.label, color: x.color }))} /><WeeklyLines name={'ins-mini-' + i} wins={m.wins ?? []} series={m.series} /></>}
                </div>
              ) : (
                <ul className="ins-facts">{toSentences(it.body).slice(0, 3).map((f, k) => <li key={k}>{f.map((s) => (typeof s === 'string' ? s : s.b)).join('')}</li>)}</ul>
              )}
              <p className="ins-todo"><b>Что делать</b>{it.todo}</p>
            </motion.article>
          )
        })}
      </div>
      <Dialog open={!!x} onClose={() => setOpen(null)} title={x?.title ?? ''} width={720}>
        {x && <Detail x={x} note={note} />}
      </Dialog>
    </>
  )
}

/** Кнопка «Все выводы (N)» в шапке Сводки: список всех выводов, каждый раскрывается в разбор */
export function AllInsights({ insights, note }: { insights: Insight[]; note?: string }) {
  const [open, setOpen] = useState(false)
  const [cur, setCur] = useState(0)
  if (!insights.length) return null
  const x = insights[Math.min(cur, insights.length - 1)]
  return (
    <>
      <Button id="allInsights" onClick={() => { setCur(0); setOpen(true) }}><ListChecks size={16} strokeWidth={1.75} />Все выводы · {insights.length}</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Все выводы за период" width={820}>
        <div className="all-ins">
          <div className="all-ins-list" role="tablist" aria-label="Выводы">
            {insights.map((it, i) => (
              <button key={it.title} role="tab" aria-selected={i === cur} className="all-ins-item" onClick={() => setCur(i)}>
                <Badge tone={LEVEL[it.level].tone} dot>{LEVEL[it.level].label}</Badge>
                <span>{it.title}</span>
              </button>
            ))}
          </div>
          <div className="all-ins-detail">
            <div className="ins-metric">{x.metric}</div>
            <p className="ins-why">{x.why}</p>
            <Detail x={x} note={note} />
          </div>
        </div>
      </Dialog>
    </>
  )
}
