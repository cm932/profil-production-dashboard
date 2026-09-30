// Проверка всего, что приходит от клиента. Сервер не доверяет интерфейсу: каждое поле проверяется заново.
import { ROLE_IDS } from './roles.js'

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/

export function validDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d && y >= 2000 && y <= 2100
}

function text(v, field, { min = 0, max = 100 } = {}) {
  if (typeof v !== 'string') return { error: `«${field}»: нужна строка` }
  const s = v.trim().replace(/\s+/g, ' ')
  if (s.length < min) return { error: `«${field}»: обязательное поле` }
  if (s.length > max) return { error: `«${field}»: не длиннее ${max} символов` }
  if (CONTROL.test(s)) return { error: `«${field}»: недопустимые символы` }
  return { value: s }
}

function int(v, field, { min = 0, max = 1e6 } = {}) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  if (!Number.isInteger(n) || n < min || n > max) return { error: `«${field}»: целое число от ${min} до ${max}` }
  return { value: n }
}

function shift(v) {
  const n = typeof v === 'string' ? Number(v) : v
  return n === 1 || n === 2 ? { value: n } : { error: '«смена»: 1 (день) или 2 (ночь)' }
}

function run(spec, rec) {
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return { error: 'запись должна быть объектом' }
  const out = {}
  for (const [key, fn] of Object.entries(spec)) {
    const r = fn(rec[key])
    if (r.error) return { error: r.error }
    out[key] = r.value
  }
  return { value: out }
}

const dateField = (v) => (validDate(v) ? { value: v } : { error: '«дата»: формат ГГГГ-ММ-ДД, существующая дата' })

export const validateDowntime = (rec) =>
  run({
    date: dateField,
    machine: (v) => text(v, 'станок', { min: 1, max: 20 }),
    machineName: (v) => text(v ?? '', 'наименование', { max: 80 }),
    op: (v) => text(v, 'операция', { min: 1, max: 30 }),
    shop: (v) => text(v ?? '', 'цех', { max: 30 }),
    shift: shift,
    reason: (v) => text(v, 'причина', { min: 1, max: 60 }),
    planned: (v) => (typeof v === 'boolean' ? { value: v } : { error: '«плановый»: да или нет' }),
    min: (v) => int(v, 'длительность, мин', { min: 0, max: 1440 }),
  }, rec)

export const validateDefect = (rec) =>
  run({
    date: dateField,
    type: (v) => text(v, 'тип дефекта', { min: 1, max: 60 }),
    op: (v) => text(v, 'операция', { min: 1, max: 30 }),
    qty: (v) => int(v, 'количество', { min: 0, max: 10000 }),
    order: (v) => text(v ?? '', 'заказ', { max: 30 }),
    shift: shift,
  }, rec)

export const validators = { downtime: validateDowntime, defects: validateDefect }

export function validateUser(input, { partial = false } = {}) {
  const out = {}
  if (!partial || 'login' in input) {
    const l = typeof input.login === 'string' ? input.login.trim() : ''
    if (!/^[A-Za-z0-9_.-]{3,32}$/.test(l)) return { error: 'Логин: 3–32 символа, латиница, цифры, «_», «.», «-».' }
    out.login = l
  }
  if (!partial || 'name' in input) {
    const r = text(input.name, 'имя', { min: 1, max: 80 })
    if (r.error) return { error: 'Имя: от 1 до 80 символов, без управляющих.' }
    out.name = r.value
  }
  if (!partial || 'role' in input) {
    if (!ROLE_IDS.includes(input.role)) return { error: 'Роль: одна из ' + ROLE_IDS.join(', ') + '.' }
    out.role = input.role
  }
  if (!partial || 'shop' in input) {
    const r = text(input.shop ?? '', 'цех', { max: 30 })
    if (r.error) return { error: r.error }
    out.shop = r.value || null
  }
  if ('active' in input) {
    if (typeof input.active !== 'boolean') return { error: 'Активность: true или false.' }
    out.active = input.active
  }
  const role = out.role ?? input.role
  if (role === 'chief' && 'shop' in out && !out.shop) return { error: 'Для начальника цеха нужно указать цех.' }
  if (role && role !== 'chief' && out.shop) out.shop = null // цех имеет смысл только у начальника цеха
  return { value: out }
}
