// Роли и права. Единственный источник правды для сервера; интерфейс использует свою копию (app/src/lib/roles.ts)
// только чтобы скрывать ненужные кнопки — настоящую проверку делает сервер на каждом запросе.

export const ROLES = {
  admin: {
    label: 'Администратор',
    sheets: ['summary', 'downtime', 'defects', 'data', 'admin'],
    money: true, upload: true, pdf: true, users: true, audit: true, settings: true,
    // какие журналы можно менять и чьи записи: 'all' — любые
    records: { downtime: 'all', defects: 'all' },
    scope: 'all',
  },
  director: {
    label: 'Директор',
    sheets: ['summary', 'downtime', 'defects', 'data'],
    money: true, upload: true, pdf: true, users: false, audit: false, settings: true,
    records: {},
    scope: 'all',
  },
  chief: {
    label: 'Начальник цеха',
    sheets: ['summary', 'downtime', 'defects', 'data'],
    money: false, upload: false, pdf: true, users: false, audit: false, settings: false,
    records: { downtime: 'own' }, // добавляет простои своего цеха, правит только свои записи
    scope: 'shop',
  },
  otk: {
    label: 'Оператор ОТК',
    sheets: ['defects', 'data'],
    money: false, upload: false, pdf: true, users: false, audit: false, settings: false,
    records: { defects: 'own' },
    scope: 'defects-only',
  },
}

export const ROLE_IDS = Object.keys(ROLES)
export const permsOf = (role) => ROLES[role] ?? null

/** Права в виде, безопасном для отправки в интерфейс */
export function publicPerms(role) {
  const r = ROLES[role]
  if (!r) return null
  return { label: r.label, sheets: r.sheets, money: r.money, upload: r.upload, pdf: r.pdf, users: r.users, audit: r.audit, settings: r.settings, records: r.records }
}

/** Можно ли пользователю добавлять записи в журнал kind */
export const canCreate = (user, kind) => !!ROLES[user.role]?.records[kind]

/** Можно ли менять/удалять конкретную запись */
export function canModify(user, kind, rec) {
  const mode = ROLES[user.role]?.records[kind]
  if (!mode) return false
  if (mode === 'all') return true
  // 'own': только записи, которые создал сам пользователь (и для начальника цеха — только в его цехе)
  if (rec.created_by !== user.id) return false
  if (kind === 'downtime' && user.role === 'chief' && rec.shop !== user.shop) return false
  return true
}

/** Какие строки журналов положены пользователю. Общее правило для сервера (api.js) и для зашифрованного файла (tools/seal.js):
 *  начальник цеха — простои своего цеха и брак по операциям своего цеха (операция ↔ цех — по журналу простоев;
 *  операции, которых в журнале простоев нет, например «Сборка», видят оба начальника); оператор ОТК — только брак. */
export function scopeRows(user, dt, df) {
  const scope = ROLES[user.role]?.scope
  if (scope === 'all') return { dt, df }
  if (scope === 'defects-only') return { dt: [], df }
  if (scope !== 'shop') return { dt: [], df: [] }
  const opShops = new Map()
  for (const r of dt) { if (!opShops.has(r.op)) opShops.set(r.op, new Set()); opShops.get(r.op).add(r.shop) }
  return {
    dt: dt.filter((r) => r.shop === user.shop),
    df: df.filter((r) => { const s = opShops.get(r.op); return !s || s.size === 0 || s.has(user.shop) }),
  }
}
