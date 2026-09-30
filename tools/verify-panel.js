// Независимая сверка панели с исходными файлами.
// Исходные журналы разбираются здесь своим кодом (не кодом панели), затем для каждой комбинации фильтров
// сравниваются ожидаемые значения с тем, что показывает панель (KPI, суммы всех графиков, тепловая карта, лист «Данные»).
// Запуск (нужен Microsoft Edge): node tools/verify-panel.js
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
const PANEL_URL = 'file:///' + path.join(ROOT, 'panel', 'index.html').replace(/\\/g, '/');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- 1. Независимое чтение исходных файлов ----------
const csv = fs.readFileSync(path.join(ROOT, 'Файлы для проекта', 'clean_01_prostoi.csv'), 'utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/);
const h1 = csv[0].split(';');
const D = csv.slice(1).map(l => { const v = l.split(';'), o = {}; h1.forEach((k, i) => o[k] = v[i]); return { date: o['Дата'], shift: +o['Смена'], shop: o['Цех'], planned: o['Плановый простой'] === 'да', min: +o['Длительность, мин'] }; });

const tmp = path.join(require('os').tmpdir(), 'profil-verify-xlsx');
fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true });
require('child_process').execSync(`powershell -NoProfile -Command "Add-Type -A System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::ExtractToDirectory('${path.join(ROOT, 'Файлы для проекта', 'clean_02_brak.xlsx').replace(/'/g, "''")}', '${tmp}')"`);
const xml = fs.readFileSync(path.join(tmp, 'xl', 'worksheets', 'sheet1.xml'), 'utf8');
const dec = s => s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');
const rows = [...xml.matchAll(/<row [^>]*>(.*?)<\/row>/g)].map(m => [...m[1].matchAll(/<c r="[A-Z]+\d+"[^>]*?(?:\/>|>(.*?)<\/c>)/g)].map(c => { const b = c[1] || ''; const t = b.match(/<t[^>]*>(.*?)<\/t>/), v = b.match(/<v>(.*?)<\/v>/); return dec(t ? t[1] : v ? v[1] : ''); }));
const h2 = rows[0];
const B = rows.slice(1).map(r => { const o = {}; h2.forEach((k, i) => o[k] = r[i]); return { date: o['Дата контроля'], shift: +o['Смена'], qty: +o['Кол-во, шт'], order: o['Заказ'] }; });

// ---------- 2. Ожидаемые значения для комбинации фильтров ----------
const sum = (a, f) => a.reduce((s, r) => s + f(r), 0);
function expected(c) {
  const inP = r => r.date >= c.from && r.date <= c.to;
  const d = D.filter(r => inP(r) && (c.shift === 'all' || r.shift === +c.shift) && (c.shop === 'all' || r.shop === c.shop));
  const b = B.filter(r => inP(r) && (c.shift === 'all' || r.shift === +c.shift));
  return {
    rows: d.length, totalMin: sum(d, r => r.min), lossMin: sum(d.filter(r => !r.planned), r => r.min), plannedMin: sum(d.filter(r => r.planned), r => r.min),
    defectRows: b.length, pieces: sum(b, r => r.qty), orders: new Set(b.map(r => r.order)).size
  };
}

const periods = [
  { name: 'весь период', from: '2026-05-19', to: '2026-06-15' },
  { name: 'неделя 1', from: '2026-05-19', to: '2026-05-25' },
  { name: 'неделя 2', from: '2026-05-26', to: '2026-06-01' },
  { name: 'неделя 3', from: '2026-06-02', to: '2026-06-08' },
  { name: 'неделя 4', from: '2026-06-09', to: '2026-06-15' },
  { name: 'произвольный 25.05–03.06', from: '2026-05-25', to: '2026-06-03' }
];
const combos = [];
for (const p of periods) for (const shift of ['all', '1', '2']) for (const shop of ['all', 'Цех 1', 'Цех 2']) combos.push({ ...p, shift, shop });

// ---------- 3. Управление браузером ----------
(async () => {
  const prof = path.join(tmp, 'edge-profile');
  const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--remote-debugging-port=9444', '--user-data-dir=' + prof, '--window-size=1400,1000', 'about:blank'], { stdio: 'ignore' });
  let list;
  for (let i = 0; i < 60; i++) { try { list = await (await fetch('http://127.0.0.1:9444/json/list')).json(); if (list.length) break; } catch (e) { /* ждём запуск */ } await sleep(200); }
  const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const pending = {}; const errors = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending[m.id]) { pending[m.id](m); delete pending[m.id]; }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails)); return r.result.result.value; };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: PANEL_URL }); await sleep(1500);

  const chartSum = `(id => { const c = Chart.instances ? Object.values(Chart.instances).find(x => x.canvas.id === id) : null; return c ? Math.round(c.data.datasets.reduce((s, d) => s + d.data.reduce((a, b) => a + b, 0), 0) * 1000) / 1000 : 0; })`;
  let bad = 0, checks = 0;
  const lines = [];

  for (const c of combos) {
    const e = expected(c);
    // фильтры — через настоящие элементы управления
    await ev(`(() => {
      const set = (id, v) => { const el = document.querySelector(id); el.value = v; el.dispatchEvent(new Event('change')); };
      set('#fFrom', '${c.from}'); set('#fTo', '${c.to}');
      document.querySelector('#fShift button[data-v="${c.shift}"]').click();
      document.querySelector('#fShop button[data-v="${c.shop}"]').click();
    })()`);
    const got = {};
    const tab = async n => { await ev(`document.querySelector('.tab[data-sheet="${n}"]').click()`); await sleep(120); };

    await tab('summary');
    Object.assign(got, JSON.parse(await ev(`(() => { const s = App.computeSummary(); const cs = ${chartSum};
      return JSON.stringify({ lossMin: s.lossMin, plannedMin: s.plannedMin, pieces: s.pieces, defectRows: s.defectCases, orders: s.orders,
        sumPareto_min: Math.round(cs('cSumPareto') * 60), sumDefects: cs('cSumDefects') }); })()`)));

    await tab('downtime');
    Object.assign(got, JSON.parse(await ev(`(() => { const cs = ${chartSum};
      const heat = [...document.querySelectorAll('.hm-cell:not(.hm-zero)')].reduce((s, e) => s + (parseInt(e.textContent) || 0), 0);
      const pl = document.querySelector('#plannedBox .planned-total'); const plm = pl ? +pl.textContent.replace(/\\s|\\u00a0/g, '').match(/\\((\\d+)мин\\)/)[1] : 0;
      return JSON.stringify({ pareto_min: Math.round(cs('cPareto') * 60), machines_min: Math.round(cs('cMachines') * 60), machShift_min: Math.round(cs('cMachShift') * 60), heat_min: heat, plannedBox_min: plm }); })()`)));

    await tab('defects');
    Object.assign(got, JSON.parse(await ev(`(() => { const cs = ${chartSum};
      return JSON.stringify({ daily: cs('cDaily'), ops: cs('cOps'), types: cs('cTypes'), weeks: cs('cWeek0') + cs('cWeek1') + cs('cWeek2') + cs('cWeek3') + cs('cWeek4') }); })()`)));

    await tab('data');
    let dtot = { rows: 0, totalMin: 0, lossMin: 0 };
    for (const kind of ['downtime', 'defects']) {
      await ev(`document.querySelector('#dKind button[data-v="${kind}"]').click()`);
      const t = await ev(`document.querySelector('#dTotals').textContent.replace(/\\u00a0/g, '')`);
      if (kind === 'downtime') {
        const m = t.match(/Показано записей: (\d+).*Длительность: (\d+) мин.*внеплановые (\d+) мин/);
        dtot = m ? { rows: +m[1], totalMin: +m[2], lossMin: +m[3] } : dtot;
      } else {
        const m = t.match(/Показано записей: (\d+).*Забраковано: (\d+) шт/);
        got.data_defectRows = m ? +m[1] : 0; got.data_pieces = m ? +m[2] : 0;
      }
    }
    got.data_rows = dtot.rows; got.data_totalMin = dtot.totalMin; got.data_lossMin = dtot.lossMin;
    await ev(`document.querySelector('#dKind button[data-v="downtime"]').click()`);

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
      ['Данные: записей брака', got.data_defectRows, e.defectRows], ['Данные: брак, шт', got.data_pieces, e.pieces]
    ];
    if (fullWeeks % 7 === 0 && fullWeeks >= 14) pairs.push(['Брак: по неделям', got.weeks, e.pieces]); // недели считаются только целыми
    const fails = pairs.filter(([, a, b]) => a !== b);
    checks += pairs.length; bad += fails.length;
    lines.push((fails.length ? 'FAIL ' : 'ok   ') + c.name + ' | смена ' + c.shift + ' | ' + c.shop + ' | потери ' + e.lossMin + ' мин, брак ' + e.pieces + ' шт' +
      fails.map(([n, a, b]) => '\n       ✗ ' + n + ': панель ' + a + ', исходные данные ' + b).join(''));
  }

  console.log(lines.join('\n'));
  console.log('\nКомбинаций фильтров: ' + combos.length + ', проверок: ' + checks + ', расхождений: ' + bad + ', ошибок JS в консоли: ' + errors.length);
  if (errors.length) console.log(errors.slice(0, 5).join('\n'));
  ws.close(); proc.kill();
  process.exit(bad || errors.length ? 1 : 0);
})();
