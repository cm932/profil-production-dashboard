// Автоматические выводы для директора. Каждый вывод вычисляется из отфильтрованных данных,
// поэтому при загрузке нового файла или смене фильтров тексты и цифры пересчитываются.
// Правило: то, что данные не доказывают (причина), формулируется как гипотеза «проверить», а не как факт.
import { reasonColor, shiftColor } from './colors'
import { hours, nf } from './format'
import { addDays, daysBetween, inWin, sum, windows, type Filtered, type Summary, type Win } from './model'
import type { Filters, Params } from './types'

export type Seg = string | { b: string }
const b = (s: string): Seg => ({ b: s })
const dm = (d: string) => d.slice(8) + '.' + d.slice(5, 7)
const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0)
const CHAIN = ['раскрой', 'кромка', 'присадка', 'сборка'] // порядок переделов на фабрике

// Что делать по каждой причине простоя (короткие практические шаги)
const ACTION: Record<string, string> = {
  'Ожидание заготовок': 'сверить график подачи заготовок на этот станок с планом раскроя, при необходимости ввести межоперационный буфер и ответственного за подачу.',
  'Нет материала': 'проверить складской остаток и заявки на плиту/кромку/фурнитуру до начала смены.',
  'Нет оператора': 'проверить график смен и замены: кто выходит на станок при отсутствии основного оператора.',
  'Переналадка': 'сгруппировать заказы по типоразмеру, чтобы переналадок было меньше, и стандартизировать порядок переналадки.',
  'Поломка': 'проверить график ТО этого станка и запас расходников; разобрать повторяющиеся отказы.',
  'Прочее': 'причина «Прочее» ничего не объясняет — сделать выбор конкретной причины обязательным при записи простоя.',
}
const action = (reason: string) => ACTION[reason] ?? ACTION['Прочее']
// Короткая версия «что делать» — одна строка для карточки на Сводке; полная — в подробностях
const TODO: Record<string, string> = {
  'Ожидание заготовок': 'Сверить подачу заготовок с планом раскроя',
  'Нет материала': 'Проверять остатки материала до начала смены',
  'Нет оператора': 'Назначить замену оператора на каждую смену',
  'Переналадка': 'Группировать заказы, чтобы реже переналаживать',
  'Поломка': 'Проверить график ТО и запас расходников',
  'Прочее': 'Запретить причину «Прочее» при записи простоя',
}
const todo = (reason: string) => TODO[reason] ?? TODO['Прочее']

export interface MiniSeries { label: string; color: string; data: number[] }
export interface Mini {
  type: 'columns' | 'lines'
  labels: string[]
  titles: string[]
  series: MiniSeries[]
  note: string
  unit: string
  wins?: Win[] // для линий по неделям
}
export interface Insight {
  level: 'crit' | 'warn' | 'info'
  title: string
  /** Одна строка с главной цифрой — для списка выводов; подробности — в body */
  headline: string
  /** Главная цифра крупно и пояснение к ней — для карточки на Сводке */
  metric: string
  why: string
  /** «Что делать» одной строкой; полная рекомендация — action */
  todo: string
  body: Seg[]
  action: string
  mini?: Mini
}
export interface InsightCtx {
  F: Filtered
  f: Filters
  p: Params
  s: Summary
  /** показывать ли деньги: роли без права на финансы их не видят */
  money: boolean
}

// ---------- 1: станок, у которого потери резко выросли на последней неделе ----------
function machineSpike({ F, f }: InsightCtx): Insight | null {
  const { from, to } = f
  if (!from || daysBetween(from, to) < 14) return null
  const U = F.D.filter((r) => !r.planned)
  const recentFrom = addDays(to, -6)
  const priorWeeks = (daysBetween(from, recentFrom) - 1) / 7
  if (priorWeeks < 1) return null

  let best: { m: string; rec: number; avg: number; rows: typeof U } | null = null
  for (const m of new Set(U.map((r) => r.machine))) {
    const rows = U.filter((r) => r.machine === m)
    const rec = sum(rows.filter((r) => r.date >= recentFrom), (r) => r.min)
    const avg = sum(rows.filter((r) => r.date < recentFrom), (r) => r.min) / priorWeeks
    if (rec >= 180 && rec >= 2 * Math.max(avg, 1) && (!best || rec - avg > best.rec - best.avg)) best = { m, rec, avg, rows }
  }
  if (!best) return null

  const recRows = best.rows.filter((r) => r.date >= recentFrom)
  const byReason = new Map<string, number>()
  recRows.forEach((r) => byReason.set(r.reason, (byReason.get(r.reason) ?? 0) + r.min))
  const [topReason, topMin] = [...byReason].sort((a, c) => c[1] - a[1])[0]
  const topRows = recRows.filter((r) => r.reason === topReason)
  const days = [...new Set(topRows.map((r) => r.date))].sort()
  let streak = 0 // подряд идущие дни в конце периода
  for (let d = to; days.includes(d); d = addDays(d, -1)) streak++
  const shiftMin = { 1: 0, 2: 0 }
  topRows.forEach((r) => { shiftMin[r.shift] += r.min })
  const domShift = shiftMin[1] >= 0.8 * topMin ? 1 : shiftMin[2] >= 0.8 * topMin ? 2 : 0
  const op = recRows[0].op.toLowerCase()

  const body: Seg[] = [
    b(best.m), ' (' + op + '): за последние 7 дней (' + dm(recentFrom) + '–' + dm(to) + ') потеряно ', b(hours(best.rec) + ' ч'),
    ' — в ' + nf(best.rec / Math.max(best.avg, 1), 1) + ' раза больше обычных ' + hours(best.avg) + ' ч в неделю. ' +
      nf(topMin) + ' мин (' + nf((topMin / best.rec) * 100) + '%) — «' + topReason + '»',
    ...(streak >= 2 ? [', ', b(streak + ' дня подряд'), ' (' + dm(addDays(to, -streak + 1)) + '–' + dm(to) + ')'] : []),
    (domShift ? ', почти целиком в ' + (domShift === 1 ? 'дневную' : 'ночную') + ' смену' : '') + '.',
  ]

  // Для «ожидания заготовок» смотрим, простаивал ли предыдущий передел: без этого нельзя отличить поломку раскроя от проблемы подачи
  const idx = CHAIN.indexOf(op)
  if (topReason === 'Ожидание заготовок' && idx > 0) {
    const upOp = CHAIN[idx - 1]
    const upRows = F.Dall.filter((r) => !r.planned && r.op.toLowerCase() === upOp)
    if (upRows.length) {
      const upRecent = sum(upRows.filter((r) => r.date >= recentFrom), (r) => r.min)
      const upAvg = sum(upRows.filter((r) => r.date < recentFrom), (r) => r.min) / priorWeeks
      body.push(
        ' Передел «' + upOp + '» за эти же 7 дней простоял всего ', b(nf(upRecent) + ' мин'),
        ' (обычно ' + nf(upAvg) + '): ' +
          (upRecent <= upAvg * 1.2
            ? 'он работал в обычном режиме, а заготовок всё равно не хватало. Вероятно, дело в очерёдности и подаче, а не в поломках; журнал этого не доказывает — проверьте на месте.'
            : 'возможно, причина в них — проверьте, не они задерживают подачу.'),
      )
    }
  }

  // Мини-график: часы простоя по дням за последние 14 дней, главная причина отдельным цветом
  const start = addDays(to, -13) < from ? from : addDays(to, -13)
  const dayList: string[] = []
  for (let d = start; d <= to; d = addDays(d, 1)) dayList.push(d)
  const hoursOf = (d: string, pred: (r: (typeof U)[number]) => boolean) => sum(best!.rows.filter((r) => r.date === d && pred(r)), (r) => r.min) / 60

  return {
    level: 'crit',
    title: 'Резкий рост простоев станка ' + best.m,
    headline: hours(best.rec) + ' ч за неделю — в ' + nf(best.rec / Math.max(best.avg, 1), 1) + ' раза больше обычного; главная причина «' + topReason + '»',
    metric: hours(best.rec) + ' ч за неделю',
    why: 'в ' + nf(best.rec / Math.max(best.avg, 1), 1) + ' раза больше обычного · причина «' + topReason + '»',
    todo: todo(topReason),
    body,
    action: action(topReason),
    mini: {
      type: 'columns', unit: 'ч', note: best.m + ' — простои по дням, ч',
      labels: dayList.map((d) => d.slice(8)), titles: dayList.map(dm),
      series: [
        { label: '«' + topReason + '»', color: reasonColor(topReason), data: dayList.map((d) => hoursOf(d, (r) => r.reason === topReason)) },
        { label: 'Другие причины', color: 'var(--viz-neutral)', data: dayList.map((d) => hoursOf(d, (r) => r.reason !== topReason)) },
      ],
    },
  }
}

// ---------- 2: операция и смена, где брак резко вырос ----------
function defectSpike({ F, f, p, money }: InsightCtx): Insight | null {
  const { from, to } = f
  if (!from) return null
  const wins = windows(from, to)
  if (wins.length < 3) return null
  const last = wins.length - 1

  let best: { op: string; shift: 1 | 2; counts: number[]; rec: number; prev: number } | null = null
  for (const op of new Set(F.B.map((r) => r.op))) {
    for (const shift of [1, 2] as const) {
      const counts = wins.map((w) => sum(F.B.filter((r) => r.op === op && r.shift === shift && inWin(r, w)), (r) => r.qty))
      const prev = mean(counts.slice(0, last))
      if (counts[last] >= 10 && counts[last] >= 2 * Math.max(prev, 1) && (!best || counts[last] - prev > best.rec - best.prev)) {
        best = { op, shift, counts, rec: counts[last], prev }
      }
    }
  }
  if (!best) return null

  const w = wins[last]
  const shiftWord2 = best.shift === 1 ? 'днём' : 'ночью'
  const other = (3 - best.shift) as 1 | 2
  const otherCounts = wins.map((x) => sum(F.B.filter((r) => r.op === best!.op && r.shift === other && inWin(r, x)), (r) => r.qty))
  const recRows = F.B.filter((r) => r.op === best!.op && r.shift === best!.shift && inWin(r, w))
  const byType = new Map<string, number>()
  recRows.forEach((r) => byType.set(r.type, (byType.get(r.type) ?? 0) + r.qty))
  const [topType, topQty] = [...byType].sort((a, c) => c[1] - a[1])[0]

  const body: Seg[] = [
    b(best.op + ', ' + (best.shift === 1 ? 'день' : 'ночь')), ': за неделю ' + w.title + ' — ', b(best.rec + ' шт'),
    ' брака, в ' + nf(best.rec / Math.max(best.prev, 1), 1) + ' раза больше среднего (' + nf(best.prev, 1) + ' шт). ' +
      (best.shift === 1 ? 'Ночью' : 'Днём') + ' на этой операции за ту же неделю — ' + otherCounts[last] + ' шт: проблема именно ' + (best.shift === 1 ? 'в дневной' : 'в ночной') + ' смене. ' +
      'Основной дефект — «' + topType + '» (' + topQty + ' из ' + best.rec + ').',
  ]

  // Что совпало по времени: причина простоя на станках этой операции в ту же смену и неделю
  const dRows = F.Dall.filter((r) => !r.planned && r.op === best!.op && r.shift === best!.shift)
  const reasons = [...new Set(dRows.map((r) => r.reason))]
    .map((re) => {
      const per = wins.map((x) => sum(dRows.filter((r) => r.reason === re && inWin(r, x)), (r) => r.min))
      return { re, rec: per[last], avg: mean(per.slice(0, last)) }
    })
    .filter((x) => x.rec >= 60 && x.rec >= 2 * Math.max(x.avg, 15))
    .sort((a, c) => c.rec - c.avg - (a.rec - a.avg))
  if (reasons.length) {
    const x = reasons[0]
    body.push(
      ' В ту же неделю на станках этой операции ' + shiftWord2 + ' — ', b(nf(x.rec) + ' мин простоя по причине «' + x.re + '»'),
      ' (раньше ≈ ' + nf(x.avg) + ' мин в неделю). Это совпадение по времени, а не доказанная причина, но проверить стоит в первую очередь.',
    )
  }
  const extra = best.rec - best.prev
  body.push(' Лишний брак ≈ ' + nf(extra) + ' шт' + (money ? ' (≈ ' + nf((extra * p.pieceCost) / 1000) + ' тыс. ₽)' : '') + '.')

  return {
    level: 'crit',
    headline: best.rec + ' шт за неделю — в ' + nf(best.rec / Math.max(best.prev, 1), 1) + ' раза больше среднего; основной дефект «' + topType + '»',
    metric: best.rec + ' шт за неделю',
    why: 'в ' + nf(best.rec / Math.max(best.prev, 1), 1) + ' раза больше среднего · дефект «' + topType + '»',
    todo: 'Проверять первые детали после переналадки в ' + (best.shift === 1 ? 'дневную' : 'ночную') + ' смену',
    title: 'Рост брака: ' + best.op.toLowerCase() + ', ' + (best.shift === 1 ? 'дневная' : 'ночная') + ' смена',
    body,
    action:
      'на ' + (best.shift === 1 ? 'дневную' : 'ночную') + ' смену поставить контроль первых деталей после каждой переналадки («' + topType + '»), сравнить с ' +
      (best.shift === 1 ? 'ночной' : 'дневной') + ' сменой: инструмент, настройка, кто работал, и передачу смены.',
    mini: {
      type: 'lines', unit: 'шт', note: best.op + ' — брак по неделям, шт',
      labels: wins.map((x) => x.label), titles: wins.map((x) => x.title), wins,
      series: [
        { label: 'День', color: shiftColor(1), data: best.shift === 1 ? best.counts : otherCounts },
        { label: 'Ночь', color: shiftColor(2), data: best.shift === 2 ? best.counts : otherCounts },
      ],
    },
  }
}

// ---------- 3: одна смена теряет заметно больше времени ----------
function shiftGap({ F }: InsightCtx): Insight | null {
  const U = F.D.filter((r) => !r.planned)
  const t = { 1: sum(U.filter((r) => r.shift === 1), (r) => r.min), 2: sum(U.filter((r) => r.shift === 2), (r) => r.min) }
  if (!t[1] || !t[2]) return null
  const lead = (t[2] >= t[1] ? 2 : 1) as 1 | 2
  const oth = (3 - lead) as 1 | 2
  if (t[lead] / t[oth] < 1.2) return null
  const by = (s: number) => {
    const m = new Map<string, number>()
    U.filter((r) => r.shift === s).forEach((r) => m.set(r.reason, (m.get(r.reason) ?? 0) + r.min))
    return m
  }
  const a = by(lead), o = by(oth)
  const [re, dv] = [...a].map(([k, v]) => [k, v - (o.get(k) ?? 0)] as const).sort((x, y) => y[1] - x[1])[0]
  const name = (s: number) => (s === 1 ? 'Дневная' : 'Ночная')
  return {
    level: 'warn',
    title: name(lead) + ' смена теряет больше времени',
    headline: hours(t[lead]) + ' ч против ' + hours(t[oth]) + ' ч — на ' + nf((t[lead] / t[oth] - 1) * 100) + '% больше; больше всего разницы даёт «' + re + '»',
    metric: hours(t[lead]) + ' ч против ' + hours(t[oth]) + ' ч',
    why: 'на ' + nf((t[lead] / t[oth] - 1) * 100) + '% больше · разницу даёт «' + re + '»',
    todo: todo(re),
    body: [
      name(lead) + ' смена: ', b(hours(t[lead]) + ' ч'), ' внеплановых простоев против ' + hours(t[oth]) + ' ч в ' + (oth === 1 ? 'дневную' : 'ночную') +
        ' (на ' + nf((t[lead] / t[oth] - 1) * 100) + '% больше). Больше всего разницы даёт «' + re + '»: +' + hours(dv) + ' ч к другой смене.',
    ],
    action: action(re),
  }
}

// ---------- 4: общая картина потерь ----------
function overview({ F, p, s, money }: InsightCtx): Insight | null {
  const U = F.D.filter((r) => !r.planned)
  if (!U.length) return null
  const loss = sum(U, (r) => r.min)
  const m = new Map<string, number>()
  U.forEach((r) => m.set(r.reason, (m.get(r.reason) ?? 0) + r.min))
  const reasons = [...m].sort((a, c) => c[1] - a[1])
  const mm = new Map<string, number>()
  U.forEach((r) => mm.set(r.machine, (mm.get(r.machine) ?? 0) + r.min))
  const machines = [...mm].sort((a, c) => c[1] - a[1])
  const topShare = (reasons[0][1] / loss) * 100
  const top3 = (reasons.slice(0, 3).reduce((x, r) => x + r[1], 0) / loss) * 100
  const other = m.get('Прочее') ?? 0

  const body: Seg[] = [
    'Потеряно ', b(hours(loss) + ' ч'),
    (s.fundMin ? ' (' + nf((loss / s.fundMin) * 100, 1) + '% фонда времени)' : '') + (money ? ', ≈ ' + nf(((loss / 60) * p.hourCost) / 1000) + ' тыс. ₽ по ставке ' + nf(p.hourCost) + ' ₽/ч' : '') + '. Больше всего теряют ',
    b(machines[0][0]), ' (' + hours(machines[0][1]) + ' ч)',
    ...(machines[1] ? [' и ', b(machines[1][0]), ' (' + hours(machines[1][1]) + ' ч)'] : []),
    '. Крупнейшая причина — «' + reasons[0][0] + '» (' + nf(topShare) + '%).' +
      (topShare < 25 ? ' Потери размазаны по всем причинам: три крупнейшие дают лишь ' + nf(top3) + '%, поэтому одним решением проблему не закрыть.' : '') +
      (other / loss > 0.15 ? ' На «Прочее» приходится ' + nf((other / loss) * 100) + '% — это значит, что часть причин при записи не определена.' : ''),
  ]
  return {
    level: 'info',
    title: 'Общая картина потерь',
    headline: hours(loss) + ' ч потерь; крупнейшая причина «' + reasons[0][0] + '» — ' + nf(topShare) + '%, поэтому одним решением не закрыть',
    metric: hours(loss) + ' ч потерь',
    why: 'крупнейшая причина «' + reasons[0][0] + '» — ' + nf(topShare) + '%: одним решением не закрыть',
    todo: other / loss > 0.15 ? TODO['Прочее'] : 'Начать со станка-лидера и его главной причины',
    body,
    action: other / loss > 0.15 ? ACTION['Прочее'] : 'начать со станка-лидера по потерям и его главной причины (см. лист «Простои»).',
  }
}

export function buildInsights(ctx: InsightCtx): Insight[] {
  return [machineSpike(ctx), defectSpike(ctx), shiftGap(ctx), overview(ctx)].filter((x): x is Insight => !!x)
}
