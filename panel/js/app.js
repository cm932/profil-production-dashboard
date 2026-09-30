// Панель «Профиль»: состояние, фильтры, расчёт показателей, отрисовка листов, загрузка файлов, экспорт в PDF.
(function () {
  'use strict';

  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];

  // ---------- Состояние ----------
  const state = {
    journals: { downtime: null, defects: null }, // { records, fileName, errors, total, isDefault }
    filters: { from: null, to: null, shift: 'all', shop: 'all' },
    params: { shiftHours: 8, hourCost: 3000, pieceCost: 1500 },
    sheet: 'summary',
    table: { kind: 'downtime', search: '', sortKey: null, sortDir: 1 },
    heatReason: 'all'
  };

  const SHIFT_NAME = { 1: 'День', 2: 'Ночь' };

  // ---------- Форматирование ----------
  const nf = (n, d = 0) => Number(n).toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d });
  const hours = min => nf(min / 60, 1);
  const rub = v => v >= 1e6 ? nf(v / 1e6, 2) + ' млн ₽' : nf(Math.round(v / 1000)) + ' тыс. ₽';
  const ruDate = iso => { const [y, m, d] = iso.split('-'); return d + '.' + m + '.' + y; };
  const ruDateShort = iso => { const [, m, d] = iso.split('-'); return d + '.' + m; };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // Даты считаем в UTC: иначе в часовом поясе UTC+3 toISOString() сдвигает дату на день назад
  const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5) + 1;
  // Склонение: plural(94, 'случай', 'случая', 'случаев')
  const plural = (n, one, few, many) => {
    const a = Math.abs(n) % 100, b = a % 10;
    return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many;
  };

  // ---------- Хранение допущений (только удобство; без него всё работает) ----------
  function loadParams() {
    try { Object.assign(state.params, JSON.parse(localStorage.getItem('profil.params') || '{}')); } catch (e) { /* нет доступа */ }
  }
  function saveParams() {
    try { localStorage.setItem('profil.params', JSON.stringify(state.params)); } catch (e) { /* нет доступа */ }
  }

  // ---------- Данные и фильтры ----------
  const dt = () => (state.journals.downtime ? state.journals.downtime.records : []);
  const df = () => (state.journals.defects ? state.journals.defects.records : []);

  function dataBounds() {
    const dates = dt().map(r => r.date).concat(df().map(r => r.date)).sort();
    return dates.length ? { min: dates[0], max: dates[dates.length - 1] } : null;
  }

  function inPeriod(r) {
    const f = state.filters;
    return (!f.from || r.date >= f.from) && (!f.to || r.date <= f.to);
  }
  const inShift = r => state.filters.shift === 'all' || r.shift === +state.filters.shift;
  const inShop = r => state.filters.shop === 'all' || r.shop === state.filters.shop;

  function filtered() {
    return {
      dt: dt().filter(r => inPeriod(r) && inShift(r) && inShop(r)),
      df: df().filter(r => inPeriod(r) && inShift(r))
    };
  }

  function groupSum(arr, keyFn, valFn) {
    const m = new Map();
    for (const r of arr) { const k = keyFn(r); m.set(k, (m.get(k) || 0) + valFn(r)); }
    return m;
  }

  // ---------- Расчёт показателей сводки ----------
  function computeSummary() {
    const { dt: D, df: B } = filtered();
    const f = state.filters, p = state.params;

    const lossMin = D.filter(r => !r.planned).reduce((s, r) => s + r.min, 0);
    const plannedMin = D.filter(r => r.planned).reduce((s, r) => s + r.min, 0);
    const pieces = B.reduce((s, r) => s + r.qty, 0);

    // Фонд времени: станки (из справочника журнала с учётом цеха) × дни периода × число смен × длительность смены
    const machines = new Set(dt().filter(inShop).map(r => r.machine)).size;
    const days = f.from && f.to ? daysBetween(f.from, f.to) : 0;
    const shifts = f.shift === 'all' ? 2 : 1;
    const fundMin = machines * days * shifts * p.shiftHours * 60;
    const availability = fundMin ? (fundMin - lossMin - plannedMin) / fundMin : 0;

    const lossRub = lossMin / 60 * p.hourCost;
    const defectRub = pieces * p.pieceCost;

    return {
      D, B, lossMin, plannedMin, pieces, machines, days, shifts, fundMin, availability, lossRub, defectRub,
      defectCases: B.length, orders: new Set(B.map(r => r.order).filter(Boolean)).size
    };
  }

  // ---------- Отрисовка ----------
  function filterCaption() {
    const f = state.filters;
    const period = f.from && f.to ? ruDate(f.from) + ' — ' + ruDate(f.to) : 'весь период';
    const shift = f.shift === 'all' ? 'обе смены' : 'смена: ' + SHIFT_NAME[f.shift].toLowerCase();
    const shop = f.shop === 'all' ? 'все цеха' : f.shop.toLowerCase() + ' (простои)';
    return period + ' · ' + shift + ' · ' + shop;
  }

  function kpi(label, value, unit, sub) {
    return '<div class="kpi"><div class="kpi-label">' + label + '</div>' +
      '<div class="kpi-value">' + value + (unit ? '<small>' + unit + '</small>' : '') + '</div>' +
      '<div class="kpi-sub">' + sub + '</div></div>';
  }

  function renderSummary() {
    const s = computeSummary();
    const shiftH = state.params.shiftHours;
    $('#kpis').innerHTML = [
      kpi('Потери времени (внеплановые простои)', hours(s.lossMin), 'ч',
        '≈ ' + nf(s.lossMin / 60 / shiftH, 1) + ' смен станка · плановое ТО ещё ' + hours(s.plannedMin) + ' ч'),
      kpi('Доступность оборудования', s.fundMin ? nf(s.availability * 100, 1) : '—', '%',
        'фонд ' + nf(s.fundMin / 60) + ' станко-ч: ' + s.machines + ' ст. × ' + s.days + ' дн. × ' + s.shifts + ' см. × ' + nf(shiftH, 1) + ' ч'),
      kpi('Брак', nf(s.pieces), 'шт', s.defectCases + ' ' + plural(s.defectCases, 'случай', 'случая', 'случаев') + ' в ' + s.orders + ' ' + plural(s.orders, 'заказе', 'заказах', 'заказах')),
      kpi('Потери в деньгах (оценка)', rub(s.lossRub + s.defectRub), '',
        'простои ' + rub(s.lossRub) + ' + брак ' + rub(s.defectRub))
    ].join('');
    // Выводы и графики строятся из тех же отфильтрованных данных, что и цифры выше
    const ctx = buildCtx(s);
    const insights = Insights.build(ctx, Charts);
    const note = ctx.from && daysBetween(ctx.from, ctx.to) >= 14
      ? 'Недели считаются от конца выбранного периода (по 7 дней); неполная неделя в начале периода в сравнении не участвует.' : '';
    $('#summaryBody').innerHTML =
      '<h2 class="block-title">Что видно по данным</h2><div class="insights">' + Insights.render(insights, note) + '</div>' +
      '<h2 class="block-title">Ключевые графики</h2><div class="grid-2">' +
      chartCard('Где теряем время: причины простоев', 'внеплановые простои, часы и доля от потерь', 'cSumPareto', 260) +
      chartCard('Где возникает брак: операции и смены', 'забраковано деталей', 'cSumDefects', 260) + '</div>';
    if (s.D.some(r => !r.planned)) Charts.pareto('cSumPareto', s.D.filter(r => !r.planned));
    else $('#cSumPareto').parentNode.innerHTML = '<div class="empty">Нет простоев за выбранный период</div>';
    if (s.B.length) Charts.opsByShift('cSumDefects', s.B, shownShifts());
    else $('#cSumDefects').parentNode.innerHTML = '<div class="empty">Нет брака за выбранный период</div>';
    Insights.drawMinis(insights, Charts);
  }

  function buildCtx(s) {
    const f = state.filters;
    return {
      D: s.D, B: s.B, Dall: dt().filter(r => inPeriod(r) && inShift(r)), // Dall — без фильтра цеха: соседний передел может быть в другом цехе
      from: f.from, to: f.to, params: state.params, summary: s, util: { addDays, daysBetween }
    };
  }

  const shownShifts = () => (state.filters.shift === 'all' ? [1, 2] : [+state.filters.shift]);

  function chartCard(title, sub, id, h) {
    return '<div class="card"><h2>' + title + '</h2><div class="card-sub">' + sub + '</div><div class="chart-box" style="height:' + h + 'px"><canvas id="' + id + '"></canvas></div></div>';
  }
  const emptyCard = t => '<div class="card empty">' + t + '</div>';

  function renderDowntime() {
    const { dt: D } = filtered();
    const U = D.filter(r => !r.planned), f = state.filters;
    const el = $('#downtimeBody');
    if (!U.length) { el.innerHTML = emptyCard('Нет внеплановых простоев за выбранный период, смену и цех.'); return; }
    const machines = new Set(U.map(r => r.machine)).size;
    const reasons = [...new Set(U.map(r => r.reason))].sort();
    if (state.heatReason !== 'all' && !reasons.includes(state.heatReason)) state.heatReason = 'all';
    const HU = state.heatReason === 'all' ? U : U.filter(r => r.reason === state.heatReason);
    el.innerHTML =
      '<div class="card wide"><h2>Загрузка станков по дням</h2><div class="card-sub">внеплановые простои, минуты за день; станки отсортированы по потерям — так видно, когда именно и какой станок «встал». Выберите причину, чтобы увидеть, где она встречается</div>' +
      '<div class="chips heat-chips">' + ['all'].concat(reasons).map(r => '<button class="chip' + (r === state.heatReason ? ' on' : '') + '" data-r="' + esc(r) + '">' + (r === 'all' ? 'Все причины' : esc(r)) + '</button>').join('') + '</div>' +
      Charts.heatmap(HU, f.from, f.to, { addDays }) + '</div>' +
      '<div class="grid-2">' +
      chartCard('Парето причин', 'от главной причины к второстепенным; в подписи — часы и доля потерь, накопительная доля — в подсказке', 'cPareto', 300) +
      chartCard('Простои по станкам и причинам', 'стопка — причины, число справа — итог по станку', 'cMachines', Math.max(220, 90 + machines * 46)) + '</div>' +
      '<div class="grid-2">' +
      chartCard('Станки: день и ночь', 'внеплановые простои по сменам, часы', 'cMachShift', Math.max(220, 90 + machines * 56)) +
      '<div class="card"><h2>Плановое ТО отдельно</h2><div class="card-sub">плановое ТО — не потеря, поэтому в графики потерь не входит</div><div id="plannedBox"></div></div></div>';
    $$('.heat-chips .chip').forEach(b => b.onclick = () => { state.heatReason = b.dataset.r; renderDowntime(); });
    Charts.pareto('cPareto', U);
    Charts.machinesByReason('cMachines', U);
    Charts.machinesByShift('cMachShift', U, shownShifts());
    const P = D.filter(r => r.planned), total = P.reduce((x, r) => x + r.min, 0);
    const byM = [...groupSum(P, r => r.machine, r => r.min)].sort((a, b) => b[1] - a[1]);
    $('#plannedBox').innerHTML = total
      ? '<p class="planned-total"><b>' + hours(total) + ' ч</b> планового ТО за период (' + nf(total) + ' мин)</p><ul class="plain">' +
        byM.map(([m, v]) => '<li><b>' + esc(m) + '</b> — ' + hours(v) + ' ч</li>').join('') + '</ul>'
      : '<p class="muted">Плановых работ за выбранный период нет.</p>';
  }

  function renderDefects() {
    const { df: B } = filtered();
    const f = state.filters, el = $('#defectsBody');
    if (!B.length) { el.innerHTML = emptyCard('Нет брака за выбранный период и смену.'); return; }
    const wins = Insights.windows(f.from, f.to, { addDays, daysBetween });
    const ops = [...groupSum(B, r => r.op, r => r.qty)].sort((a, b) => b[1] - a[1]).map(x => x[0]);
    el.innerHTML =
      '<div class="grid-2">' +
      chartCard('Динамика брака по дням', 'забраковано деталей за день; цвет — смена', 'cDaily', 300) +
      chartCard('Брак по операциям и сменам', 'операция-источник, где возник дефект', 'cOps', Math.max(220, 90 + ops.length * 56)) + '</div>' +
      (wins.length >= 2
        ? '<h2 class="block-title">Недели: день и ночь по каждой операции</h2><div class="card-sub block-sub">одинаковая шкала на всех графиках, чтобы операции можно было сравнивать</div><div class="grid-4">' +
          ops.map((o, i) => '<div class="card"><h2>' + esc(o) + '</h2><div class="chart-box" style="height:200px"><canvas id="cWeek' + i + '"></canvas></div></div>').join('') + '</div>'
        : '') +
      '<div class="grid-2">' + chartCard('Типы дефектов', 'каждый тип привязан к операции-источнику (в подсказке)', 'cTypes', 240) + '</div>';

    // Дни периода без записей — нулевые столбцы, чтобы ось времени была честной
    const days = []; for (let d = f.from; d <= f.to; d = addDays(d, 1)) days.push(d);
    const dayShift = groupSum(B, r => r.date + '|' + r.shift, r => r.qty);
    Charts.stackedColumns('cDaily', days.map(d => d.slice(8) + '.' + d.slice(5, 7)), days.map(ruDate),
      shownShifts().map(s => ({ label: Charts.shiftName(s), color: Charts.shiftColor(s), data: days.map(d => dayShift.get(d + '|' + s) || 0) })));
    Charts.opsByShift('cOps', B, shownShifts());
    Charts.types('cTypes', B);

    if (wins.length >= 2) {
      const cnt = (op, s, w) => B.filter(r => r.op === op && r.shift === s && r.date >= w.from && r.date <= w.to).reduce((x, r) => x + r.qty, 0);
      const series = ops.map(o => shownShifts().map(s => ({ label: Charts.shiftName(s), color: Charts.shiftColor(s), data: wins.map(w => cnt(o, s, w)) })));
      const ymax = Math.max(1, ...series.flat().flatMap(x => x.data));
      ops.forEach((o, i) => Charts.weeklyLines('cWeek' + i, wins.map(w => w.label), wins.map(w => w.title), series[i], { ymax: Math.ceil(ymax * 1.1 / 5) * 5 }));
    }
  }

  // ---------- Лист «Данные» ----------
  const COLUMNS = {
    downtime: [
      { key: 'id', title: 'ID' }, { key: 'date', title: 'Дата', fmt: ruDate }, { key: 'machine', title: 'Станок' },
      { key: 'machineName', title: 'Наименование' }, { key: 'op', title: 'Операция' }, { key: 'shop', title: 'Цех' },
      { key: 'shift', title: 'Смена', fmt: v => SHIFT_NAME[v] }, { key: 'reason', title: 'Причина простоя' },
      { key: 'planned', title: 'Плановый', fmt: v => (v ? 'да' : 'нет') }, { key: 'min', title: 'Длительность, мин', num: true }
    ],
    defects: [
      { key: 'id', title: '№' }, { key: 'date', title: 'Дата контроля', fmt: ruDate }, { key: 'type', title: 'Тип дефекта' },
      { key: 'op', title: 'Операция-источник' }, { key: 'qty', title: 'Кол-во, шт', num: true }, { key: 'order', title: 'Заказ' },
      { key: 'shift', title: 'Смена', fmt: v => SHIFT_NAME[v] }
    ]
  };

  function renderDataTable() {
    const t = state.table, cols = COLUMNS[t.kind];
    const { dt: D, df: B } = filtered();
    let rows = t.kind === 'downtime' ? D : B;
    const q = t.search.trim().toLowerCase();
    if (q) rows = rows.filter(r => cols.some(c => String(c.fmt ? c.fmt(r[c.key]) : r[c.key]).toLowerCase().includes(q)));
    if (t.sortKey) {
      const k = t.sortKey;
      rows = rows.slice().sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * t.sortDir);
    }

    $$('#dKind button').forEach(b => b.classList.toggle('on', b.dataset.v === t.kind));
    const head = '<thead><tr>' + cols.map(c => '<th data-key="' + c.key + '"' + (c.num ? ' class="num"' : '') + '>' + c.title +
      '<span class="arr">' + (t.sortKey === c.key ? (t.sortDir > 0 ? '▲' : '▼') : '') + '</span></th>').join('') + '</tr></thead>';
    const body = '<tbody>' + rows.map(r => '<tr>' + cols.map(c =>
      '<td' + (c.num ? ' class="num"' : '') + '>' + esc(c.fmt ? c.fmt(r[c.key]) : r[c.key]) + '</td>').join('') + '</tr>').join('') + '</tbody>';
    $('#dTable').innerHTML = head + body;

    // Итоги по видимым строкам — чтобы любую цифру панели можно было сверить вручную
    const j = state.journals[t.kind];
    let totals = 'Показано записей: <b>' + nf(rows.length) + '</b> из ' + nf(j ? j.records.length : 0);
    if (t.kind === 'downtime') {
      const all = rows.reduce((s, r) => s + r.min, 0), loss = rows.filter(r => !r.planned).reduce((s, r) => s + r.min, 0);
      totals += ' · Длительность: <b>' + nf(all) + ' мин</b> (' + hours(all) + ' ч), из них внеплановые <b>' + nf(loss) + ' мин</b> (' + hours(loss) + ' ч)';
    } else {
      totals += ' · Забраковано: <b>' + nf(rows.reduce((s, r) => s + r.qty, 0)) + ' шт</b>';
    }
    if (j) totals += ' · Источник: ' + esc(j.fileName);
    $('#dTotals').innerHTML = totals;
  }

  // ---------- Фильтры ----------
  function buildFilterControls() {
    const b = dataBounds();
    const f = state.filters;
    if (b) {
      for (const id of ['#fFrom', '#fTo']) { $(id).min = b.min; $(id).max = b.max; }
      if (!f.from || f.from < b.min || f.from > b.max) f.from = b.min;
      if (!f.to || f.to > b.max || f.to < b.min) f.to = b.max;
    }

    // Быстрые периоды: весь период и недели по 7 дней от начала данных
    const presets = [];
    if (b) {
      presets.push({ label: 'Весь период', from: b.min, to: b.max });
      for (let start = b.min, i = 1; start <= b.max; start = addDays(start, 7), i++) {
        const end = addDays(start, 6) > b.max ? b.max : addDays(start, 6);
        presets.push({ label: 'Нед. ' + i, title: ruDate(start) + ' — ' + ruDate(end), from: start, to: end });
      }
    }
    $('#fPresets').innerHTML = presets.map((p, i) =>
      '<button class="chip" data-i="' + i + '"' + (p.title ? ' title="' + p.title + '"' : '') + '>' + p.label + '</button>').join('');
    $$('#fPresets .chip').forEach(btn => btn.onclick = () => {
      const p = presets[+btn.dataset.i]; f.from = p.from; f.to = p.to; renderAll();
    });
    $('#fPresets').presets = presets;

    const shops = [...new Set(dt().map(r => r.shop).filter(Boolean))].sort();
    if (f.shop !== 'all' && !shops.includes(f.shop)) f.shop = 'all';
    $('#fShop').innerHTML = '<button data-v="all">Все</button>' + shops.map(s => '<button data-v="' + esc(s) + '">' + esc(s) + '</button>').join('');
    $$('#fShop button').forEach(btn => btn.onclick = () => { f.shop = btn.dataset.v; renderAll(); });
  }

  function syncFilterControls() {
    const f = state.filters;
    $('#fFrom').value = f.from || '';
    $('#fTo').value = f.to || '';
    $$('#fShift button').forEach(b => b.classList.toggle('on', b.dataset.v === String(f.shift)));
    $$('#fShop button').forEach(b => b.classList.toggle('on', b.dataset.v === f.shop));
    const presets = $('#fPresets').presets || [];
    $$('#fPresets .chip').forEach(btn => {
      const p = presets[+btn.dataset.i];
      btn.classList.toggle('on', p.from === f.from && p.to === f.to);
    });
    $$('.filter-caption').forEach(el => el.textContent = filterCaption());
  }

  // ---------- Источник данных и отчёт о загрузке ----------
  function renderSourceInfo() {
    const part = (label, j) => j ? label + ': ' + esc(j.fileName) + ' (' + nf(j.records.length) + ' зап.)' + (j.isDefault ? '' : ' — загружен') : label + ': нет данных';
    $('#sourceInfo').innerHTML = part('Простои', state.journals.downtime) + '<br>' + part('Брак', state.journals.defects);
    const isDefault = ['downtime', 'defects'].every(k => state.journals[k] && state.journals[k].isDefault);
    $('#resetBtn').hidden = isDefault;
  }

  // Если журналы охватывают разные периоды, общий период и доступность станков будут считаться по «дырявым» данным — предупреждаем
  function periodMismatch() {
    const b = k => { const r = state.journals[k]; if (!r || !r.records.length) return null; const d = r.records.map(x => x.date).sort(); return { from: d[0], to: d[d.length - 1] }; };
    const a = b('downtime'), c = b('defects');
    if (!a || !c || (a.from === c.from && a.to === c.to)) return '';
    return '<b>Внимание:</b> периоды журналов не совпадают — простои ' + ruDate(a.from) + ' — ' + ruDate(a.to) + ', брак ' + ruDate(c.from) + ' — ' + ruDate(c.to) +
      '. Панель показывает общий период, поэтому доступность станков и сравнения по неделям могут быть неточными: сузьте фильтр «Период» до дат, где есть оба журнала.';
  }

  function showReport(results, failures) {
    const el = $('#loadReport');
    const lines = [];
    let cls = 'ok';
    for (const r of results) {
      let line = '<b>' + r.title + '</b> из «' + esc(r.fileName) + '»: загружено ' + r.records.length + ' из ' + r.total + ' строк.';
      if (r.errors.length) {
        cls = 'warn';
        line += ' Пропущены строки с ошибками:<ul>' + r.errors.slice(0, 10).map(e => '<li>' + esc(e) + '</li>').join('') +
          (r.errors.length > 10 ? '<li>…и ещё ' + (r.errors.length - 10) + '</li>' : '') + '</ul>';
      }
      if (!r.total) { cls = 'warn'; line += ' В файле нет строк с данными (только заголовок).'; }
      lines.push(line);
    }
    const mismatch = periodMismatch();
    if (mismatch) { cls = 'warn'; lines.push(mismatch); }
    for (const f of failures) { cls = results.length ? 'warn' : 'err'; lines.push('<b>Не загружено:</b> ' + esc(f)); }
    el.className = 'load-report ' + cls;
    el.innerHTML = lines.join('<br>') + ' <button class="btn btn-ghost small" type="button" id="closeReport">Скрыть</button>';
    el.hidden = false;
    $('#closeReport').onclick = () => { el.hidden = true; };
  }

  function applyResults(results, isDefault) {
    for (const r of results) {
      state.journals[r.kind] = { records: r.records, fileName: r.fileName, errors: r.errors, total: r.total, isDefault };
    }
    state.filters.from = state.filters.to = null; // новый период — по границам новых данных
    buildFilterControls();
    renderAll();
  }

  function loadDefaults() {
    const results = [];
    for (const f of window.DEFAULT_FILES || []) {
      try { results.push(DataLayer.readDefaultFile(f)); } catch (e) { console.error(e); }
    }
    applyResults(results, true);
  }

  async function handleUpload(files) {
    const results = [], failures = [];
    for (const file of files) {
      try { results.push(await DataLayer.readFile(file)); } catch (e) { failures.push(e.message); }
    }
    if (results.length) applyResults(results, false);
    showReport(results, failures);
  }

  // ---------- Экспорт листа в PDF ----------
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // Режим экспорта: светлая тема (для печати), без кнопок и прокруток; после — всё возвращается как было
  async function withExportMode(fn) {
    const root = document.documentElement;
    const prevTheme = root.getAttribute('data-theme');
    root.setAttribute('data-theme', 'light');
    document.body.classList.add('exporting');
    // Допущения (ставки, длительность смены) в PDF раскрываем: от них зависят рубли и доступность
    const details = [...document.querySelectorAll('details')].map(d => [d, d.open]);
    details.forEach(([d]) => { d.open = true; });
    try {
      renderAll(); // перерисовать графики в светлой теме
      await sleep(350);
      return await fn();
    } finally {
      details.forEach(([d, o]) => { d.open = o; });
      document.body.classList.remove('exporting');
      if (prevTheme) root.setAttribute('data-theme', prevTheme); else root.removeAttribute('data-theme');
      renderAll();
    }
  }

  // Делит снимок листа на страницы A4 (альбомная). Разрыв ставится только между блоками —
  // карточка, вывод, строка таблицы не режутся пополам, кроме блоков выше страницы (они режутся по необходимости).
  async function renderSheetPages(sheetEl) {
    const title = sheetEl.dataset.title;
    const canvas = await html2canvas(sheetEl, { scale: 2, backgroundColor: '#f9f9f7', useCORS: true, logging: false });
    const rect0 = sheetEl.getBoundingClientRect();
    const k = canvas.width / rect0.width;                                  // css-пиксели → пиксели холста
    const A4W = 297, A4H = 210, M = 8;
    const mmPerPx = (A4W - 2 * M) / canvas.width;
    const footerPx = 44;
    const contentPx = Math.floor((A4H - 2 * M) / mmPerPx) - footerPx;      // высота полезной части страницы
    const blocks = [...sheetEl.querySelectorAll('.kpi, .insight, .card, .block-title, .block-sub, .sheet-head, .table-totals, tbody tr, thead')]
      .map(el => { const r = el.getBoundingClientRect(); return { t: (r.top - rect0.top) * k, b: (r.bottom - rect0.top) * k }; })
      .filter(b => b.b - b.t > 1 && b.b - b.t < contentPx * 0.95);

    // Шапка таблицы повторяется на каждой странице, кроме первой (там она и так есть)
    const th = sheetEl.querySelector('thead');
    const head = th ? (() => { const r = th.getBoundingClientRect(); return { t: Math.floor((r.top - rect0.top) * k), h: Math.ceil(r.height * k) }; })() : null;
    const room = first => (head && !first ? contentPx - head.h : contentPx);

    const cuts = [0];
    let y0 = 0;
    while (canvas.height - y0 > room(y0 === 0)) {
      let y = y0 + room(y0 === 0);
      for (let guard = 0; guard < 60; guard++) {
        const straddle = blocks.filter(b => b.t > y0 + 1 && b.t < y - 1 && b.b > y + 1).sort((a, b) => a.t - b.t)[0];
        if (!straddle) break;
        y = straddle.t - 8; // небольшой зазор, чтобы кромка следующего блока не попала на эту страницу
      }
      if (y < y0 + contentPx * 0.3) y = y0 + room(y0 === 0); // страница получилась бы почти пустой — режем как есть
      y = Math.floor(y);
      cuts.push(y); y0 = y;
    }
    cuts.push(canvas.height);

    const caption = filterCaption();
    const stamp = new Date().toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
    const n = cuts.length - 1;
    const pages = [];
    for (let i = 0; i < n; i++) {
      const sliceH = cuts[i + 1] - cuts[i];
      const withHead = head && i > 0;
      const top = withHead ? head.h : 0;
      const h = sliceH + top;
      const pg = document.createElement('canvas');
      pg.width = canvas.width; pg.height = h + footerPx;
      const c = pg.getContext('2d');
      c.fillStyle = '#f9f9f7'; c.fillRect(0, 0, pg.width, pg.height);
      if (withHead) c.drawImage(canvas, 0, head.t, canvas.width, head.h, 0, 0, canvas.width, head.h);
      c.drawImage(canvas, 0, cuts[i], canvas.width, sliceH, 0, top, canvas.width, sliceH);
      c.strokeStyle = '#e1e0d9'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(0, h + 8); c.lineTo(pg.width, h + 8); c.stroke();
      c.fillStyle = '#52514e'; c.font = '22px system-ui, "Segoe UI", sans-serif'; c.textBaseline = 'middle';
      c.textAlign = 'left'; c.fillText('Фабрика «Профиль» · ' + title + ' · ' + caption, 0, h + 8 + footerPx / 2);
      c.textAlign = 'right'; c.fillText('сформировано ' + stamp + ' · стр. ' + (i + 1) + ' из ' + n, pg.width, h + 8 + footerPx / 2);
      pages.push(pg);
    }
    return { pages, mmPerPx, margin: M, title };
  }

  async function exportSheetPDF(sheetEl, btn) {
    btn.disabled = true; btn.textContent = 'Готовлю PDF…';
    try {
      const { pages, mmPerPx, margin, title } = await withExportMode(() => renderSheetPages(sheetEl));
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      pages.forEach((pg, i) => {
        if (i) pdf.addPage();
        pdf.addImage(pg.toDataURL('image/jpeg', 0.92), 'JPEG', margin, margin, pg.width * mmPerPx, pg.height * mmPerPx);
      });
      pdf.setProperties({ title: 'Фабрика «Профиль» — ' + title + ' · ' + filterCaption() });
      pdf.save('Профиль_' + title + '_' + (state.filters.from || '') + '_' + (state.filters.to || '') + '.pdf');
    } catch (e) {
      console.error(e);
      alert('Не удалось сформировать PDF: ' + e.message);
    } finally {
      btn.disabled = false; btn.textContent = 'Скачать PDF';
    }
  }

  // ---------- Навигация ----------
  function showSheet(name) {
    state.sheet = name;
    $$('.tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.sheet === name)));
    $$('.sheet').forEach(s => s.classList.toggle('active', s.id === 'sheet-' + name));
    if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
    renderAll();
  }

  function renderAll() {
    Charts.refreshTheme();
    Charts.destroyIn(null);
    syncFilterControls();
    renderSourceInfo();
    // Графики строим только для открытого листа: у canvas на скрытом листе нулевой размер
    if (state.sheet === 'summary') renderSummary();
    else if (state.sheet === 'downtime') renderDowntime();
    else if (state.sheet === 'defects') renderDefects();
    else renderDataTable();
  }

  // ---------- Инициализация ----------
  function init() {
    loadParams();
    $('#pShift').value = state.params.shiftHours;
    $('#pHour').value = state.params.hourCost;
    $('#pPiece').value = state.params.pieceCost;
    const onParam = () => {
      const sh = +$('#pShift').value, h = +$('#pHour').value, pc = +$('#pPiece').value;
      if (sh > 0 && sh <= 24) state.params.shiftHours = sh;
      if (h >= 0) state.params.hourCost = h;
      if (pc >= 0) state.params.pieceCost = pc;
      saveParams(); renderAll();
    };
    ['#pShift', '#pHour', '#pPiece'].forEach(id => $(id).addEventListener('input', onParam));

    $$('.tab').forEach(t => t.onclick = () => showSheet(t.dataset.sheet));
    $$('#fShift button').forEach(b => b.onclick = () => { state.filters.shift = b.dataset.v; renderAll(); });
    $('#fFrom').onchange = e => { if (e.target.value) { state.filters.from = e.target.value; if (state.filters.to < e.target.value) state.filters.to = e.target.value; } renderAll(); };
    $('#fTo').onchange = e => { if (e.target.value) { state.filters.to = e.target.value; if (state.filters.from > e.target.value) state.filters.from = e.target.value; } renderAll(); };

    $$('#dKind button').forEach(b => b.onclick = () => { state.table.kind = b.dataset.v; state.table.sortKey = null; renderDataTable(); });
    $('#dSearch').oninput = e => { state.table.search = e.target.value; renderDataTable(); };
    $('#dTable').onclick = e => {
      const th = e.target.closest('th'); if (!th) return;
      const t = state.table;
      if (t.sortKey === th.dataset.key) t.sortDir = -t.sortDir; else { t.sortKey = th.dataset.key; t.sortDir = 1; }
      renderDataTable();
    };

    $('#fileInput').onchange = e => { handleUpload([...e.target.files]); e.target.value = ''; };
    $('#resetBtn').onclick = () => { loadDefaults(); $('#loadReport').hidden = true; };
    $$('.pdf-btn').forEach(b => b.onclick = () => exportSheetPDF(b.closest('.sheet'), b));

    loadDefaults();
    const fromHash = () => { const h = location.hash.slice(1); return ['summary', 'downtime', 'defects', 'data'].includes(h) ? h : 'summary'; };
    showSheet(fromHash());
    window.addEventListener('hashchange', () => { if (fromHash() !== state.sheet) showSheet(fromHash()); });
    // Смена системной темы — перерисовать графики в новых цветах
    if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', renderAll);
  }

  // Доступ для следующих частей (графики) и для ручной проверки в консоли
  window.App = { debugPages: async name => { const el = document.querySelector('#sheet-' + name); const r = await withExportMode(() => renderSheetPages(el)); return r.pages.map(p => p.toDataURL('image/png')); }, state, filtered, computeSummary, groupSum, renderAll, util: { addDays, daysBetween, plural }, fmt: { nf, hours, rub, ruDate, ruDateShort } };

  document.addEventListener('DOMContentLoaded', init);
})();
