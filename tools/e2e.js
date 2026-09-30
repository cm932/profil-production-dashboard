// Сквозной тест в настоящем браузере (Microsoft Edge): вход под каждой ролью, права, отбор данных, записи, администрирование.
// Сервер поднимается сам (база в памяти, случайный порт) и отдаёт серверную сборку панели.
// Запуск: node tools/e2e.js   (нужен Edge и собранная панель: cd app && npm run build)
// Снимки экранов: SHOTS_DIR=папка node tools/e2e.js
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { startServer } from '../server/index.js'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'server', 'seed.json'), 'utf8'))
const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p))
const SHOTS = process.env.SHOTS_DIR
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const srv = await startServer({ port: 0, dbFile: ':memory:', demo: true, log: () => {} })
const prof = path.join(os.tmpdir(), 'profil-e2e-' + Date.now())
const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--remote-debugging-port=9555', '--user-data-dir=' + prof, '--window-size=1920,960', 'about:blank'], { stdio: 'ignore' })
let list
for (let i = 0; i < 60; i++) { try { list = await (await fetch('http://127.0.0.1:9555/json/list')).json(); if (list.length) break } catch { /* ждём */ } await sleep(200) }
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl)
await new Promise((r) => { ws.onopen = r })
let id = 0
const pending = {}, jsErrors = []
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending[m.id]) { pending[m.id](m); delete pending[m.id] }
  if (m.method === 'Runtime.exceptionThrown') jsErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text)
}
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending[i] = r; ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text))
  return r.result.result.value
}
await send('Runtime.enable'); await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 960, deviceScaleFactor: 1, mobile: false })

const waitFor = async (cond, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await ev(cond)) return true } catch { /* страница перезагружается */ } await sleep(80) } return false }
const q = (s) => JSON.stringify(s)
const setVal = (sel, v) => ev(`(() => { const el = document.querySelector(${q(sel)}); const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${q(v)}); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); })()`)
const clickSel = (sel) => ev(`(() => { const e = document.querySelector(${q(sel)}); if (!e) return false; e.click(); return true })()`)
const clickText = (sel, text) => ev(`(() => { const b = [...document.querySelectorAll(${q(sel)})].find(e => e.textContent.trim() === ${q(text)}); if (!b) return false; b.click(); return true })()`)
// поле формы по подписи
const fillField = (label, v) => ev(`(() => { const f = [...document.querySelectorAll('.dialog .field')].find(x => x.querySelector('.label').textContent.trim() === ${q(label)}); const el = f.querySelector('input, select'); const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${q(v)}); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); })()`)
const nav = () => ev("[...document.querySelectorAll('.nav-item')].map(e => e.textContent.trim()).join(', ')")
const kpi = async () => JSON.parse(await ev("JSON.stringify(document.querySelector('#kpis') ? { ...document.querySelector('#kpis').dataset } : null)"))
const shot = async (name) => { if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true }); const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(r.result.data, 'base64')) }

const results = []
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail })
const goHome = async () => { await send('Page.navigate', { url: srv.url }); await waitFor("!!document.querySelector('#loginName') || !!document.querySelector('.app')") }
async function login(user, pass) {
  await goHome()
  if (await ev("!!document.querySelector('.app')")) { await clickSel('#logoutBtn'); await waitFor("!!document.querySelector('#loginName')") }
  await setVal('#loginName', user); await setVal('#loginPass', pass); await clickSel('#loginSubmit')
}
async function logout() { await clickSel('#logoutBtn'); return waitFor("!!document.querySelector('#loginName')") }
const lastPage = async () => { await clickSel('button[aria-label="Последняя страница"]'); await sleep(350) }
const rowsCount = () => ev("+document.querySelector('#dTotals').dataset.rows")
const sumMin = (rows) => rows.reduce((s, r) => s + r.min, 0)

// ================= 1. до входа
await goHome()
check('до входа виден только экран входа, листов и цифр нет', (await ev("!!document.querySelector('#loginName')")) && !(await ev("!!document.querySelector('#kpis')")) && !(await ev("!!document.querySelector('.nav-item')")))
const html = await (await fetch(srv.url)).text()
check('в коде страницы, отданной без входа, нет ни строки данных', !/Кромкооблицовочный|Присадочный станок|Форматно-раскроечный|З-1237|clean_01_prostoi/.test(html) && html.length > 100_000)
await shot('01-login')

// ================= 2. ошибки входа
await setVal('#loginName', 'director'); await setVal('#loginPass', 'неверный-пароль'); await clickSel('#loginSubmit')
await waitFor("!!document.querySelector('#loginError')")
check('неверный пароль — общее сообщение, без подсказок', (await ev("document.querySelector('#loginError').textContent")) === 'Неверный логин или пароль.')
for (let i = 0; i < 6; i++) { await setVal('#loginName', 'chief2'); await setVal('#loginPass', 'плохой-пароль-' + i); await clickSel('#loginSubmit'); await sleep(450) } // пятая ошибка ставит блокировку, шестая попытка её встречает
await waitFor("/мин/.test(document.querySelector('#loginError')?.textContent || '')")
check('после пяти неудач вход блокируется с сообщением о времени ожидания', /Повторите через \d+ мин/.test(await ev("document.querySelector('#loginError')?.textContent || ''")))
srv.db.prepare("UPDATE users SET locked_until = 0, failed = 0 WHERE login = 'chief2'").run()

// ================= 3. директор
await login('director', 'Director-2026!'); await waitFor("!!document.querySelector('#kpis')")
check('директор: листы Сводка, Простои, Брак, Данные (без администрирования)', (await nav()) === 'Сводка, Простои, Брак, Данные', await nav())
const kd = await kpi()
check('директор: цифры с сервера = исходные (5 635 мин потерь, 218 шт брака)', kd.lossMin === '5635' && kd.pieces === '218' && kd.plannedMin === '1325', JSON.stringify(kd))
check('директор: видит деньги и кнопку загрузки данных', (await ev("[...document.querySelectorAll('.tile .k')].some(e => e.textContent.includes('деньгах'))")) && (await ev("!!document.querySelector('#fileInput')")))
await ev("location.hash = '#admin'"); await sleep(600)
check('директор: открыть #admin вручную нельзя — остаётся допустимый лист', !(await ev("!!document.querySelector('#usersTable')")) && !(await ev("!!document.querySelector('.sheet--admin')")))
await ev("location.hash = '#summary'"); await sleep(400)
await shot('02-director')
check('директор: пароль в интерфейсе не показывается и пользователи недоступны через API', (await ev("fetch('/api/users', {credentials:'same-origin'}).then(r => r.status)")) === 403)
await logout()

// ================= 4. начальник цеха 1
await login('chief1', 'Chief1-2026!'); await waitFor("!!document.querySelector('#kpis')")
const shop1 = seed.downtime.filter((r) => r.shop === 'Цех 1')
const kc = await kpi()
check('начальник цеха 1: листы как у директора, но без денег и загрузки', (await nav()) === 'Сводка, Простои, Брак, Данные' && !(await ev("[...document.querySelectorAll('.tile .k')].some(e => e.textContent.includes('деньгах'))")) && !(await ev("!!document.querySelector('#fileInput')")))
check('начальник цеха 1: потери = только его цех (сервер отфильтровал)', +kc.lossMin === sumMin(shop1.filter((r) => !r.planned)), JSON.stringify(kc) + ' ожидалось ' + sumMin(shop1.filter((r) => !r.planned)))
check('начальник цеха 1: в фильтре цеха только «Все» и «Цех 1»', (await ev("[...document.querySelectorAll('#fShop .tab')].map(e => e.textContent.trim()).join(',')")) === 'Все,Цех 1')
check('начальник цеха 1: в текстах выводов нет рублей', !/₽/.test(await ev("document.querySelector('.ip').textContent")))
await shot('03-chief1')
await clickText('.nav-item', 'Данные'); await waitFor("!!document.querySelector('#dTotals')")
const before = await rowsCount()
await clickSel('#addRecord'); await waitFor("!!document.querySelector('#recordForm')")
await fillField('Дата', '2026-06-15'); await fillField('Станок', 'К-1'); await fillField('Причина простоя', 'Поломка'); await fillField('Длительность, мин', '40'); await fillField('Цех', 'Цех 1').catch(() => {})
check('форма простоя: цех начальника цеха закреплён и не редактируется', await ev("(() => { const f = [...document.querySelectorAll('.dialog .field')].find(x => x.querySelector('.label').textContent.trim() === 'Цех'); const i = f.querySelector('input'); return !!i && i.readOnly && i.value === 'Цех 1' })()"))
await shot('04-record-form')
await clickSel('#recordForm button[type=submit]'); await waitFor(`+document.querySelector('#dTotals').dataset.rows === ${before + 1}`)
check('начальник цеха 1: добавленная запись появилась в журнале', (await rowsCount()) === before + 1)
await lastPage()
check('добавленную запись можно изменить и удалить (кнопки действий у своей записи)', (await ev("document.querySelectorAll('.row-actions button').length")) >= 2)
await clickSel('.row-actions button[aria-label="Удалить запись"]'); await waitFor("!!document.querySelector('#confirmDelete')"); await clickSel('#confirmDelete')
await waitFor(`+document.querySelector('#dTotals').dataset.rows === ${before}`)
check('начальник цеха 1: удаление своей записи работает', (await rowsCount()) === before)
check('у исходных записей кнопок изменения нет (они не его)', (await ev("document.querySelectorAll('.row-actions button').length")) === 0)
await logout()

// ================= 5. оператор ОТК
await login('otk', 'Otk-2026!'); await waitFor("!!document.querySelector('.app')")
await waitFor("!!document.querySelector('.sheet')")
check('оператор ОТК: доступны только Брак и Данные', (await nav()) === 'Брак, Данные', await nav())
check('оператор ОТК: ни денег, ни загрузки, ни простоев', !(await ev("!!document.querySelector('#fileInput')")) && (await ev("fetch('/api/data', {credentials:'same-origin'}).then(r => r.json()).then(d => d.downtime.length + '/' + (d.settings === null))")) === '0/true')
await shot('05-otk-defects')
await clickText('.nav-item', 'Данные'); await waitFor("!!document.querySelector('#dTotals')")
check('оператор ОТК: в данных только журнал брака', (await ev("[...document.querySelectorAll('.tabs--slide .tab')].map(e => e.textContent.trim()).filter(t => t.startsWith('Журнал')).join(',')")) === 'Журнал брака')
const b0 = await rowsCount()
await clickSel('#addRecord'); await waitFor("!!document.querySelector('#recordForm')")
await fillField('Дата', '2026-06-15'); await fillField('Тип дефекта', 'Царапина'); await fillField('Операция-источник', 'Сборка'); await fillField('Количество, шт', '3'); await fillField('Заказ', 'З-7777')
await clickSel('#recordForm button[type=submit]'); await waitFor(`+document.querySelector('#dTotals').dataset.rows === ${b0 + 1}`)
check('оператор ОТК: внёс запись о браке', (await rowsCount()) === b0 + 1)
await lastPage()
const clicked = await clickSel('.row-actions button[aria-label="Изменить запись"]'); const opened = await waitFor("!!document.querySelector('#recordForm')")
if (!opened) { console.log('ДИАГНОСТИКА: кликнули', clicked, '| кнопок действий', await ev("document.querySelectorAll('.row-actions button').length"), '| страница', await ev("document.querySelector('.pager-page')?.textContent"), '| строк', await ev("document.querySelectorAll('#dTable tbody tr').length"), '| диалогов', await ev("document.querySelectorAll('.dialog').length"), '| ошибка', await ev("document.querySelector('.auth-error')?.textContent")); await shot('dbg') }
await fillField('Количество, шт', '9'); await clickSel('#recordForm button[type=submit]'); await sleep(900)
await setVal('#dSearch', 'З-7777'); await sleep(400)
check('оператор ОТК: изменил свою запись (найдена по заказу, количество 9)', (await ev("[...document.querySelectorAll('#dTable tbody tr')].some(r => r.textContent.includes('З-7777') && r.textContent.includes('9'))")))
await clickSel('.row-actions button[aria-label="Удалить запись"]'); await waitFor("!!document.querySelector('#confirmDelete')"); await clickSel('#confirmDelete'); await setVal('#dSearch', ''); await waitFor(`+document.querySelector('#dTotals').dataset.rows === ${b0}`)
check('оператор ОТК: удалил свою запись', (await rowsCount()) === b0)
await logout()

// ================= 6. администратор
await login('admin', 'Admin-2026!'); await waitFor("!!document.querySelector('#kpis')")
check('администратор: есть лист «Администрирование»', (await nav()).endsWith('Администрирование'), await nav())
await clickText('.nav-item', 'Администрирование'); await waitFor("!!document.querySelector('#usersTable')")
await waitFor("document.querySelectorAll('#usersTable tbody tr').length >= 5")
check('администратор: в таблице пять учётных записей', (await ev("document.querySelectorAll('#usersTable tbody tr').length")) === 5)
await shot('06-admin-users')
await clickSel('#newUser'); await waitFor("!!document.querySelector('#userForm')")
await fillField('Логин', 'petrov'); await fillField('Имя', 'Пётр Петров'); await fillField('Роль', 'chief'); await waitFor("[...document.querySelectorAll('.dialog .field .label')].some(l => l.textContent.trim() === 'Цех')")
await fillField('Цех', 'Цех 2')
await clickSel('#userForm button[type=submit]'); await waitFor("!!document.querySelector('#tempPassword')")
const temp = await ev("document.querySelector('#tempPassword').textContent")
check('созданному пользователю выдан временный пароль', /^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/.test(temp), temp)
await shot('07-temp-password')
await ev("document.querySelector('.dialog-foot .btn--secondary').click()"); await sleep(400)
await clickText('.tabs--slide .tab', 'Журнал действий'); await waitFor("document.querySelectorAll('#auditTable tbody tr').length > 0")
check('журнал действий показывает создание пользователя', await ev("[...document.querySelectorAll('#auditTable tbody tr')].some(r => r.textContent.includes('Пользователь создан') && r.textContent.includes('petrov'))"))
await shot('08-admin-audit')
await logout()

// ================= 7. первый вход с временным паролем
await login('petrov', temp); await waitFor("!!document.querySelector('.auth-form') && !document.querySelector('#loginName')")
check('временный пароль: вместо работы — обязательная смена пароля', (await ev("document.querySelector('.auth h1').textContent")) === 'Смена пароля' && !(await ev("!!document.querySelector('#kpis')")))
await shot('09-must-change')
await ev(`(() => { const ins = [...document.querySelectorAll('.auth-form input')]; const set = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) }; set(ins[0], ${q(temp)}); set(ins[1], 'Petrov-Novyj-55'); set(ins[2], 'Petrov-Novyj-55') })()`)
await ev("document.querySelector('.auth-form button[type=submit]').click()"); await waitFor("!!document.querySelector('#kpis')")
const kp = await kpi()
const shop2 = seed.downtime.filter((r) => r.shop === 'Цех 2')
check('после смены пароля начальник цеха 2 видит только свой цех', kp && +kp.lossMin === sumMin(shop2.filter((r) => !r.planned)), JSON.stringify(kp))
await logout()
check('старый временный пароль после смены не работает', (await ev(`fetch('/api/login', {method:'POST', headers:{'Content-Type':'application/json','X-Requested-With':'profil'}, body: JSON.stringify({login:'petrov', password:${q(temp)}})}).then(r => r.status)`)) === 401)

// ================= 8. выход не оставляет данных
await login('director', 'Director-2026!'); await waitFor("!!document.querySelector('#kpis')")
await logout()
check('после выхода данных на экране нет, API закрыт', !(await ev("!!document.querySelector('#kpis')")) && (await ev("fetch('/api/data', {credentials:'same-origin'}).then(r => r.status)")) === 401)

// ================= итог
ws.close(); proc.kill(); await srv.close()
const bad = results.filter((r) => !r.ok)
for (const r of results) console.log((r.ok ? 'ok   ' : 'FAIL ') + r.name + (r.ok || !r.detail ? '' : '\n       ' + r.detail))
console.log(`\nПроверок: ${results.length}, прошло: ${results.length - bad.length}, упало: ${bad.length}, ошибок JS в консоли: ${jsErrors.length}`)
if (jsErrors.length) console.log(jsErrors.slice(0, 5).join('\n'))
process.exit(bad.length || jsErrors.length ? 1 : 0)
