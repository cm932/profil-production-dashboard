// Собирает Инструкция.html: подставляет в шаблон снимки экрана (tools/guide/*.jpg) прямо в файл, чтобы он открывался без интернета.
// Запуск: node tools/make-guide.js
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const img = (f) => 'data:image/jpeg;base64,' + fs.readFileSync(path.join(ROOT, 'tools', 'guide', f)).toString('base64')
const html = fs.readFileSync(path.join(ROOT, 'tools', 'guide-template.html'), 'utf8')
  .replace('{{LOGIN}}', () => img('login.jpg'))
  .replace('{{SUMMARY}}', () => img('summary.jpg'))
fs.writeFileSync(path.join(ROOT, 'Инструкция.html'), html)
console.log('Инструкция.html: ' + Math.round(html.length / 1024) + ' КБ')
