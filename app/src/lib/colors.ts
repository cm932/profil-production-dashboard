// Сущность ↔ цвет закреплены, чтобы фильтр не перекрашивал оставшиеся ряды.
// Смены занимают слоты 1–2 палитры, причины простоев — 3–7 (один цвет не значит разное).
const REASON_ORDER = ['Ожидание заготовок', 'Нет материала', 'Нет оператора', 'Переналадка', 'Поломка']
const NEUTRAL = ['Прочее', 'Плановое ТО']
const extra: string[] = []

export function reasonColor(reason: string): string {
  if (NEUTRAL.includes(reason)) return 'var(--viz-neutral)'
  let i = REASON_ORDER.indexOf(reason)
  if (i < 0) {
    if (!extra.includes(reason)) extra.push(reason)
    i = REASON_ORDER.length + extra.indexOf(reason)
  }
  i += 2
  return i < 7 ? `var(--viz-${i + 1})` : 'var(--viz-neutral)'
}

export const shiftColor = (s: 1 | 2) => (s === 1 ? 'var(--shift-day)' : 'var(--shift-night)')
export const reasonRank = (r: string) => {
  const i = REASON_ORDER.indexOf(r)
  return i < 0 ? 99 : i
}
