// Проверка запечатанного файла panel/index.html (без браузера): криптография та же, что в app/src/lib/vault.ts.
// Запуск: node tools/test-sealed.js
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { webcrypto as wc } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { ROLES, scopeRows } from '../server/lib/roles.js'
import { DEMO_USERS } from '../server/lib/seed.js'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const FILE = path.resolve(process.argv[2] ?? path.join(ROOT, 'panel', 'index.html'))
const html = fs.readFileSync(FILE, 'utf8')
const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'server', 'seed.json'), 'utf8'))
const enc = new TextEncoder()
const unb64 = (s) => Uint8Array.from(Buffer.from(s, 'base64'))

let ok = 0, bad = 0
async function test(name, fn) {
  try { await fn(); ok++; console.log('ok   ' + name) } catch (e) { bad++; console.log('FAIL ' + name + '\n     ' + e.message) }
}

const m = html.match(/<script type="application\/json" id="profil-vault">([\s\S]*?)<\/script>/)
const vault = m ? JSON.parse(m[1]) : null

async function open(keyBytes, box, aad) {
  const key = await wc.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt'])
  const plain = await wc.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv), additionalData: enc.encode(aad) }, key, unb64(box.ct))
  return JSON.parse(new TextDecoder().decode(plain))
}
async function lookup(login) {
  return Buffer.from(await wc.subtle.digest('SHA-256', new Uint8Array([...unb64(vault.lookupSalt), ...enc.encode(login.toLowerCase())]))).toString('base64')
}
async function card(login, password) {
  const id = await lookup(login)
  const e = vault.users[id]
  if (!e) throw new Error('нет записи')
  const base = await wc.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const kek = new Uint8Array(await wc.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(e.salt), iterations: vault.kdf.iterations }, base, 256))
  return open(kek, e, 'user:' + id)
}

await test('в файле есть зашифрованный блок, параметры шифрования не ослаблены', () => {
  assert.ok(vault, 'нет блока profil-vault')
  assert.equal(vault.alg, 'AES-256-GCM')
  assert.ok(vault.kdf.iterations >= 600_000, 'итераций PBKDF2 меньше 600 000')
})
await test('ни одной строки данных открытым текстом (станки, заказы, файлы)', () => {
  const markers = ['Кромкооблицовочный', 'Присадочный станок', 'Форматно-раскроечный', 'clean_01_prostoi', ...seed.defects.slice(0, 20).map((r) => r.order)]
  for (const x of markers) assert.ok(!html.includes(x), 'найдено: ' + x)
})
await test('в файле нет логинов, паролей и ролей открытым текстом', () => {
  for (const u of DEMO_USERS) {
    assert.ok(!html.includes(u.password), 'пароль ' + u.login)
    assert.ok(!html.includes('"' + u.login + '"'), 'логин ' + u.login)
  }
  assert.ok(!/"role"\s*:/.test(m[1]), 'роль открытым текстом')
})
for (const u of DEMO_USERS) {
  await test(u.login + ': свой пароль расшифровывает ровно положенные роли данные', async () => {
    const c = await card(u.login, u.password)
    const data = await open(unb64(c.dek), vault.data[c.scope], 'data:' + c.scope)
    const want = scopeRows(u, seed.downtime, seed.defects)
    assert.equal(data.downtime.length, want.dt.length)
    assert.equal(data.defects.length, want.df.length)
    assert.equal(data.settings !== null, ROLES[u.role].money, 'ставки (деньги) — только ролям с деньгами')
    assert.ok(!c.perms.sheets.includes('admin'), 'в файле нет администрирования')
  })
}
await test('неверный пароль не подходит; регистр логина не важен', async () => {
  await assert.rejects(card('director', 'Director-2026?'))
  await card('DIRECTOR', 'Director-2026!')
})
await test('ключ начальника цеха 1 не открывает ни общий срез, ни цех 2, ни чужие карточки', async () => {
  const c = await card('chief1', 'Chief1-2026!')
  for (const k of Object.keys(vault.data).filter((k) => k !== c.scope)) await assert.rejects(open(unb64(c.dek), vault.data[k], 'data:' + k), 'открылся срез ' + k)
  const other = await lookup('director')
  await assert.rejects(open(unb64(c.dek), vault.users[other], 'user:' + other))
})
await test('подмена среза (чужой шифротекст под своим именем) обнаруживается', async () => {
  const c = await card('otk', 'Otk-2026!')
  const foreign = Object.keys(vault.data).find((k) => k !== c.scope)
  await assert.rejects(open(unb64(c.dek), vault.data[foreign], 'data:' + c.scope))
})

console.log(`\nТестов: ${ok + bad}, прошло: ${ok}, упало: ${bad}`)
process.exit(bad ? 1 : 0)
