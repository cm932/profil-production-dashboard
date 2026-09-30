// Постоянные подписи значений на столбцах Bklit (у самой библиотеки значения видны только при наведении,
// а на бумаге — в PDF — наведения нет). Слой читает масштабы графика из контекста и ставит текст у конца столбца.
// mode 'each' — подпись у каждого столбца, 'stack' — суммарная подпись у конца стопки.
import { motion } from 'motion/react'
import { useChart } from '@/components/charts/chart-context'
import { EASE_OUT } from '@/lib/motion'

export interface LabelArgs { row: Record<string, unknown>; index: number; key: string; value: number; total: number }

export function BarValueLabels({ mode, format, groupGap = 4, stackGap = 0 }: {
  mode: 'each' | 'stack'
  format: (a: LabelArgs) => string
  groupGap?: number
  /** зазор между сегментами стопки: у Bklit он суммируется вдоль стопки, подпись должна стоять за концом последнего сегмента */
  stackGap?: number
}) {
  const { data, lines, yScale, barScale, bandWidth, barXAccessor, orientation } = useChart()
  if (!barScale || !bandWidth || !barXAccessor || orientation !== 'horizontal') return null

  const n = lines.length
  const barH = mode === 'each' ? (bandWidth - groupGap * (n - 1)) / n : bandWidth

  const items: { x: number; y: number; text: string; k: string }[] = []
  data.forEach((row, i) => {
    const band = barScale(barXAccessor(row)) ?? 0
    const total = lines.reduce((s, l) => s + (typeof row[l.dataKey] === 'number' ? (row[l.dataKey] as number) : 0), 0)
    if (mode === 'stack') {
      if (total > 0) items.push({ x: (yScale(total) ?? 0) + (n - 1) * stackGap + 8, y: band + bandWidth / 2, text: format({ row, index: i, key: '', value: total, total }), k: 'r' + i })
      return
    }
    lines.forEach((l, si) => {
      const v = row[l.dataKey]
      if (typeof v !== 'number' || v <= 0) return
      items.push({ x: (yScale(v) ?? 0) + 8, y: band + si * (barH + groupGap) + barH / 2, text: format({ row, index: i, key: l.dataKey, value: v, total }), k: 'r' + i + l.dataKey })
    })
  })

  return (
    <motion.g
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25, ease: EASE_OUT, delay: 0.45 }}
      pointerEvents="none"
      data-bar-labels=""
    >
      {items.map((it) => (
        <text
          key={it.k}
          x={it.x}
          y={it.y}
          dominantBaseline="central"
          style={{ fill: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', fontSize: 12.5, fontVariantNumeric: 'tabular-nums' }}
        >
          {it.text}
        </text>
      ))}
    </motion.g>
  )
}

/** Засечки оси значений (у Bklit для столбцов и линий отдельной оси значений нет).
 *  Вертикальные графики — слева, горизонтальные — снизу. */
export function ValueTicks({ count = 4, format }: { count?: number; format: (v: number) => string }) {
  const { yScale, orientation, innerHeight } = useChart()
  const ticks: number[] = (yScale as unknown as { ticks?: (n: number) => number[] }).ticks?.(count) ?? []
  const horizontal = orientation === 'horizontal'
  return (
    <g pointerEvents="none" data-value-ticks="">
      {ticks.map((t) => {
        const pos = yScale(t) ?? 0
        return (
          <text
            key={t}
            x={horizontal ? pos : -10}
            y={horizontal ? innerHeight + 18 : pos}
            textAnchor={horizontal ? 'middle' : 'end'}
            dominantBaseline={horizontal ? 'auto' : 'central'}
            style={{ fill: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}
          >
            {format(t)}
          </text>
        )
      })}
    </g>
  )
}
ValueTicks.displayName = 'ValueTicks' // Bklit узнаёт компоненты по имени; в сборке имена функций сжимаются
BarValueLabels.displayName = 'BarValueLabels'

/** Подписи недель на оси времени линейных графиков: строго по строкам данных (без лишних делений на полях шкалы). */
export function DateTicks({ format }: { format: (row: Record<string, unknown>) => string }) {
  const { data, xScale, xAccessor, innerHeight } = useChart()
  return (
    <g pointerEvents="none" data-date-ticks="">
      {data.map((row, i) => (
        <text
          key={i}
          x={xScale(xAccessor(row)) ?? 0}
          y={innerHeight + 18}
          textAnchor="middle"
          style={{ fill: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 12 }}
        >
          {format(row)}
        </text>
      ))}
    </g>
  )
}
DateTicks.displayName = 'DateTicks'

/** Подпись последней точки каждой линии — выборочная прямая подпись вместо чисел на каждой точке. */
export function SeriesEndLabels({ keys, format }: { keys: { key: string; color: string }[]; format: (v: number) => string }) {
  const { data, xScale, xAccessor, yScale } = useChart()
  const last = data[data.length - 1]
  if (!last) return null
  return (
    <g pointerEvents="none" data-end-labels="">
      {keys.map((k) => {
        const v = last[k.key]
        if (typeof v !== 'number') return null
        return (
          <text
            key={k.key}
            x={(xScale(xAccessor(last)) ?? 0) + 9}
            y={yScale(v) ?? 0}
            dominantBaseline="central"
            style={{ fill: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: 12.5, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}
          >
            {format(v)}
          </text>
        )
      })}
    </g>
  )
}
SeriesEndLabels.displayName = 'SeriesEndLabels'
