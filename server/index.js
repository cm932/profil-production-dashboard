// Сервер панели «Профиль»: отдаёт панель, API учётных записей и журналов, база SQLite.
// Запуск: npm start  (нужен Node.js 22.18+; внешних пакетов не требуется).
// Настройки — переменные окружения: PORT (3000), HOST (127.0.0.1), PROFIL_DB (server/data/profil.db),
// PROFIL_DEMO (1 — демонстрационные учётные записи; 0 — только администратор), PROFIL_ADMIN_PASSWORD,
// PROFIL_SECURE=1 (cookie только по HTTPS), PROFIL_TRUST_PROXY=1 (за обратным прокси).
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createApp } from './lib/api.js'
import { openDb } from './lib/db.js'
import { cleanupSessions } from './lib/auth.js'
import { seedIfEmpty } from './lib/seed.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))

/** Политика безопасности контента: выполняются только скрипты панели (по хэшу), никаких внешних адресов. */
export function buildCsp(html) {
  const hashes = []
  for (const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    if (m[1].trim()) hashes.push(`'sha256-${crypto.createHash('sha256').update(m[1]).digest('base64')}'`)
  }
  return [
    "default-src 'none'",
    `script-src ${hashes.join(' ') || "'none'"}`,
    "style-src 'self' 'unsafe-inline'", // React и Bklit задают размеры через style-атрибуты
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join('; ')
}

export async function startServer(opts = {}) {
  const env = process.env
  const port = opts.port ?? Number(env.PORT ?? 3000)
  const host = opts.host ?? env.HOST ?? '127.0.0.1'
  const dbFile = opts.dbFile ?? env.PROFIL_DB ?? path.join(HERE, 'data', 'profil.db')
  const panelFile = opts.panelFile ?? env.PROFIL_PANEL ?? path.join(HERE, 'public', 'index.html')
  const demo = opts.demo ?? env.PROFIL_DEMO !== '0'
  const log = opts.log ?? console.log

  const db = openDb(dbFile)
  const seeded = await seedIfEmpty(db, { demo, adminPassword: opts.adminPassword ?? env.PROFIL_ADMIN_PASSWORD, log })

  const panelHtml = fs.existsSync(panelFile) ? fs.readFileSync(panelFile, 'utf8') : '<!doctype html><meta charset="utf-8"><p>Панель не собрана: выполните сборку (см. README).'
  const app = createApp({
    db,
    config: {
      demo, panelHtml, csp: buildCsp(panelHtml),
      secure: opts.secure ?? env.PROFIL_SECURE === '1', trustProxy: opts.trustProxy ?? env.PROFIL_TRUST_PROXY === '1',
    },
  })

  const server = http.createServer((req, res) => { void app(req, res) })
  server.requestTimeout = 30_000
  server.headersTimeout = 15_000
  server.maxHeadersCount = 50
  const timer = setInterval(() => cleanupSessions(db), 10 * 60 * 1000)
  timer.unref()

  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve) })
  const address = server.address()
  const url = `http://${host}:${typeof address === 'object' && address ? address.port : port}/`
  return {
    server, db, url, seeded,
    close: () => new Promise((resolve) => { clearInterval(timer); server.close(() => { db.close(); resolve() }) }),
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let s
  try { s = await startServer() } catch (e) {
    if (e.code !== 'EADDRINUSE' || process.env.PORT) throw e
    s = await startServer({ port: 0 }) // порт 3000 занят другой программой — берём любой свободный
  }
  console.log(`\nПанель «Профиль» запущена: ${s.url}`)
  console.log('Чтобы остановить сервер, закройте это окно или нажмите Ctrl+C.')
  // --open: открыть панель в браузере (так запускают «Запуск сервера Windows.cmd» и «Запуск сервера Mac.command» из архива)
  if (process.argv.includes('--open') && process.env.PROFIL_NO_OPEN !== '1') {
    const { spawn } = await import('node:child_process')
    const p = process.platform
    const child = p === 'win32' ? spawn('cmd', ['/c', 'start', '""', s.url], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true })
      : p === 'darwin' ? spawn('open', [s.url], { detached: true, stdio: 'ignore' })
      : spawn('xdg-open', [s.url], { detached: true, stdio: 'ignore' })
    child.on('error', () => { /* нет программы для открытия — адрес уже показан в окне */ })
    child.unref()
  }
  if (process.env.PROFIL_DEMO !== '0') {
    console.log('Демонстрационные входы (логин / пароль): admin / Admin-2026!, director / Director-2026!, chief1 / Chief1-2026!, chief2 / Chief2-2026!, otk / Otk-2026!')
    console.log('Для рабочей среды запускайте с PROFIL_DEMO=0 (создаётся только администратор).')
  } else if (s.seeded.adminPassword) {
    console.log(`Администратор: admin / ${s.seeded.adminPassword}  (временный пароль показан один раз; при первом входе потребуется смена)`)
  }
  const stop = async () => { await s.close(); process.exit(0) }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}
