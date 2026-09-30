// Готовит server/seed.json — исходные журналы для начального наполнения базы.
// Разбор файлов — тот же код, что и в панели (app/src/lib/parse.ts), поэтому в базу попадает ровно то, что видит демо-режим.
// Запуск: node tools/make-seed.js   (Node 22.18+ читает TypeScript без сборки)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readBytes } from '../app/src/lib/parse.ts'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const dir = path.join(ROOT, 'Файлы для проекта')

const csv = readBytes('clean_01_prostoi.csv', new Uint8Array(fs.readFileSync(path.join(dir, 'clean_01_prostoi.csv'))))
const xlsx = readBytes('clean_02_brak.xlsx', new Uint8Array(fs.readFileSync(path.join(dir, 'clean_02_brak.xlsx'))))
if (csv.errors.length || xlsx.errors.length) throw new Error('В исходных файлах есть строки с ошибками: ' + [...csv.errors, ...xlsx.errors].join('; '))

const out = { downtime: csv.records, defects: xlsx.records }
fs.writeFileSync(path.join(ROOT, 'server', 'seed.json'), JSON.stringify(out))
console.log(`server/seed.json: простоев ${out.downtime.length}, брака ${out.defects.length}`)
