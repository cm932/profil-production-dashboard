// Независимая сверка панели с исходными файлами.
// Исходные журналы разбираются здесь своим кодом (не кодом панели), затем для каждой комбинации фильтров
// сравниваются ожидаемые значения с тем, что показывает панель: KPI, суммы всех графиков, тепловая карта, лист «Данные».
// Панель отдаёт проверяемые числа в атрибутах data-* (data-sum на каждом графике, data-loss-min на KPI и т. д.).
// Запуск (нужен Microsoft Edge, Windows):
//   node tools/verify-panel.js [путь к index.html]   — автономная панель (данные вшиты)
//   node tools/verify-panel.js --server              — серверная панель: сервер поднимается сам, вход директором, данные берутся из базы SQLite
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));
const SERVER_MODE = process.argv.includes("--server");
const fileArg = process.argv.slice(2).find((a) => !a.startsWith("--"));
const PANEL = fileArg ? path.resolve(fileArg) : path.join(ROOT, 'panel', 'index.html');
let srv = null;
let PANEL_URL = 'file:///' + PANEL.replace(/\\/g, '/');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 1. Независимое чтение исходных файлов ----------
const csv = fs.readFileSync(path.join(ROOT, 'Файлы для проекта', 'clean_01_prostoi.csv'), 'utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/);
const h1 = csv[0].split(';');
const D = csv.slice(1).map((l) => {
  const v = l.split(';'), o = {};
  h1.forEach((k, i) => { o[k] = v[i]; });
  return { date: o['Дата'], shift: +o['Смена'], shop: o['Цех'], planned: o['Плановый простой'] === 'да', min: +o['Длительность, мин'] };
});

const tmp = path.join(os.tmpdir(), 'profil-verify-xlsx');
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });
execSync(`powershell -NoProfile -Command "Add-Type -A System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::ExtractToDirectory('${path.join(ROOT, 'Файлы для проекта', 'clean_02_brak.xlsx').replace(/'/g, "''")}', '${tmp}')"`);
const xml = fs.readFileSync(path.join(tmp, 'xl', 'worksheets', 'sheet1.xml'), 'utf8');
const dec = (s) => s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');
const rows = [...xml.matchAll(/<row [^>]*>(.*?)<\/row>/g)].map((m) => [...m[1].matchAll(/<c r="[A-Z]+\d+"[^>]*?(?:\/>|>(.*?)<\/c>)/g)].map((c) => {
  const b = c[1] || '';
  const t = b.match(/<t[^>]*>(.*?)<\/t>/), v = b.match(/<v>(.*?)<\/v>/);
  return dec(t ? t[1] : v ? v[1] : '');
}));
const h2 = rows[0];
const B = rows.slice(1).map((r) => {
  const o = {};
  h2.forEach((k, i) => { o[k] = r[i]; });
  return { date: o['Дата контроля'], shift: +o['Смена'], qty: +o['Кол-во, шт'], order: o['Заказ'] };
});

// ---------- 2. Ожидаемые значения для комбинации фильтров ----------
const sum = (a, f) => a.reduce((s, r) => s + f(r), 0);
function expected(c) {
  const inP = (r) => r.date >= c.from && r.date <= c.to;
  const d = D.filter((r) => inP(r) && (c.shift === 'all' || r.shift === +c.shift) && (c.shop === 'all' || r.shop === c.shop));
  const b = B.filter((r) => inP(r) && (c.shift === 'all' || r.shift === +c.shift));
  return {
    rows: d.length, totalMin: sum(d, (r) => r.min), lossMin: sum(d.filter((r) => !r.planned), (r) => r.min), plannedMin: sum(d.filter((r) => r.planned), (r) => r.min),
    defectRows: b.length, pieces: sum(b, (r) => r.qty), orders: new Set(b.map((r) => r.order)).size,
  };
}

const periods = [
  { name: 'весь период', from: '2026-05-19', to: '2026-06-15' },
  { name: 'неделя 1', from: '2026-05-19', to: '2026-05-25' },
  { name: 'неделя 2', from: '2026-05-26', to: '2026-06-01' },
  { name: 'неделя 3', from: '2026-06-02', to: '2026-06-08' },
  { name: 'неделя 4', from: '2026-06-09', to: '2026-06-15' },
  { name: 'произвольный 25.05–03.06', from: '2026-05-25', to: '2026-06-03' },
];
const combos = [];
for (const p of periods) for (const shift of ['all', '1', '2']) for (const shop of ['all', 'Цех 1', 'Цех 2']) combos.push({ ...p, shift, shop });

// ---------- 3. Управление браузером ----------
(async () => {
  if (SERVER_MODE) {
    const { startServer } = await import('../server/index.js');
    srv = await startServer({ port: 0, dbFile: ':memory:', demo: true, log: () => {} });
    PANEL_URL = srv.url;
  }
  const prof = path.join(tmp, 'edge-profile');
  const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--remote-debugging-port=9444', '--user-data-dir=' + prof, '--window-size=1500,1100', 'about:blank'], { stdio: 'ignore' });
  let list;
  for (let i = 0; i < 60; i++) {
    try { list = await (await fetch('http://127.0.0.1:9444/json/list')).json(); if (list.length) break; } catch (e) { /* ждём запуск */ }
    await sleep(200);
  }
  const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  let id = 0;
  const pending = {}, errors = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending[m.id]) { pending[m.id](m); delete pending[m.id]; }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
    return r.result.result.value;
  };
  const waitLogin = async () => {
    for (let i = 0; i < 100 && !(await ev("!!document.querySelector('#loginName')")); i++) await sleep(100);
    await ev(`(() => { const set = (sel, v) => { const el = document.querySelector(sel); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }; set('#loginName', 'director'); set('#loginPass', 'Director-2026!'); })()`);
    await sleep(150);
    await ev("document.querySelector('#loginSubmit').click()");
    for (let i = 0; i < 100 && !(await ev("!!document.querySelector('#kpis')")); i++) await sleep(100);
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1100, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: PANEL_URL });
  await sleep(2500);
  if (SERVER_MODE) {
    await waitLogin();
  }

  // Ждём, пока условие станет истинным (лист выехал, график отрисовался)
  const waitFor = async (cond, ms = 6000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await ev(cond)) return true; await sleep(60); }
    return false;
  };
  const click = (scope, text) => ev(`(() => { const b = [...document.querySelectorAll('${scope}')].find(e => e.textContent.trim() === ${JSON.stringify(text)}); if (!b) return false; b.click(); return true; })()`);
  const setDate = (idSel, v) => ev(`(() => { const el = document.querySelector('${idSel}'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(v)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const nav = async (label, sheet) => { await click('.nav-item', label); await waitFor(`!!document.querySelector('#sheet-${sheet}')`); await sleep(120); };
  const num = (sel, attr = 'data-sum') => `(() => { const e = document.querySelector('${sel}'); return e ? +e.getAttribute('${attr}') : 0; })()`;

  let bad = 0, checks = 0;
  const lines = [];

  for (const c of combos) {
    const e = expected(c);
    // фильтры — через настоящие элементы управления
    await setDate('#fFrom', c.from);
    await setDate('#fTo', c.to);
    await click('#fShift .tab', c.shift === 'all' ? 'Обе' : c.shift === '1' ? 'День' : 'Ночь');
    await click('#fShop .tab', c.shop === 'all' ? 'Все' : c.shop);
    await sleep(120);

    const got = {};
    await nav('Сводка', 'summary');
    Object.assign(got, {
      lossMin: await ev(num('#kpis', 'data-loss-min')), plannedMin: await ev(num('#kpis', 'data-planned-min')), pieces: await ev(num('#kpis', 'data-pieces')),
      defectRows: await ev(num('#kpis', 'data-cases')), orders: await ev(num('#kpis', 'data-orders')),
      sumPareto_min: Math.round((await ev(num('[data-chart="pareto"]'))) * 60), sumDefects: await ev(num('[data-chart="ops-shift"]')),
    });

    await nav('Простои', 'downtime');
    Object.assign(got, {
      pareto_min: Math.round((await ev(num('[data-chart="pareto"]'))) * 60), machines_min: Math.round((await ev(num('[data-chart="machines-reason"]'))) * 60),
      machShift_min: Math.round((await ev(num('[data-chart="machines-shift"]'))) * 60), heat_min: await ev(num('[data-chart="heatmap"]')),
      plannedBox_min: await ev(num('#plannedBox', 'data-planned-min')),
    });

    await nav('Брак', 'defects');
    Object.assign(got, {
      daily: await ev(num('[data-chart="daily-defects"]')), ops: await ev(num('[data-chart="ops-shift"]')), types: await ev(num('[data-chart="defect-types"]')),
      weeks: (await ev(num('[data-chart="week-0"]'))) + (await ev(num('[data-chart="week-1"]'))) + (await ev(num('[data-chart="week-2"]'))) + (await ev(num('[data-chart="week-3"]'))) + (await ev(num('[data-chart="week-4"]'))),
    });

    await nav('Данные', 'data');
    await click('.tab', 'Журнал простоев');
    await waitFor(`document.querySelector('#dTotals')?.dataset.kind === 'downtime'`);
    got.data_rows = await ev(num('#dTotals', 'data-rows'));
    got.data_totalMin = await ev(num('#dTotals', 'data-total-min'));
    got.data_lossMin = await ev(num('#dTotals', 'data-loss-min'));
    await click('.tab', 'Журнал брака');
    await waitFor(`document.querySelector('#dTotals')?.dataset.kind === 'defects'`);
    got.data_defectRows = await ev(num('#dTotals', 'data-rows'));
    got.data_pieces = await ev(num('#dTotals', 'data-pieces'));
    await click('.tab', 'Журнал простоев');

    // Что должно совпасть с чем
    const fullWeeks = (Date.parse(c.to) - Date.parse(c.from)) / 864e5 + 1;
    const pairs = [
      ['KPI потери, мин', got.lossMin, e.lossMin], ['KPI плановое ТО, мин', got.plannedMin, e.plannedMin], ['KPI брак, шт', got.pieces, e.pieces],
      ['KPI случаев брака', got.defectRows, e.defectRows], ['KPI заказов', got.orders, e.orders],
      ['Сводка: Парето, мин', got.sumPareto_min, e.lossMin], ['Сводка: брак по операциям', got.sumDefects, e.pieces],
      ['Простои: Парето', got.pareto_min, e.lossMin], ['Простои: по станкам и причинам', got.machines_min, e.lossMin], ['Простои: день/ночь', got.machShift_min, e.lossMin],
      ['Простои: тепловая карта', got.heat_min, e.lossMin], ['Простои: плановое ТО', got.plannedBox_min, e.plannedMin],
      ['Брак: по дням', got.daily, e.pieces], ['Брак: по операциям', got.ops, e.pieces], ['Брак: типы', got.types, e.pieces],
      ['Данные: записей простоев', got.data_rows, e.rows], ['Данные: длительность', got.data_totalMin, e.totalMin], ['Данные: внеплановые', got.data_lossMin, e.lossMin],
      ['Данные: записей брака', got.data_defectRows, e.defectRows], ['Данные: брак, шт', got.data_pieces, e.pieces],
    ];
    if (fullWeeks % 7 === 0 && fullWeeks >= 14) pairs.push(['Брак: по неделям', got.weeks, e.pieces]); // недели считаются только целыми
    const fails = pairs.filter(([, a, b]) => a !== b);
    checks += pairs.length;
    bad += fails.length;
    lines.push((fails.length ? 'FAIL ' : 'ok   ') + c.name + ' | смена ' + c.shift + ' | ' + c.shop + ' | потери ' + e.lossMin + ' мин, брак ' + e.pieces + ' шт' +
      fails.map(([n, a, b]) => '\n       ✗ ' + n + ': панель ' + a + ', исходные данные ' + b).join(''));
  }

  console.log(lines.join('\n'));
  console.log('\nКомбинаций фильтров: ' + combos.length + ', проверок: ' + checks + ', расхождений: ' + bad + ', ошибок JS в консоли: ' + errors.length);
  if (errors.length) console.log(errors.slice(0, 5).join('\n'));
  ws.close();
  proc.kill();
  if (srv) await srv.close();
  process.exit(bad || errors.length ? 1 : 0);
})();
