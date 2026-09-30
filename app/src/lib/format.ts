export const nf = (n: number, d = 0) =>
  Number(n).toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d })

export const hours = (min: number) => nf(min / 60, 1)

export const rub = (v: number) => (v >= 1e6 ? nf(v / 1e6, 2) + ' млн ₽' : nf(Math.round(v / 1000)) + ' тыс. ₽')

export const ruDate = (iso: string) => {
  const [y, m, d] = iso.split('-')
  return d + '.' + m + '.' + y
}

export const ruDateShort = (iso: string) => iso.slice(8) + '.' + iso.slice(5, 7)

/** Склонение: plural(94, 'случай', 'случая', 'случаев') */
export const plural = (n: number, one: string, few: string, many: string) => {
  const a = Math.abs(n) % 100
  const b = a % 10
  return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many
}

export const SHIFT_NAME: Record<number, string> = { 1: 'День', 2: 'Ночь' }
