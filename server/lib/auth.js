// Аутентификация: пароли, сессии, защита входа от подбора.
//  · Пароли — scrypt с индивидуальной солью (формат scrypt$N$r$p$соль$хэш), сравнение за постоянное время.
//  · Сессия — случайный токен (32 байта) в cookie; в базе хранится только его SHA-256, поэтому утечка базы не даёт входа.
//  · Cookie: HttpOnly (недоступна скриптам), SameSite=Strict (не отправляется с чужих сайтов), Secure — при HTTPS.
//  · Вход: 5 неудачных попыток подряд блокируют учётную запись на 15 минут; отдельный лимит на IP.
import crypto from 'node:crypto'
import { audit, nowIso } from './db.js'

const N = 16384, R = 8, P = 1, KEYLEN = 64
export const SESSION_ABS_MS = 12 * 3600 * 1000  // сессия живёт не дольше 12 часов
export const SESSION_IDLE_MS = 2 * 3600 * 1000  // и закрывается после 2 часов без действий
export const MAX_FAILS = 5
export const LOCK_MS = 15 * 60 * 1000
const IP_LIMIT = 30                              // неудачных входов с одного IP за окно
const IP_WINDOW_MS = 15 * 60 * 1000

const scrypt = (pw, salt, n = N, r = R, p = P) =>
  new Promise((resolve, reject) => crypto.scrypt(pw, salt, KEYLEN, { N: n, r, p, maxmem: 128 * n * r * 2 }, (e, k) => (e ? reject(e) : resolve(k))))

export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16)
  const key = await scrypt(pw, salt)
  return ['scrypt', N, R, P, salt.toString('hex'), key.toString('hex')].join('$')
}

export async function verifyPassword(pw, stored) {
  try {
    const [alg, n, r, p, saltHex, keyHex] = String(stored).split('$')
    if (alg !== 'scrypt') return false
    const key = await scrypt(pw, Buffer.from(saltHex, 'hex'), +n, +r, +p)
    const want = Buffer.from(keyHex, 'hex')
    return key.length === want.length && crypto.timingSafeEqual(key, want)
  } catch { return false }
}

// Хэш-«пустышка»: при несуществующем логине всё равно считаем scrypt, чтобы по времени ответа нельзя было угадать, есть ли такой логин
let dummy
export async function burnTime(pw) {
  dummy ??= await hashPassword('dummy-password-for-timing')
  await verifyPassword(pw, dummy)
}

const COMMON = new Set(['password', 'password1', '12345678', '123456789', 'qwertyui', 'qwerty123', '11111111', 'admin123', 'admin1234', 'йцукенгш', 'пароль12'])
/** Требования к паролю: не короче 8 символов, не совпадает с логином, не из списка самых частых */
export function passwordProblem(pw, login = '') {
  if (typeof pw !== 'string') return 'Пароль должен быть строкой.'
  if (pw.length < 8) return 'Пароль должен быть не короче 8 символов.'
  if (pw.length > 200) return 'Пароль слишком длинный.'
  if (login && pw.toLowerCase() === String(login).toLowerCase()) return 'Пароль не должен совпадать с логином.'
  if (COMMON.has(pw.toLowerCase())) return 'Слишком простой пароль: выберите менее распространённый.'
  return null
}

/** Случайный временный пароль (без похожих символов) */
export function tempPassword() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  const bytes = crypto.randomBytes(12)
  let s = ''
  for (const b of bytes) s += alphabet[b % alphabet.length]
  return s.slice(0, 4) + '-' + s.slice(4, 8) + '-' + s.slice(8, 12)
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex')

export function createSession(db, userId, { ip, ua }) {
  const token = crypto.randomBytes(32).toString('base64url')
  const t = Date.now()
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, last_seen, expires_at, ip, ua) VALUES (?,?,?,?,?,?,?)')
    .run(sha256(token), userId, t, t, t + SESSION_ABS_MS, ip ?? null, String(ua ?? '').slice(0, 200))
  return token
}

/** Возвращает пользователя по токену или null; продлевает «простой» и удаляет просроченные сессии. */
export function sessionUser(db, token) {
  if (!token || typeof token !== 'string' || token.length > 100) return null
  const h = sha256(token)
  const s = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(h)
  if (!s) return null
  const t = Date.now()
  if (s.expires_at <= t || t - s.last_seen > SESSION_IDLE_MS) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(h)
    return null
  }
  const u = db.prepare('SELECT id, login, name, role, shop, active, must_change, demo FROM users WHERE id = ?').get(s.user_id)
  if (!u || !u.active) { db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(h); return null }
  if (t - s.last_seen > 60_000) db.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?').run(t, h)
  return { ...u, tokenHash: h }
}

export const destroySession = (db, tokenHash) => db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash)
export const destroyUserSessions = (db, userId, exceptHash = null) =>
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash IS NOT ?').run(userId, exceptHash)

// Ограничение по IP — в памяти (сбрасывается при перезапуске, для защиты от подбора этого достаточно)
const ipFails = new Map()
const ghostFails = new Map() // неудачи для логинов, которых нет: считаем так же, чтобы блокировка не выдавала существование записи
function ipState(ip) {
  const t = Date.now()
  let s = ipFails.get(ip)
  if (!s || t - s.start > IP_WINDOW_MS) { s = { start: t, n: 0 }; ipFails.set(ip, s) }
  return s
}
export const ipBlocked = (ip) => ipState(ip).n >= IP_LIMIT

/** Пытается войти. Возвращает { ok, user, retryAfter, reason }. Сообщение об ошибке всегда одинаковое. */
export async function attemptLogin(db, { login, password, ip }) {
  if (ipBlocked(ip)) return { ok: false, retryAfter: 900, reason: 'ip_limit' }
  const u = typeof login === 'string' && login.length <= 64 ? db.prepare('SELECT * FROM users WHERE login = ?').get(login.trim()) : null
  const t = Date.now()
  const ghostKey = String(login ?? '').trim().toLowerCase().slice(0, 64)
  if (!u) {
    const g = ghostFails.get(ghostKey)
    if (g && g.lockedUntil > t) { await burnTime(String(password ?? '')); return { ok: false, retryAfter: Math.ceil((g.lockedUntil - t) / 1000), reason: 'locked' } }
  }
  if (u && u.locked_until > t) {
    await burnTime(String(password ?? ''))
    return { ok: false, retryAfter: Math.ceil((u.locked_until - t) / 1000), reason: 'locked' }
  }
  // scrypt считаем всегда — и для несуществующего логина, и для отключённой записи, чтобы по времени ответа их нельзя было отличить
  let good = false
  if (u) good = typeof password === 'string' && (await verifyPassword(password, u.pw_hash)) && !!u.active
  else await burnTime(String(password ?? ''))
  if (!good) {
    ipState(ip).n++
    if (!u) {
      if (ghostFails.size > 5000) ghostFails.clear()
      const g = ghostFails.get(ghostKey) ?? { n: 0, lockedUntil: 0 }
      g.n++
      if (g.n >= MAX_FAILS) { g.n = 0; g.lockedUntil = t + LOCK_MS }
      ghostFails.set(ghostKey, g)
    }
    if (u) {
      const fails = u.failed + 1
      const lock = fails >= MAX_FAILS ? t + LOCK_MS : 0
      db.prepare('UPDATE users SET failed = ?, locked_until = ? WHERE id = ?').run(lock ? 0 : fails, lock, u.id)
      audit(db, { user: u, action: lock ? 'login_locked' : 'login_failed', ip })
    } else {
      audit(db, { login: String(login ?? '').slice(0, 64), action: 'login_failed_unknown', ip })
    }
    return { ok: false, reason: 'bad_credentials' }
  }
  db.prepare('UPDATE users SET failed = 0, locked_until = 0, last_login = ? WHERE id = ?').run(nowIso(), u.id)
  audit(db, { user: u, action: 'login', ip })
  return { ok: true, user: u }
}

export function cleanupSessions(db) {
  const t = Date.now()
  db.prepare('DELETE FROM sessions WHERE expires_at <= ? OR last_seen < ?').run(t, t - SESSION_IDLE_MS)
}
