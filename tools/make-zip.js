// Сборка архива для сдачи. Пишет zip сам (без сторонних программ), потому что нужны две вещи, которых нет у обычных
// «отправить в сжатую папку» на Windows:
//  · права на запуск (rwx) у «Запуск сервера Mac.command» — иначе Mac не запустит файл двойным щелчком («нет прав»);
//  · имена файлов в UTF-8 с пометкой Unix — кириллица одинаково читается в Windows и macOS.
// В архив попадают файлы, отслеживаемые git, плюс переносной Node.js (runtime/node.exe и runtime/mac/*.tar.xz — они не в git: 200 МБ).
// Запуск: node tools/make-zip.js [путь-к-архиву.zip]
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import os from 'node:os'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const SLIM_MODE = args.includes('--slim') // архив для отправки: только то, что нужно для запуска и просмотра
const OUT = path.resolve(args.find((a) => !a.startsWith('--')) ?? path.join(os.homedir(), 'Desktop', 'Профиль_панель_v5.zip'))
const PREFIX = 'Профиль_панель/'
const LIMIT_MB = 99 // предел отправки — 100 МБ

const tracked = execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files'], { cwd: ROOT, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean)
const extra = ['runtime/node.exe', ...(fs.existsSync(path.join(ROOT, 'runtime/mac')) ? fs.readdirSync(path.join(ROOT, 'runtime/mac')).map((f) => 'runtime/mac/' + f) : [])]
const all = [...new Set([...tracked, ...extra])].filter((f) => fs.existsSync(path.join(ROOT, f)) && fs.statSync(path.join(ROOT, f)).isFile())

// Состав облегчённого архива (--slim): без исходников панели, тестов и служебных документов — они остаются в репозитории на GitHub
const SLIM = [/^Инструкция\.html$/, /^Запуск сервера (Windows\.cmd|Mac\.command)$/, /^server\//, /^runtime\//, /^Файлы для проекта\//]
const RENAME = { 'panel/index.html': 'Открыть без сервера.html' } // зашифрованная панель — в корне, под понятным именем
const entries = (SLIM_MODE ? [...all.filter((f) => SLIM.some((re) => re.test(f))), ...Object.keys(RENAME)] : all)
  .map((f) => ({ src: f, dest: SLIM_MODE ? (RENAME[f] ?? f) : f }))
const files = entries.map((e) => e.src)

const EXEC = /\.(command|sh)$/i
const ALREADY_COMPRESSED = /\.(xz|gz|zip|woff2|png|jpg)$/i
const now = new Date()
const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)
const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()

const chunks = []
const central = []
let offset = 0
const push = (b) => { chunks.push(b); offset += b.length }

for (const { src: f, dest } of entries) {
  const data = fs.readFileSync(path.join(ROOT, f))
  const name = Buffer.from(PREFIX + dest.replace(/\\/g, '/'), 'utf8')
  const stored = ALREADY_COMPRESSED.test(f) || data.length < 64
  const body = stored ? data : zlib.deflateRawSync(data, { level: 9 })
  const method = stored ? 0 : 8
  const crc = zlib.crc32(data)
  const mode = EXEC.test(f) ? 0o100755 : 0o100644

  const lh = Buffer.alloc(30)
  lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(method, 8)
  lh.writeUInt16LE(dosTime, 10); lh.writeUInt16LE(dosDate, 12); lh.writeUInt32LE(crc, 14)
  lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28)
  const start = offset
  push(lh); push(name); push(body)

  const ch = Buffer.alloc(46)
  ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE((3 << 8) | 20, 4) /* создан в Unix */; ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8)
  ch.writeUInt16LE(method, 10); ch.writeUInt16LE(dosTime, 12); ch.writeUInt16LE(dosDate, 14); ch.writeUInt32LE(crc, 16)
  ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28)
  ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32); ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36)
  ch.writeUInt32LE((mode << 16) >>> 0, 38); ch.writeUInt32LE(start, 42)
  central.push(Buffer.concat([ch, name]))
}

const cdStart = offset
for (const c of central) push(c)
const cdSize = offset - cdStart
const end = Buffer.alloc(22)
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6)
end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cdSize, 12); end.writeUInt32LE(cdStart, 16); end.writeUInt16LE(0, 20)
push(end)
if (offset >= 0xffffffff) throw new Error('Архив больше 4 ГБ — формат zip без zip64 не подходит')

fs.writeFileSync(OUT, Buffer.concat(chunks))
const mb = fs.statSync(OUT).size / 1048576
console.log('Архив: ' + OUT + '\n  файлов: ' + files.length + ', размер: ' + mb.toFixed(1) + ' МБ (предел ' + LIMIT_MB + ' МБ)')
if (mb > LIMIT_MB) { console.error('ОШИБКА: архив больше предела отправки'); process.exit(1) }
