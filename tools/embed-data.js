// Встраивает исходные журналы в панель как данные «по умолчанию».
// Файлы кладутся как есть (CSV — текстом, XLSX — base64) и разбираются в браузере
// тем же кодом, что и файлы, загруженные кнопкой. Так встроенные данные нельзя «подправить» незаметно.
// Запуск: node tools/embed-data.js
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'Файлы для проекта');
const out = path.join(__dirname, '..', 'panel', 'data', 'default-data.js');

const csv = fs.readFileSync(path.join(src, 'clean_01_prostoi.csv'), 'utf8');
const xlsx = fs.readFileSync(path.join(src, 'clean_02_brak.xlsx')).toString('base64');

const js = `// Сгенерировано tools/embed-data.js — не редактировать вручную.
window.DEFAULT_FILES = [
  { name: 'clean_01_prostoi.csv', kind: 'text', content: ${JSON.stringify(csv)} },
  { name: 'clean_02_brak.xlsx', kind: 'base64', content: ${JSON.stringify(xlsx)} }
];
`;
fs.writeFileSync(out, js);
console.log('OK:', out, (js.length / 1024).toFixed(1) + ' КБ');
