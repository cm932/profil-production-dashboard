// Начальное наполнение пустой базы: исходные журналы задания и учётные записи.
import { audit, loadSeed, nowIso } from './db.js'
import { hashPassword, tempPassword } from './auth.js'

/** Демонстрационные учётные записи для курса. В рабочей среде запускайте с PROFIL_DEMO=0 — тогда создаётся только администратор. */
export const DEMO_USERS = [
  { login: 'admin', name: 'Администратор системы', role: 'admin', shop: null, password: 'Admin-2026!' },
  { login: 'director', name: 'Директор фабрики', role: 'director', shop: null, password: 'Director-2026!' },
  { login: 'chief1', name: 'Начальник цеха 1', role: 'chief', shop: 'Цех 1', password: 'Chief1-2026!' },
  { login: 'chief2', name: 'Начальник цеха 2', role: 'chief', shop: 'Цех 2', password: 'Chief2-2026!' },
  { login: 'otk', name: 'Оператор ОТК', role: 'otk', shop: null, password: 'Otk-2026!' },
]

async function addUser(db, u, { demo, mustChange = false }) {
  db.prepare('INSERT INTO users (login, name, role, shop, pw_hash, active, must_change, demo, created_at) VALUES (?,?,?,?,?,1,?,?,?)')
    .run(u.login, u.name, u.role, u.shop, await hashPassword(u.password), mustChange ? 1 : 0, demo ? 1 : 0, nowIso())
}

/** Возвращает { created, adminPassword? } — пароль администратора показывается один раз в консоли */
export async function seedIfEmpty(db, { demo, adminPassword, log = console.log }) {
  const n = db.prepare('SELECT COUNT(*) AS n FROM users').get().n
  if (n > 0) return { created: false }
  let generated = null
  if (demo) {
    for (const u of DEMO_USERS) await addUser(db, u, { demo: true })
  } else {
    const pw = adminPassword || (generated = tempPassword())
    await addUser(db, { login: 'admin', name: 'Администратор системы', role: 'admin', shop: null, password: pw }, { demo: false, mustChange: true })
  }
  const counts = loadSeed(db)
  audit(db, { action: 'system_seed', detail: `демо=${demo}; простоев ${counts.downtime}, брака ${counts.defects}` })
  log(`База создана: простоев ${counts.downtime}, брака ${counts.defects}, учётных записей ${demo ? DEMO_USERS.length : 1}.`)
  return { created: true, adminPassword: generated }
}
