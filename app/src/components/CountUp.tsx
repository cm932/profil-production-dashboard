// Счётчик на anime.js: число «докручивается» к новому значению.
// Прерываемость: новая цель стартует с ТЕКУЩЕГО значения на экране (а не с прошлой цели) — при быстрой смене фильтров нет скачков.
// Первый показ — 700 мс (редкое событие), пересчёт после смены фильтра — 380 мс (частое действие).
// При prefers-reduced-motion значение ставится сразу. data-value всегда хранит точное число.
import { useLayoutEffect, useRef } from 'react'
import { animate } from 'animejs'
import { prefersReduced } from '@/lib/motion'

export function CountUp({ value, format }: { value: number; format: (n: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const live = useRef<number | null>(null) // что сейчас показано на экране

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const first = live.current == null
    const from = live.current ?? 0
    if (prefersReduced() || from === value) {
      live.current = value
      el.textContent = format(value)
      return
    }
    const state = { v: from }
    const anim = animate(state, {
      v: value,
      duration: first ? 700 : 380,
      ease: 'outExpo',
      onUpdate: () => { live.current = state.v; el.textContent = format(state.v) },
      onComplete: () => { live.current = value; el.textContent = format(value) },
    })
    // format — чистая функция от числа; пересоздавать анимацию из-за неё не нужно
    return () => { anim.cancel() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  return <span ref={ref} data-value={value}>{format(value)}</span>
}
