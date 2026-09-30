// HTTP-обработчик: маршруты API, проверка прав на КАЖДОМ запросе, отбор данных по роли.
// Интерфейс только показывает то, что разрешил сервер: даже подделав запрос, пользователь получит 403 или пустой ответ.
import { attemptLogin, createSession, destroySession, destroyUserSessions, hashPassword, passwordProblem, sessionUser, tempPassword, verifyPassword, SESSION_ABS_MS } from './auth.js'
import { audit, getSettings, loadSeed, nowIso, setSettings, tx } from './db.js'
import { ROLES, canCreate, canModify, publicPerms, scopeRows } from './roles.js'
import { DEMO_USERS } from './seed.js'
import { validateUser, validators } from './validate.js'

export class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra }
}
const fail = (status, message, extra) => { throw new HttpError(status, message, extra) }

const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
}

const KINDS = ['downtime', 'defects']
const mapDowntime = (r) => ({ id: r.ext_id ?? String(r.id), dbId: r.id, date: r.date, machine: r.machine, machineName: r.machine_name, op: r.op, shop: r.shop, shift: r.shift, reason: r.reason, planned: !!r.planned, min: r.min, createdBy: r.created_by })
const mapDefect = (r) => ({ id: r.ext_id ?? String(r.id), dbId: r.id, date: r.date, type: r.type, op: r.op, qty: r.qty, order: r.order_no, shift: r.shift, createdBy: r.created_by })
const publicUser = (u) => ({ id: u.id, login: u.login, name: u.name, role: u.role, shop: u.shop, mustChange: !!u.must_change, demo: !!u.demo })

/** Данные, которые пользователь вправе видеть. Начальник цеха — только свой цех, оператор ОТК — только брак. */
function scopedData(db, user) {
  const dt = db.prepare('SELECT * FROM downtime ORDER BY date, id').all()
  const df = db.prepare('SELECT * FROM defects ORDER BY date, id').all()
  return scopeRows(user, dt, df)
}

function parseCookies(header) {
  const out = {}
  for (const part of String(header ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0) { try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()) } catch { /* битое значение — считаем, что cookie нет */ } }
  }
  return out
}

export function createApp({ db, config }) {
  const { demo = false, secure = false, trustProxy = false, panelHtml = '', csp = '', maxBody = 10 * 1024 * 1024 } = config

  const clientIp = (req) => (trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() : '') || req.socket.remoteAddress || 'unknown'
  const isHttps = (req) => secure || (trustProxy && req.headers['x-forwarded-proto'] === 'https')

  // Общий лимит запросов с одного адреса — защита от перебора и перегрузки
  const hits = new Map()
  const tooMany = (ip) => {
    const t = Date.now()
    let h = hits.get(ip)
    if (!h || t - h.start > 60_000) {
      if (hits.size > 5000) for (const [k, v] of hits) if (t - v.start > 60_000) hits.delete(k) // чистим устаревшее
      h = { start: t, n: 0 }; hits.set(ip, h)
    }
    return ++h.n > 600
  }

  function send(res, status, body, extra = {}) {
    const s = JSON.stringify(body)
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(s), 'Cache-Control': 'no-store', ...SEC_HEADERS, ...extra })
    res.end(s)
  }

  async function readJson(req) {
    const len = Number(req.headers['content-length'] ?? 0)
    if (len > maxBody) fail(413, 'Слишком большой запрос.')
    const type = String(req.headers['content-type'] ?? '')
    if (!type.toLowerCase().startsWith('application/json')) fail(415, 'Ожидается application/json.')
    const chunks = []
    let size = 0
    for await (const c of req) {
      size += c.length
      if (size > maxBody) fail(413, 'Слишком большой запрос.')
      chunks.push(c)
    }
    try {
      const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
      if (v === null || typeof v !== 'object') fail(400, 'Ожидается JSON-объект.')
      return v
    } catch (e) {
      if (e instanceof HttpError) throw e
      return fail(400, 'Некорректный JSON.')
    }
  }

  const cookieHeader = (token, req, maxAgeSec) =>
    `sid=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${isHttps(req) ? '; Secure' : ''}`

  // ---------------------------------------------------------------- маршруты
  async function route(req, res, url, ctx) {
    const { method } = req
    const p = url.pathname
    const ip = ctx.ip

    // --- без входа
    if (method === 'GET' && p === '/api/meta') {
      const demoUsers = demo
        ? DEMO_USERS.filter((d) => db.prepare('SELECT demo FROM users WHERE login = ?').get(d.login)?.demo).map((d) => ({ login: d.login, role: ROLES[d.role].label, password: d.password }))
        : []
      return send(res, 200, { server: true, demo, demoUsers })
    }
    if (method === 'POST' && p === '/api/login') {
      const body = await readJson(req)
      const r = await attemptLogin(db, { login: body.login, password: body.password, ip })
      if (!r.ok) {
        const wait = r.retryAfter ? { 'Retry-After': String(r.retryAfter) } : {}
        if (r.reason === 'locked' || r.reason === 'ip_limit') return send(res, 429, { error: 'Слишком много неудачных попыток. Повторите позже.', retryAfter: r.retryAfter }, wait)
        return send(res, 401, { error: 'Неверный логин или пароль.' })
      }
      if (ctx.user) destroySession(db, ctx.user.tokenHash) // старая сессия закрывается: новый вход — новый токен
      const token = createSession(db, r.user.id, { ip, ua: req.headers['user-agent'] })
      return send(res, 200, { user: publicUser(r.user), perms: publicPerms(r.user.role) }, { 'Set-Cookie': cookieHeader(token, req, Math.floor(SESSION_ABS_MS / 1000)) })
    }

    // --- дальше нужен вход
    const user = ctx.user
    if (!user) return fail(401, 'Требуется вход.', { code: 'auth' })
    const perms = ROLES[user.role]

    if (method === 'POST' && p === '/api/logout') {
      destroySession(db, user.tokenHash)
      audit(db, { user, action: 'logout', ip })
      return send(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader('', req, 0) })
    }
    if (method === 'GET' && p === '/api/me') return send(res, 200, { user: publicUser(user), perms: publicPerms(user.role) })

    if (method === 'POST' && p === '/api/me/password') {
      const body = await readJson(req)
      const row = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)
      if (!(await verifyPassword(String(body.current ?? ''), row.pw_hash))) return fail(403, 'Текущий пароль указан неверно.')
      const problem = passwordProblem(body.next, user.login)
      if (problem) return fail(422, problem)
      if (body.next === body.current) return fail(422, 'Новый пароль должен отличаться от текущего.')
      db.prepare('UPDATE users SET pw_hash = ?, must_change = 0, demo = 0 WHERE id = ?').run(await hashPassword(body.next), user.id)
      destroyUserSessions(db, user.id, user.tokenHash) // остальные устройства выходят
      audit(db, { user, action: 'password_change', ip })
      return send(res, 200, { ok: true })
    }

    // Пока пароль не сменён (временный), ничего, кроме смены пароля и выхода, недоступно
    if (user.must_change) return fail(403, 'Нужно сменить временный пароль.', { code: 'must_change' })

    if (method === 'GET' && p === '/api/data') {
      const { dt, df } = scopedData(db, user)
      return send(res, 200, {
        downtime: dt.map(mapDowntime), defects: df.map(mapDefect),
        settings: perms.money ? getSettings(db) : null, // ставки денег получают только те, кому положено
      })
    }

    if (method === 'PUT' && p === '/api/settings') {
      if (!perms.settings) return fail(403, 'Недостаточно прав.')
      const b = await readJson(req)
      const s = {}
      const num = (k, lo, hi) => { if (k in b) { const n = Number(b[k]); if (!Number.isFinite(n) || n < lo || n > hi) fail(422, `Параметр ${k}: число от ${lo} до ${hi}.`); s[k] = n } }
      num('shiftHours', 1, 24); num('hourCost', 0, 1e7); num('pieceCost', 0, 1e7)
      setSettings(db, s)
      audit(db, { user, action: 'settings_update', detail: JSON.stringify(s), ip })
      return send(res, 200, { settings: getSettings(db) })
    }

    // --- загрузка журнала целиком
    if (method === 'POST' && p === '/api/import') {
      if (!perms.upload) return fail(403, 'Недостаточно прав.')
      const b = await readJson(req)
      if (!KINDS.includes(b.kind)) return fail(422, 'Неизвестный журнал.')
      if (!['replace', 'append'].includes(b.mode)) return fail(422, 'Режим: replace или append.')
      if (!Array.isArray(b.records) || b.records.length > 50_000) return fail(422, 'Записей: массив до 50 000.')
      const clean = []
      const errors = []
      b.records.forEach((rec, i) => {
        const r = validators[b.kind](rec)
        if (r.error) { if (errors.length < 10) errors.push(`запись ${i + 1}: ${r.error}`); return }
        clean.push({ ...r.value, ext: typeof rec.id === 'string' || typeof rec.id === 'number' ? String(rec.id).slice(0, 30) : null })
      })
      if (errors.length || (b.records.length && !clean.length)) return fail(422, 'В файле есть некорректные записи.', { errors })
      const ts = nowIso()
      tx(db, () => {
        if (b.mode === 'replace') db.prepare(`DELETE FROM ${b.kind}`).run()
        if (b.kind === 'downtime') {
          const st = db.prepare('INSERT INTO downtime (ext_id, date, machine, machine_name, op, shop, shift, reason, planned, min, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,NULL,?)')
          for (const r of clean) st.run(r.ext, r.date, r.machine, r.machineName, r.op, r.shop, r.shift, r.reason, r.planned ? 1 : 0, r.min, ts)
        } else {
          const st = db.prepare('INSERT INTO defects (ext_id, date, type, op, qty, order_no, shift, created_by, created_at) VALUES (?,?,?,?,?,?,?,NULL,?)')
          for (const r of clean) st.run(r.ext, r.date, r.type, r.op, r.qty, r.order, r.shift, ts)
        }
      })
      audit(db, { user, action: 'import', entity: b.kind, detail: `${b.mode}: ${clean.length} записей`, ip })
      return send(res, 200, { imported: clean.length, total: db.prepare(`SELECT COUNT(*) AS n FROM ${b.kind}`).get().n })
    }

    // --- отдельные записи журналов
    let m = /^\/api\/records\/(downtime|defects)(?:\/(\d+))?$/.exec(p)
    if (m) {
      const kind = m[1]
      const id = m[2] ? Number(m[2]) : null
      const map = kind === 'downtime' ? mapDowntime : mapDefect

      const write = (rec, existingId) => {
        const r = validators[kind](rec)
        if (r.error) fail(422, r.error)
        const v = r.value
        if (kind === 'downtime' && user.role === 'chief') v.shop = user.shop // начальник цеха пишет только в свой цех, что бы ни прислал клиент
        const ts = nowIso()
        if (existingId == null) {
          if (kind === 'downtime') {
            const info = db.prepare('INSERT INTO downtime (date, machine, machine_name, op, shop, shift, reason, planned, min, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
              .run(v.date, v.machine, v.machineName, v.op, v.shop, v.shift, v.reason, v.planned ? 1 : 0, v.min, user.id, ts)
            return Number(info.lastInsertRowid)
          }
          const info = db.prepare('INSERT INTO defects (date, type, op, qty, order_no, shift, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)')
            .run(v.date, v.type, v.op, v.qty, v.order, v.shift, user.id, ts)
          return Number(info.lastInsertRowid)
        }
        if (kind === 'downtime') {
          db.prepare('UPDATE downtime SET date=?, machine=?, machine_name=?, op=?, shop=?, shift=?, reason=?, planned=?, min=?, updated_at=? WHERE id=?')
            .run(v.date, v.machine, v.machineName, v.op, v.shop, v.shift, v.reason, v.planned ? 1 : 0, v.min, ts, existingId)
        } else {
          db.prepare('UPDATE defects SET date=?, type=?, op=?, qty=?, order_no=?, shift=?, updated_at=? WHERE id=?')
            .run(v.date, v.type, v.op, v.qty, v.order, v.shift, ts, existingId)
        }
        return existingId
      }

      if (method === 'POST' && id == null) {
        if (!canCreate(user, kind)) return fail(403, 'Недостаточно прав.')
        const b = await readJson(req)
        const newId = write(b.record ?? b, null)
        audit(db, { user, action: 'record_create', entity: `${kind}#${newId}`, ip })
        return send(res, 201, { record: map(db.prepare(`SELECT * FROM ${kind} WHERE id = ?`).get(newId)) })
      }
      if (id != null) {
        const row = db.prepare(`SELECT * FROM ${kind} WHERE id = ?`).get(id)
        if (!row) return fail(404, 'Запись не найдена.')
        // Чужие записи для роли «свои» — как будто их нет (не раскрываем, что запись существует)
        const visible = scopedData(db, user)
        const inScope = (kind === 'downtime' ? visible.dt : visible.df).some((r) => r.id === id)
        if (!inScope) return fail(404, 'Запись не найдена.')
        if (!canModify(user, kind, row)) return fail(403, 'Недостаточно прав для изменения этой записи.')
        if (method === 'PUT') {
          const b = await readJson(req)
          write(b.record ?? b, id)
          audit(db, { user, action: 'record_update', entity: `${kind}#${id}`, ip })
          return send(res, 200, { record: map(db.prepare(`SELECT * FROM ${kind} WHERE id = ?`).get(id)) })
        }
        if (method === 'DELETE') {
          db.prepare(`DELETE FROM ${kind} WHERE id = ?`).run(id)
          audit(db, { user, action: 'record_delete', entity: `${kind}#${id}`, detail: `${row.date}`, ip })
          return send(res, 200, { ok: true })
        }
      }
      return fail(405, 'Метод не поддерживается.')
    }

    // --- администрирование
    if (p.startsWith('/api/users') || p.startsWith('/api/audit') || p.startsWith('/api/admin')) {
      if (!perms.users) return fail(403, 'Недостаточно прав.')
    }

    if (method === 'GET' && p === '/api/users') {
      const rows = db.prepare('SELECT id, login, name, role, shop, active, must_change, demo, created_at, last_login, locked_until FROM users ORDER BY id').all()
      return send(res, 200, { users: rows.map((u) => ({ ...publicUser(u), active: !!u.active, createdAt: u.created_at, lastLogin: u.last_login, locked: u.locked_until > Date.now() })) })
    }

    if (method === 'POST' && p === '/api/users') {
      const b = await readJson(req)
      const v = validateUser(b)
      if (v.error) return fail(422, v.error)
      if (db.prepare('SELECT 1 FROM users WHERE login = ?').get(v.value.login)) return fail(409, 'Такой логин уже есть.')
      let pw = typeof b.password === 'string' && b.password ? b.password : null
      let temp = null
      if (pw) { const prob = passwordProblem(pw, v.value.login); if (prob) return fail(422, prob) } else pw = temp = tempPassword()
      const info = db.prepare('INSERT INTO users (login, name, role, shop, pw_hash, active, must_change, demo, created_at) VALUES (?,?,?,?,?,1,?,0,?)')
        .run(v.value.login, v.value.name, v.value.role, v.value.shop, await hashPassword(pw), temp ? 1 : 0, nowIso())
      audit(db, { user, action: 'user_create', entity: `user#${info.lastInsertRowid}`, detail: `${v.value.login} (${v.value.role})`, ip })
      return send(res, 201, { user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid)), tempPassword: temp })
    }

    m = /^\/api\/users\/(\d+)(\/reset-password)?$/.exec(p)
    if (m) {
      const id = Number(m[1])
      const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id)
      if (!target) return fail(404, 'Пользователь не найден.')

      if (method === 'POST' && m[2]) {
        const temp = tempPassword()
        db.prepare('UPDATE users SET pw_hash = ?, must_change = 1, failed = 0, locked_until = 0 WHERE id = ?').run(await hashPassword(temp), id)
        destroyUserSessions(db, id)
        audit(db, { user, action: 'password_reset', entity: `user#${id}`, detail: target.login, ip })
        return send(res, 200, { tempPassword: temp })
      }

      if (method === 'PUT') {
        const b = await readJson(req)
        const v = validateUser({ role: target.role, ...b }, { partial: true })
        if (v.error) return fail(422, v.error)
        const next = { ...v.value }
        if (id === user.id && (('role' in next && next.role !== target.role) || ('active' in next && !next.active))) return fail(422, 'Нельзя менять собственную роль и отключать себя.')
        // всегда должен оставаться хотя бы один действующий администратор
        const losesAdmin = target.role === 'admin' && target.active && (('role' in next && next.role !== 'admin') || ('active' in next && !next.active))
        if (losesAdmin && db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1").get().n <= 1) return fail(422, 'Нельзя отключить или понизить последнего администратора.')
        const role = next.role ?? target.role
        const shop = 'shop' in next ? next.shop : (role === 'chief' ? target.shop : null)
        if (role === 'chief' && !shop) return fail(422, 'Для начальника цеха нужно указать цех.')
        db.prepare('UPDATE users SET name = ?, role = ?, shop = ?, active = ? WHERE id = ?').run(next.name ?? target.name, role, role === 'chief' ? shop : null, 'active' in next ? (next.active ? 1 : 0) : target.active, id)
        if (('active' in next && !next.active) || role !== target.role) destroyUserSessions(db, id)
        audit(db, { user, action: 'user_update', entity: `user#${id}`, detail: `${target.login}: ${JSON.stringify(next)}`, ip })
        return send(res, 200, { user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)) })
      }
      return fail(405, 'Метод не поддерживается.')
    }

    if (method === 'GET' && p === '/api/audit') {
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50))
      const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0)
      const q = (url.searchParams.get('q') ?? '').slice(0, 60)
      const like = `%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`
      const where = q ? "WHERE login LIKE ? ESCAPE '\\' OR action LIKE ? ESCAPE '\\' OR entity LIKE ? ESCAPE '\\' OR detail LIKE ? ESCAPE '\\'" : ''
      const args = q ? [like, like, like, like] : []
      const rows = db.prepare(`SELECT id, ts, login, action, entity, detail, ip FROM audit ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset)
      const total = db.prepare(`SELECT COUNT(*) AS n FROM audit ${where}`).get(...args).n
      return send(res, 200, { rows, total })
    }

    if (method === 'POST' && p === '/api/admin/reset-data') {
      const counts = loadSeed(db, { replace: true })
      audit(db, { user, action: 'reset_data', detail: `исходные журналы: ${counts.downtime} + ${counts.defects}`, ip })
      return send(res, 200, { ok: true, ...counts })
    }

    return fail(404, 'Не найдено.')
  }

  // ---------------------------------------------------------------- вход в обработчик
  return async function handle(req, res) {
    try {
      const url = new URL(req.url ?? '/', 'http://local')
      const ip = clientIp(req)
      if (tooMany(ip)) return send(res, 429, { error: 'Слишком много запросов.' }, { 'Retry-After': '60' })

      // Страница панели
      if (url.pathname === '/' || url.pathname === '/index.html') {
        if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Метод не поддерживается.' })
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'Content-Security-Policy': csp, ...SEC_HEADERS })
        return res.end(req.method === 'HEAD' ? undefined : panelHtml)
      }

      if (!url.pathname.startsWith('/api/')) return send(res, 404, { error: 'Не найдено.' })

      // Защита от подделки запросов с чужих сайтов: cookie с SameSite=Strict + обязательный служебный заголовок + проверка Origin
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        if (req.headers['x-requested-with'] !== 'profil') return fail(403, 'Запрос отклонён.')
        const origin = req.headers.origin
        if (origin) {
          let host = null
          try { host = new URL(origin).host } catch { /* «null» и мусор */ }
          if (host !== req.headers.host) return fail(403, 'Запрос отклонён.')
        }
      }

      const token = parseCookies(req.headers.cookie).sid
      const user = sessionUser(db, token)
      return await route(req, res, url, { ip, user })
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message, ...e.extra })
      console.error('Ошибка обработки запроса:', e)
      return send(res, 500, { error: 'Внутренняя ошибка сервера.' })
    }
  }
}
