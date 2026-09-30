// Автоматические тесты сервера: вход, права ролей, отбор данных, защита от подбора и подделки запросов, проверка ввода.
// Запуск: node tools/test-server.js   (сервер поднимается на случайном порту с базой в памяти, ничего не портится)
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from '../server/index.js'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'server', 'seed.json'), 'utf8'))

const results = []
const test = async (name, fn) => {
  try { await fn(); results.push({ name, ok: true }) } catch (e) { results.push({ name, ok: false, err: e }) }
}

const s = await startServer({ port: 0, dbFile: ':memory:', demo: true, log: () => {} })
const base = s.url.replace(/\/$/, '')
const H = { 'Content-Type': 'application/json', 'X-Requested-With': 'profil' }

/** Клиент с «кошельком» cookie — как браузер */
class Client {
  cookie = ''
  async req(method, url, body, headers = {}) {
    const res = await fetch(base + url, {
      method, redirect: 'manual',
      headers: { ...(body !== undefined || method !== 'GET' ? H : {}), ...(this.cookie ? { Cookie: this.cookie } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    })
    const set = res.headers.get('set-cookie')
    if (set) this.cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0]
    let json = null
    try { json = await res.json() } catch { /* не JSON */ }
    return { status: res.status, json, headers: res.headers }
  }
  get = (u) => this.req('GET', u)
  post = (u, b = {}) => this.req('POST', u, b)
  put = (u, b = {}) => this.req('PUT', u, b)
  del = (u) => this.req('DELETE', u)
  async login(login, password) { const r = await this.post('/api/login', { login, password }); assert.equal(r.status, 200, `вход ${login}: ${JSON.stringify(r.json)}`); return r.json }
}
const as = async (login, password) => { const c = new Client(); await c.login(login, password); return c }
const PW = { admin: 'Admin-2026!', director: 'Director-2026!', chief1: 'Chief1-2026!', chief2: 'Chief2-2026!', otk: 'Otk-2026!' }
const clients = {}
for (const [l, p] of Object.entries(PW)) clients[l] = await as(l, p)

const okDowntime = { date: '2026-06-10', machine: 'К-1', machineName: 'Кромкооблицовочный станок', op: 'Кромка', shop: 'Цех 1', shift: 1, reason: 'Поломка', planned: false, min: 30 }
const okDefect = { date: '2026-06-10', type: 'Царапина', op: 'Сборка', qty: 2, order: 'З-9999', shift: 2 }

// ------------------------------------------------------------------ страница и заголовки
await test('страница панели отдаётся с политикой безопасности и защитными заголовками', async () => {
  const r = await fetch(base + '/')
  assert.equal(r.status, 200)
  const csp = r.headers.get('content-security-policy') ?? ''
  assert.match(csp, /script-src 'sha256-/)
  assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/)
  assert.match(csp, /frame-ancestors 'none'/)
  assert.equal(r.headers.get('x-frame-options'), 'DENY')
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff')
})
await test('без входа данные, пользователи и журнал недоступны (401)', async () => {
  const c = new Client()
  for (const u of ['/api/data', '/api/users', '/api/audit', '/api/me']) assert.equal((await c.get(u)).status, 401, u)
})
await test('неизвестные адреса — 404, посторонние пути не отдают файлов', async () => {
  const c = new Client()
  for (const u of ['/server/seed.json', '/../package.json', '/etc/passwd', '/api/nothing']) assert.ok([401, 404].includes((await c.get(u)).status), u)
})

// ------------------------------------------------------------------ вход
await test('испорченные cookie и заголовки не роняют сервер (нет ответа 500)', async () => {
  const a = await fetch(base + '/api/me', { headers: { Cookie: 'sid=%E0%A4%A' } })
  assert.equal(a.status, 401)
  const b = await fetch(base + '/api/settings', { method: 'PUT', headers: { ...H, Origin: 'null' }, body: '{}' })
  assert.equal(b.status, 403)
  assert.equal((await fetch(base + '/api/me', { headers: { Cookie: 'x'.repeat(50000) } }).catch(() => ({ status: 431 }))).status === 500, false)
})
await test('блокировка после пяти неудач одинаково срабатывает и для несуществующего логина', async () => {
  const c = new Client()
  let last
  for (let i = 0; i < 6; i++) last = await c.post('/api/login', { login: 'no-such-user-42', password: 'плохой-' + i })
  assert.equal(last.status, 429)
})
await test('неверный пароль и несуществующий логин дают одинаковый ответ', async () => {
  const c = new Client()
  const a = await c.post('/api/login', { login: 'director', password: 'wrong-password' })
  const b = await c.post('/api/login', { login: 'nobody', password: 'wrong-password' })
  assert.equal(a.status, 401); assert.equal(b.status, 401)
  assert.equal(a.json.error, b.json.error)
})
await test('SQL-инъекция во входе не проходит и не ломает базу', async () => {
  const c = new Client()
  for (const login of ["admin' OR '1'='1", "admin'--", "'; DROP TABLE users; --"]) {
    assert.equal((await c.post('/api/login', { login, password: "' OR '1'='1" })).status, 401)
  }
  assert.equal((await as('admin', PW.admin)).cookie.startsWith('sid='), true) // таблица users цела
})
await test('cookie сессии: HttpOnly и SameSite=Strict; токен в базе не хранится открытым текстом', async () => {
  const c = new Client()
  const r = await c.post('/api/login', { login: 'director', password: PW.director })
  const set = r.headers.get('set-cookie')
  assert.match(set, /HttpOnly/i); assert.match(set, /SameSite=Strict/i)
  const token = c.cookie.slice(4)
  const rows = s.db.prepare('SELECT token_hash FROM sessions').all()
  assert.ok(rows.length > 0 && rows.every((x) => x.token_hash !== token && x.token_hash.length === 64))
})
await test('пароли хранятся хэшами scrypt с солью, а не открытым текстом', async () => {
  const rows = s.db.prepare('SELECT login, pw_hash FROM users').all()
  for (const r of rows) { assert.match(r.pw_hash, /^scrypt\$\d+\$\d+\$\d+\$[0-9a-f]{32}\$[0-9a-f]{128}$/); assert.ok(!Object.values(PW).some((p) => r.pw_hash.includes(p))) }
  assert.notEqual(rows[0].pw_hash, rows[1].pw_hash)
})
await test('пять неудачных попыток блокируют запись, даже верный пароль потом не пускает', async () => {
  const c = new Client()
  for (let i = 0; i < 5; i++) await c.post('/api/login', { login: 'chief2', password: 'bad-' + i })
  const r = await c.post('/api/login', { login: 'chief2', password: PW.chief2 })
  assert.equal(r.status, 429)
  assert.ok(Number(r.headers.get('retry-after')) > 0)
  const log = s.db.prepare("SELECT action FROM audit WHERE login = 'chief2' ORDER BY id").all().map((x) => x.action)
  assert.ok(log.includes('login_locked'))
  s.db.prepare("UPDATE users SET locked_until = 0, failed = 0 WHERE login = 'chief2'").run() // снимаем блокировку для остальных тестов
})
await test('выход закрывает сессию: старый cookie больше не работает', async () => {
  const c = await as('otk', PW.otk)
  const old = c.cookie
  assert.equal((await c.get('/api/me')).status, 200)
  assert.equal((await c.post('/api/logout')).status, 200)
  const c2 = new Client(); c2.cookie = old
  assert.equal((await c2.get('/api/me')).status, 401)
})
await test('страница панели не содержит данных (они приходят только после входа)', async () => {
  const html = await (await fetch(base + '/')).text()
  for (const marker of ['Кромкооблицовочный', 'Присадочный станок', 'Форматно-раскроечный', 'З-1237', 'clean_01_prostoi']) assert.ok(!html.includes(marker), 'в странице есть: ' + marker)
})
await test('сессия закрывается после длительного простоя', async () => {
  const c = await as('otk', PW.otk)
  s.db.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash IS NOT NULL').run(Date.now() - 3 * 3600 * 1000)
  assert.equal((await c.get('/api/me')).status, 401)
  for (const l of Object.keys(PW)) clients[l] = await as(l, PW[l]) // заново входим для остальных тестов
})

// ------------------------------------------------------------------ защита от подделки запросов и плохих запросов
await test('запрос на изменение без служебного заголовка или с чужим Origin отклоняется (403)', async () => {
  const c = clients.director
  const bare = await fetch(base + '/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: c.cookie }, body: '{"hourCost":1}' })
  assert.equal(bare.status, 403)
  const evil = await fetch(base + '/api/settings', { method: 'PUT', headers: { ...H, Origin: 'https://evil.example', Cookie: c.cookie }, body: '{"hourCost":1}' })
  assert.equal(evil.status, 403)
  assert.equal((await c.get('/api/data')).json.settings.hourCost, 3000) // ничего не изменилось
})
await test('некорректный JSON — 400, чужой тип содержимого — 415, огромный запрос — 413', async () => {
  const c = clients.director
  assert.equal((await c.req('PUT', '/api/settings', '{oops')).status, 400)
  assert.equal((await c.req('PUT', '/api/settings', '{}', { 'Content-Type': 'text/plain' })).status, 415)
  const big = JSON.stringify({ kind: 'downtime', mode: 'append', records: Array(200000).fill(okDowntime) })
  assert.equal((await c.req('POST', '/api/import', big)).status, 413)
})

// ------------------------------------------------------------------ матрица прав
const matrix = [
  // [метод, адрес, тело, {роль: ожидаемый статус}]
  ['GET', '/api/data', undefined, { admin: 200, director: 200, chief1: 200, otk: 200 }],
  ['GET', '/api/users', undefined, { admin: 200, director: 403, chief1: 403, otk: 403 }],
  ['GET', '/api/audit', undefined, { admin: 200, director: 403, chief1: 403, otk: 403 }],
  ['POST', '/api/admin/no-such-route', undefined, { admin: 404, director: 403, chief1: 403, otk: 403 }], // чужим ролям даже не сообщается, есть ли такой путь
  ['PUT', '/api/settings', { hourCost: 3000 }, { admin: 200, director: 200, chief1: 403, otk: 403 }],
  ['POST', '/api/import', { kind: 'downtime', mode: 'append', records: [] }, { admin: 200, director: 200, chief1: 403, otk: 403 }],
  ['POST', '/api/records/downtime', { record: okDowntime }, { admin: 201, director: 403, chief1: 201, otk: 403 }],
  ['POST', '/api/records/defects', { record: okDefect }, { admin: 201, director: 403, chief1: 403, otk: 201 }],
]
await test('матрица прав: каждая роль получает ровно то, что ей положено', async () => {
  const problems = []
  for (const [method, url, body, want] of matrix) {
    for (const [who, status] of Object.entries(want)) {
      const r = await clients[who].req(method, url, body)
      if (r.status !== status) problems.push(`${who} ${method} ${url}: ждали ${status}, получили ${r.status}`)
    }
  }
  assert.deepEqual(problems, [])
})

// ------------------------------------------------------------------ отбор данных по роли
const shopOps = (shop) => new Set(seed.downtime.filter((r) => r.shop === shop).map((r) => r.op))
const allOps = new Set(seed.downtime.map((r) => r.op))
await test('директор видит всё и получает ставки денег', async () => {
  const d = (await clients.director.get('/api/data')).json
  assert.equal(d.downtime.filter((r) => !r.createdBy).length, 120); assert.equal(d.defects.filter((r) => !r.createdBy).length, 94) // исходные записи; остальные добавили предыдущие тесты
  assert.ok(d.downtime.length >= 120 && d.defects.length >= 94)
  assert.ok(d.settings && d.settings.hourCost === 3000)
})
await test('начальник цеха 1 видит только свой цех и не получает ставок денег', async () => {
  const d = (await clients.chief1.get('/api/data')).json
  assert.ok(d.downtime.length > 0 && d.downtime.every((r) => r.shop === 'Цех 1'))
  const wantSum = seed.downtime.filter((r) => r.shop === 'Цех 1').reduce((a, r) => a + r.min, 0)
  assert.equal(d.downtime.filter((r) => !r.createdBy).reduce((a, r) => a + r.min, 0), wantSum)
  const ops1 = shopOps('Цех 1')
  assert.ok(d.defects.every((r) => ops1.has(r.op) || !allOps.has(r.op)), 'чужие операции в браке')
  assert.equal(d.settings, null)
})
await test('начальник цеха 2 не видит записей цеха 1', async () => {
  const d = (await clients.chief2.get('/api/data')).json
  assert.ok(d.downtime.every((r) => r.shop === 'Цех 2'))
  const ops1only = [...shopOps('Цех 1')].filter((o) => !shopOps('Цех 2').has(o))
  assert.ok(d.defects.every((r) => !ops1only.includes(r.op)))
})
await test('оператор ОТК видит только брак, простоев и ставок не получает', async () => {
  const d = (await clients.otk.get('/api/data')).json
  assert.equal(d.downtime.length, 0); assert.ok(d.defects.length >= 94); assert.equal(d.settings, null)
})

// ------------------------------------------------------------------ записи: владение и проверка
let chiefRec, otkRec
await test('начальник цеха пишет только в свой цех, что бы ни прислал клиент', async () => {
  const r = await clients.chief1.post('/api/records/downtime', { record: { ...okDowntime, shop: 'Цех 2' } })
  assert.equal(r.status, 201); assert.equal(r.json.record.shop, 'Цех 1'); chiefRec = r.json.record
})
await test('свои записи можно менять и удалять, чужие и исходные — нет', async () => {
  const c1 = clients.chief1
  assert.equal((await c1.put('/api/records/downtime/' + chiefRec.dbId, { record: { ...okDowntime, min: 45 } })).json.record.min, 45)
  const seeded = (await c1.get('/api/data')).json.downtime.find((r) => !r.createdBy)
  assert.equal((await c1.put('/api/records/downtime/' + seeded.dbId, { record: okDowntime })).status, 403)
  assert.equal((await c1.del('/api/records/downtime/' + seeded.dbId)).status, 403)
  // запись начальника цеха 2 для цеха 1 не существует (вне его данных)
  const other = await clients.chief2.post('/api/records/downtime', { record: { ...okDowntime, shop: 'Цех 2', machine: 'П-1', op: 'Присадка' } })
  assert.equal((await c1.put('/api/records/downtime/' + other.json.record.dbId, { record: okDowntime })).status, 404)
  assert.equal((await c1.del('/api/records/downtime/' + chiefRec.dbId)).status, 200)
})
await test('оператор ОТК правит только свои записи; администратор — любые', async () => {
  const r = await clients.otk.post('/api/records/defects', { record: okDefect }); otkRec = r.json.record
  assert.equal((await clients.otk.put('/api/records/defects/' + otkRec.dbId, { record: { ...okDefect, qty: 5 } })).status, 200)
  const seeded = (await clients.otk.get('/api/data')).json.defects.find((x) => !x.createdBy)
  assert.equal((await clients.otk.del('/api/records/defects/' + seeded.dbId)).status, 403)
  assert.equal((await clients.admin.put('/api/records/defects/' + seeded.dbId, { record: { ...okDefect, qty: 1 } })).status, 200)
})
await test('плохие значения отклоняются (422), в базу не попадают', async () => {
  const bad = [
    { ...okDefect, date: '2026-02-31' }, { ...okDefect, date: '10.06.2026' }, { ...okDefect, qty: -1 }, { ...okDefect, qty: 1.5 },
    { ...okDefect, shift: 3 }, { ...okDefect, type: '' }, { ...okDefect, type: 'x'.repeat(500) }, { ...okDefect, order: 'З-1\u0000' }, { ...okDefect, qty: '1; DROP TABLE defects' },
  ]
  const before = s.db.prepare('SELECT COUNT(*) AS n FROM defects').get().n
  for (const rec of bad) assert.equal((await clients.otk.post('/api/records/defects', { record: rec })).status, 422, JSON.stringify(rec))
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM defects').get().n, before)
  assert.equal((await clients.chief1.post('/api/records/downtime', { record: { ...okDowntime, min: 5000 } })).status, 422)
})
await test('SQL-инъекция в тексте записи сохраняется как обычный текст и ничего не ломает', async () => {
  const r = await clients.otk.post('/api/records/defects', { record: { ...okDefect, order: "З-1'); DROP TABLE users;--" } })
  assert.equal(r.status, 201)
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM users').get().n >= 5, true)
})

// ------------------------------------------------------------------ загрузка и сброс данных
await test('загрузка: некорректный файл отклоняется целиком, корректный — заменяет журнал', async () => {
  const d = clients.director
  const before = s.db.prepare('SELECT COUNT(*) AS n FROM downtime').get().n
  const bad = await d.post('/api/import', { kind: 'downtime', mode: 'replace', records: [okDowntime, { ...okDowntime, date: 'вчера' }] })
  assert.equal(bad.status, 422); assert.ok(bad.json.errors.length > 0)
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM downtime').get().n, before)
  const good = await d.post('/api/import', { kind: 'downtime', mode: 'replace', records: [okDowntime, { ...okDowntime, min: 10 }] })
  assert.equal(good.status, 200); assert.equal(good.json.total, 2)
})
await test('сброс к исходным данным — только у администратора', async () => {
  assert.equal((await clients.director.post('/api/admin/reset-data')).status, 403)
  const r = await clients.admin.post('/api/admin/reset-data')
  assert.equal(r.status, 200); assert.equal(r.json.downtime, 120); assert.equal(r.json.defects, 94)
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM downtime').get().n, 120)
})

// ------------------------------------------------------------------ администрирование пользователей
let newUser
await test('создание пользователя: слабый пароль отклоняется, без пароля выдаётся временный', async () => {
  const a = clients.admin
  assert.equal((await a.post('/api/users', { login: 'ivan', name: 'Иван', role: 'otk', password: '123' })).status, 422)
  assert.equal((await a.post('/api/users', { login: 'ivan', name: 'Иван', role: 'otk', password: 'password' })).status, 422)
  assert.equal((await a.post('/api/users', { login: 'bad login!', name: 'X', role: 'otk' })).status, 422)
  assert.equal((await a.post('/api/users', { login: 'x1', name: 'X', role: 'chief' })).status, 422) // цех обязателен
  const r = await a.post('/api/users', { login: 'ivan', name: 'Иван', role: 'otk' })
  assert.equal(r.status, 201); assert.match(r.json.tempPassword, /^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/); newUser = r.json
  assert.equal((await a.post('/api/users', { login: 'IVAN', name: 'Иван', role: 'otk' })).status, 409) // логин без учёта регистра
})
await test('временный пароль: до смены доступна только смена пароля, затем — полный доступ', async () => {
  const c = new Client()
  await c.login('ivan', newUser.tempPassword)
  assert.equal((await c.get('/api/data')).status, 403)
  assert.equal((await c.get('/api/data')).json.code, 'must_change')
  assert.equal((await c.post('/api/me/password', { current: 'wrong', next: 'Nov-Parol-77' })).status, 403)
  assert.equal((await c.post('/api/me/password', { current: newUser.tempPassword, next: 'short' })).status, 422)
  assert.equal((await c.post('/api/me/password', { current: newUser.tempPassword, next: 'password' })).status, 422)
  assert.equal((await c.post('/api/me/password', { current: newUser.tempPassword, next: 'Nov-Parol-77' })).status, 200)
  assert.equal((await c.get('/api/data')).status, 200)
})
await test('смена пароля закрывает остальные сессии этого пользователя', async () => {
  const a = new Client(), b = new Client()
  await a.login('ivan', 'Nov-Parol-77'); await b.login('ivan', 'Nov-Parol-77')
  assert.equal((await a.post('/api/me/password', { current: 'Nov-Parol-77', next: 'Eshche-Odin-88' })).status, 200)
  assert.equal((await a.get('/api/me')).status, 200)
  assert.equal((await b.get('/api/me')).status, 401)
})
await test('отключённая запись не входит, её сессии закрываются; роль и цех меняются с проверкой', async () => {
  const a = clients.admin
  const c = new Client(); await c.login('ivan', 'Eshche-Odin-88')
  assert.equal((await a.put('/api/users/' + newUser.user.id, { active: false })).status, 200)
  assert.equal((await c.get('/api/me')).status, 401)
  assert.equal((await new Client().post('/api/login', { login: 'ivan', password: 'Eshche-Odin-88' })).status, 401)
  assert.equal((await a.put('/api/users/' + newUser.user.id, { active: true, role: 'chief' })).status, 422) // цех обязателен
  assert.equal((await a.put('/api/users/' + newUser.user.id, { active: true, role: 'chief', shop: 'Цех 2' })).json.user.role, 'chief')
})
await test('сброс пароля администратором: новый временный пароль, старый не работает', async () => {
  const r = await clients.admin.post('/api/users/' + newUser.user.id + '/reset-password')
  assert.equal(r.status, 200)
  assert.equal((await new Client().post('/api/login', { login: 'ivan', password: 'Eshche-Odin-88' })).status, 401)
  assert.equal((await new Client().post('/api/login', { login: 'ivan', password: r.json.tempPassword })).status, 200)
})
await test('нельзя отключить себя и последнего администратора; обычным ролям управление недоступно', async () => {
  const a = clients.admin
  const me = (await a.get('/api/me')).json.user
  assert.equal((await a.put('/api/users/' + me.id, { active: false })).status, 422)
  assert.equal((await a.put('/api/users/' + me.id, { role: 'director' })).status, 422)
  const second = (await a.post('/api/users', { login: 'admin2', name: 'Второй', role: 'admin', password: 'Vtoroj-Admin-9' })).json.user
  const c2 = new Client(); await c2.login('admin2', 'Vtoroj-Admin-9')
  assert.equal((await c2.put('/api/users/' + me.id, { active: false })).status, 200) // администраторов двое — можно
  assert.equal((await c2.put('/api/users/' + second.id, { active: false })).status, 422) // а теперь он последний
  assert.equal((await clients.director.put('/api/users/' + me.id, { active: true })).status, 403)
  await c2.put('/api/users/' + me.id, { active: true })
  clients.admin = await as('admin', PW.admin) // отключение закрыло сессии администратора — входим заново
})
await test('журнал действий фиксирует входы, ошибки, изменения записей и пользователей', async () => {
  const actions = new Set(s.db.prepare('SELECT action FROM audit').all().map((r) => r.action))
  for (const a of ['login', 'login_failed', 'login_failed_unknown', 'login_locked', 'logout', 'record_create', 'record_update', 'record_delete', 'import', 'reset_data', 'user_create', 'user_update', 'password_reset', 'password_change', 'settings_update']) {
    assert.ok(actions.has(a), 'нет записи: ' + a)
  }
  const list = (await clients.admin.get('/api/audit?limit=5&q=login')).json
  assert.ok(list.rows.length > 0 && list.total >= list.rows.length)
  assert.equal((await clients.admin.get("/api/audit?q=%27%20OR%201%3D1--")).status, 200) // поисковая строка — параметр, а не часть SQL
})
await test('пароли и хэши не попадают ни в один ответ API', async () => {
  const dumps = []
  for (const u of ['/api/users', '/api/audit?limit=200', '/api/me', '/api/data']) dumps.push(JSON.stringify((await clients.admin.get(u)).json))
  const all = dumps.join('')
  assert.doesNotMatch(all, /scrypt\$/); assert.doesNotMatch(all, /pw_hash/)
})

await s.close()

// ------------------------------------------------------------------ итог
const failed = results.filter((r) => !r.ok)
for (const r of results) console.log((r.ok ? 'ok   ' : 'FAIL ') + r.name + (r.ok ? '' : '\n       ' + String(r.err?.message ?? r.err).split('\n').slice(0, 6).join('\n       ')))
console.log(`\nТестов: ${results.length}, прошло: ${results.length - failed.length}, упало: ${failed.length}`)
process.exit(failed.length ? 1 : 0)
