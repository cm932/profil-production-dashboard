// «Запечатанный» HTML: один файл с панелью, в котором данные зашифрованы. Ключа расшифровки в файле нет.
//
// Как устроено:
//  · для каждого среза данных («всё», «Цех 1», «Цех 2», «только брак») — свой случайный ключ AES-256-GCM (DEK);
//    срез шифруется своим ключом;
//  · для каждого пользователя из пароля выводится ключ KEK: PBKDF2-SHA-256, 600 000 итераций, своя случайная соль;
//    KEK шифрует «карточку доступа»: имя, роль, права и DEK того среза, который положен роли;
//  · в файл попадают только соли, IV и шифротексты. Без пароля нельзя получить ни данные, ни даже список ролей.
//  · Начальник цеха своим паролем расшифровывает только свой цех — это ограничение криптографическое, а не «кнопка скрыта».
//
// Запуск:  node tools/seal.js [--users файл.json] [--in app/dist-sealed/index.html] [--out panel/index.html]
//   по умолчанию учётные записи — демонстрационные (те же, что на сервере, см. README);
//   свой список: [{ "login": "...", "password": "...", "name": "...", "role": "director|chief|otk|admin", "shop": "Цех 1" }]
import fs from 'node:fs'
import path from 'node:path'
import { webcrypto as wc } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { ROLES, publicPerms, scopeRows } from '../server/lib/roles.js'
import { DEMO_USERS } from '../server/lib/seed.js'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def }
const IN = path.resolve(ROOT, arg('--in', 'app/dist-sealed/index.html'))
const OUT = path.resolve(ROOT, arg('--out', 'panel/index.html'))
const usersFile = arg('--users')
const ITER = 600_000
const enc = new TextEncoder()
const b64 = (u8) => Buffer.from(u8).toString('base64')
const rnd = (n) => wc.getRandomValues(new Uint8Array(n))

async function aesEncrypt(keyBytes, obj, aad) {
  const key = await wc.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt'])
  const iv = rnd(12)
  const ct = new Uint8Array(await wc.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, enc.encode(JSON.stringify(obj))))
  return { iv: b64(iv), ct: b64(ct) }
}
async function kek(password, salt) {
  const base = await wc.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  return new Uint8Array(await wc.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITER }, base, 256))
}
/** Идентификатор записи для поиска по логину: SHA-256(соль файла + логин). Логины в файле открытым текстом не лежат. */
async function lookupId(lookupSalt, login) {
  const h = await wc.subtle.digest('SHA-256', new Uint8Array([...lookupSalt, ...enc.encode(login.trim().toLowerCase())]))
  return b64(new Uint8Array(h))
}

// ---------------------------------------------------------------- данные и пользователи
const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'server', 'seed.json'), 'utf8'))
const users = usersFile ? JSON.parse(fs.readFileSync(path.resolve(usersFile), 'utf8')) : DEMO_USERS
for (const u of users) {
  if (!ROLES[u.role]) throw new Error('Неизвестная роль: ' + u.role)
  if (!u.login || !u.password || u.password.length < 8) throw new Error('У пользователя ' + u.login + ' нет логина или пароль короче 8 символов')
  if (u.role === 'chief' && !u.shop) throw new Error('Начальнику цеха ' + u.login + ' не указан цех')
}
const SETTINGS = { shiftHours: 8, hourCost: 3000, pieceCost: 1500 }

const scopeKey = (u) => (ROLES[u.role].scope === 'shop' ? 'shop:' + u.shop : ROLES[u.role].scope)
const scopes = new Map()
for (const u of users) {
  const k = scopeKey(u)
  if (scopes.has(k)) continue
  const { dt, df } = scopeRows(u, seed.downtime, seed.defects)
  scopes.set(k, { dek: rnd(32), money: ROLES[u.role].money, dt, df })
}

const lookupSalt = rnd(16)
const vault = {
  v: 1, alg: 'AES-256-GCM', kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: ITER },
  lookupSalt: b64(lookupSalt), sealedAt: new Date().toISOString().slice(0, 10), users: {}, data: {},
}
for (const [k, s] of scopes) {
  const payload = {
    downtime: s.dt, defects: s.df,
    settings: s.money ? SETTINGS : null, // ставки (деньги) получают только роли, которым положены деньги
    source: { downtime: seed.source?.downtime ?? 'clean_01_prostoi.csv', defects: seed.source?.defects ?? 'clean_02_brak.xlsx' },
  }
  vault.data[k] = await aesEncrypt(s.dek, payload, enc.encode('data:' + k))
}
for (const u of users) {
  const id = await lookupId(lookupSalt, u.login)
  const salt = rnd(16)
  const perms = { ...publicPerms(u.role), sheets: ROLES[u.role].sheets.filter((s) => s !== 'admin'), users: false, audit: false, records: {} }
  const card = {
    user: { id: 0, login: u.login, name: u.name ?? u.login, role: u.role, shop: u.shop ?? null, mustChange: false, demo: !usersFile },
    perms, scope: scopeKey(u), dek: b64(scopes.get(scopeKey(u)).dek),
  }
  vault.users[id] = { salt: b64(salt), ...(await aesEncrypt(await kek(u.password, salt), card, enc.encode('user:' + id))) }
}

// ---------------------------------------------------------------- вставка в страницу
const html = fs.readFileSync(IN, 'utf8')
if (!html.includes('</body>')) throw new Error('Не найдена сборка ' + IN + ' — сначала: npm --prefix app run build')
const tag = '<script type="application/json" id="profil-vault">' + JSON.stringify(vault) + '</script>'
fs.mkdirSync(path.dirname(OUT), { recursive: true })
const at = html.lastIndexOf('</body>') // последнее вхождение: строка «</body>» встречается и внутри кода библиотек
fs.writeFileSync(OUT, html.slice(0, at) + tag + html.slice(at))

// самопроверка: в файле не должно быть ни одной строки данных открытым текстом
const out = fs.readFileSync(OUT, 'utf8')
for (const marker of ['Кромкооблицовочный', 'Присадочный станок', 'Форматно-раскроечный', 'clean_01_prostoi', seed.defects[0].order]) {
  if (out.includes(marker)) throw new Error('В запечатанном файле найден открытый текст данных: ' + marker)
}
console.log('Запечатано: ' + path.relative(ROOT, OUT) + ' · ' + users.length + ' уч. записей · срезов данных: ' + scopes.size + ' · ' + Math.round(out.length / 1024) + ' КБ')
