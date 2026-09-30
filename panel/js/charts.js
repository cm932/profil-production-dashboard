// Графики панели (Chart.js + тепловая карта на HTML). Цвета берутся из CSS-переменных, поэтому работают в светлой и тёмной теме.
(function () {
  'use strict';

  const registry = new Map(); // id canvas → экземпляр Chart
  let T = null;               // текущая тема (цвета)

  // Сущность ↔ цвет закреплены, чтобы фильтр не перекрашивал оставшиеся ряды
  // Причины занимают слоты 3–7 палитры: слоты 1–2 (синий/оранжевый) отданы сменам, чтобы один цвет не значил разное
  const REASON_ORDER = ['Ожидание заготовок', 'Нет материала', 'Нет оператора', 'Переналадка', 'Поломка'];
  const REASON_SLOT0 = 2;
  const extraReasons = [];
  const NEUTRAL_REASONS = ['Прочее', 'Плановое ТО'];

  const nf = (n, d = 0) => Number(n).toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d });
  const hrs = min => nf(min / 60, 1);

  function refreshTheme() {
    const cs = getComputedStyle(document.documentElement);
    const v = n => cs.getPropertyValue(n).trim();
    T = {
      surface: v('--surface'), surface2: v('--surface-2'), text: v('--text'), text2: v('--text-2'), muted: v('--muted'),
      grid: v('--grid'), axis: v('--axis'), border: v('--border'), neutral: v('--neutral'),
      series: [1, 2, 3, 4, 5, 6, 7, 8].map(i => v('--series-' + i)), font: getComputedStyle(document.body).fontFamily
    };
    Chart.defaults.font.family = T.font;
    Chart.defaults.font.size = 12;
    Chart.defaults.color = T.text2;
    Chart.defaults.animation = false; // без анимации: график сразу готов для PDF и скриншота
    Chart.defaults.responsive = true;
    Chart.defaults.maintainAspectRatio = false;
    return T;
  }

  function reasonColor(reason) {
    if (NEUTRAL_REASONS.includes(reason)) return T.neutral;
    let i = REASON_ORDER.indexOf(reason);
    if (i < 0) {
      if (!extraReasons.includes(reason)) extraReasons.push(reason);
      i = REASON_ORDER.length + extraReasons.indexOf(reason);
    }
    i += REASON_SLOT0;
    return i < T.series.length ? T.series[i] : T.neutral;
  }
  // День — оранжевый (тёплый), ночь — синий (холодный): пара из соседних проверенных слотов палитры
  const shiftColor = s => (s === 1 ? T.series[1] : T.series[0]);
  const shiftName = s => (s === 1 ? 'День' : 'Ночь');

  function destroyIn(el) {
    for (const [id, ch] of registry) {
      if (!el || !document.body.contains(ch.canvas) || el.contains(ch.canvas)) { ch.destroy(); registry.delete(id); }
    }
  }
  function make(id, cfg) {
    const el = document.getElementById(id);
    if (!el) return null;
    if (registry.has(id)) registry.get(id).destroy();
    const ch = new Chart(el, cfg);
    registry.set(id, ch);
    return ch;
  }

  // Подписи на концах столбцов: mode 'each' — у каждого столбца, 'stack' — суммарно у конца стопки
  const endLabels = {
    id: 'endLabels',
    afterDatasetsDraw(chart, args, opts) {
      if (!opts || !opts.fmt) return;
      const ctx = chart.ctx, horiz = chart.options.indexAxis === 'y';
      ctx.save();
      ctx.font = '12px ' + T.font; ctx.fillStyle = T.text2;
      const put = (text, el, pos) => {
        if (horiz) { ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(text, pos + 6, el.y); }
        else { ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(text, el.x, pos - 5); }
      };
      const n = chart.data.labels.length;
      if (opts.mode === 'stack') {
        for (let i = 0; i < n; i++) {
          let best = null, bestEl = null, total = 0;
          chart.data.datasets.forEach((ds, di) => {
            if (!chart.isDatasetVisible(di)) return;
            const val = ds.data[i] || 0; total += val;
            const el = chart.getDatasetMeta(di).data[i];
            if (!el || !(val > 0)) return;
            const pos = horiz ? el.x : el.y;
            if (best == null || (horiz ? pos > best : pos < best)) { best = pos; bestEl = el; }
          });
          if (bestEl && total > 0) put(opts.fmt(total, i), bestEl, best);
        }
      } else {
        chart.data.datasets.forEach((ds, di) => {
          if (!chart.isDatasetVisible(di)) return;
          chart.getDatasetMeta(di).data.forEach((el, i) => {
            const val = ds.data[i];
            if (val > 0) put(opts.fmt(val, i, di), el, horiz ? el.x : el.y);
          });
        });
      }
      ctx.restore();
    }
  };

  // Подпись последней точки линии (выборочная прямая подпись вместо числа на каждой точке)
  const lastLabels = {
    id: 'lastLabels',
    afterDatasetsDraw(chart, args, opts) {
      if (!opts || !opts.fmt) return;
      const ctx = chart.ctx; ctx.save();
      ctx.font = '600 12px ' + T.font; ctx.fillStyle = T.text; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      chart.data.datasets.forEach((ds, di) => {
        if (!chart.isDatasetVisible(di)) return;
        const pts = chart.getDatasetMeta(di).data, last = pts[pts.length - 1];
        if (last) ctx.fillText(opts.fmt(ds.data[ds.data.length - 1]), last.x + 9, last.y);
      });
      ctx.restore();
    }
  };

  function scales(horiz, { stacked = false, yTitle = '', tickFmt, max, integer = false } = {}) {
    const cat = { stacked, grid: { display: false }, border: { color: T.axis }, ticks: { color: T.text2, autoSkip: true, maxRotation: 0 } };
    const val = {
      stacked, beginAtZero: true, max, grid: { color: T.grid, lineWidth: 1 }, border: { display: false },
      ticks: { color: T.muted, callback: tickFmt, precision: integer ? 0 : undefined },
      title: { display: !!yTitle, text: yTitle, color: T.muted }
    };
    return horiz ? { y: cat, x: val } : { x: cat, y: val };
  }

  function tooltip(extra = {}) {
    return Object.assign({
      backgroundColor: T.surface, titleColor: T.text, bodyColor: T.text2, borderColor: T.border, borderWidth: 1,
      padding: 10, boxPadding: 4, usePointStyle: true
    }, extra);
  }
  const legend = (show = true) => ({
    display: show, position: 'top', align: 'start',
    labels: { color: T.text2, usePointStyle: true, pointStyle: 'rectRounded', boxWidth: 10, boxHeight: 10, padding: 14 }
  });
  const barRadius = horiz => (horiz ? { topRight: 4, bottomRight: 4 } : { topLeft: 4, topRight: 4 });

  const sumBy = (arr, kf, vf) => { const m = new Map(); for (const r of arr) { const k = kf(r); m.set(k, (m.get(k) || 0) + vf(r)); } return m; };

  // ============ Простои ============

  function pareto(id, U) {
    const rows = [...sumBy(U, r => r.reason, r => r.min)].sort((a, b) => b[1] - a[1]);
    const total = rows.reduce((s, r) => s + r[1], 0);
    let cum = 0; const cumShare = rows.map(r => (cum += r[1]) / total * 100);
    make(id, {
      type: 'bar',
      data: { labels: rows.map(r => r[0]), datasets: [{ data: rows.map(r => r[1] / 60), backgroundColor: rows.map(r => reasonColor(r[0])), borderRadius: barRadius(true), maxBarThickness: 24 }] },
      options: {
        indexAxis: 'y', layout: { padding: { right: 96 } }, scales: scales(true, { tickFmt: v => nf(v) + ' ч' }),
        plugins: {
          legend: legend(false),
          endLabels: { mode: 'each', fmt: (v, i) => nf(v, 1) + ' ч · ' + nf(rows[i][1] / total * 100) + '%' },
          tooltip: tooltip({ callbacks: {
            label: c => ' ' + nf(rows[c.dataIndex][1]) + ' мин (' + nf(c.parsed.x, 1) + ' ч), ' + nf(rows[c.dataIndex][1] / total * 100, 1) + '% потерь',
            afterLabel: c => ' Накопительно: ' + nf(cumShare[c.dataIndex], 1) + '%'
          } })
        }
      },
      plugins: [endLabels]
    });
  }

  function machinesByReason(id, U) {
    const opOf = {}; U.forEach(r => { opOf[r.machine] = r.op; });
    const totals = sumBy(U, r => r.machine, r => r.min);
    const machines = [...totals].sort((a, b) => b[1] - a[1]).map(x => x[0]);
    const reasons = [...new Set(U.map(r => r.reason))];
    reasons.sort((a, b) => { const ia = REASON_ORDER.indexOf(a), ib = REASON_ORDER.indexOf(b); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); });
    const grid = sumBy(U, r => r.machine + '|' + r.reason, r => r.min);
    make(id, {
      type: 'bar',
      data: {
        labels: machines.map(m => m + ' · ' + (opOf[m] || '').toLowerCase()),
        datasets: reasons.map(re => ({
          label: re, data: machines.map(m => (grid.get(m + '|' + re) || 0) / 60), backgroundColor: reasonColor(re),
          borderColor: T.surface, borderWidth: 1, borderRadius: 3, maxBarThickness: 24
        }))
      },
      options: {
        indexAxis: 'y', layout: { padding: { right: 68 } }, scales: scales(true, { stacked: true, tickFmt: v => nf(v) + ' ч' }),
        plugins: {
          legend: legend(true),
          endLabels: { mode: 'stack', fmt: v => nf(v, 1) + ' ч' },
          tooltip: tooltip({ callbacks: { label: c => ' ' + c.dataset.label + ': ' + nf(c.parsed.x * 60) + ' мин (' + nf(c.parsed.x, 1) + ' ч)' } })
        }
      },
      plugins: [endLabels]
    });
  }

  function machinesByShift(id, U, shifts) {
    const totals = sumBy(U, r => r.machine, r => r.min);
    const machines = [...totals].sort((a, b) => b[1] - a[1]).map(x => x[0]);
    const grid = sumBy(U, r => r.machine + '|' + r.shift, r => r.min);
    make(id, {
      type: 'bar',
      data: {
        labels: machines,
        datasets: shifts.map(s => ({
          label: shiftName(s), data: machines.map(m => (grid.get(m + '|' + s) || 0) / 60), backgroundColor: shiftColor(s),
          borderRadius: barRadius(true), maxBarThickness: 16
        }))
      },
      options: {
        indexAxis: 'y', layout: { padding: { right: 68 } }, scales: scales(true, { tickFmt: v => nf(v) + ' ч' }),
        plugins: {
          legend: legend(true), endLabels: { mode: 'each', fmt: v => nf(v, 1) + ' ч' },
          tooltip: tooltip({ callbacks: { label: c => ' ' + c.dataset.label + ': ' + nf(c.parsed.x * 60) + ' мин (' + nf(c.parsed.x, 1) + ' ч)' } })
        }
      },
      plugins: [endLabels]
    });
  }

  // Тепловая карта «станок × день»: интенсивность = внеплановые минуты простоя за день
  const hex = c => { const m = /^#?([0-9a-f]{6})$/i.exec(c.trim()); const n = parseInt(m ? m[1] : '888888', 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  const mixHex = (a, b, t) => { const A = hex(a), B = hex(b); return 'rgb(' + A.map((x, i) => Math.round(x + (B[i] - x) * t)).join(',') + ')'; };
  const lum = rgb => { const [r, g, b] = rgb.match(/\d+/g).map(Number); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };

  function heatmap(U, from, to, util) {
    const days = []; for (let d = from; d <= to; d = util.addDays(d, 1)) days.push(d);
    const opOf = {}; U.forEach(r => { opOf[r.machine] = r.op; });
    const totals = sumBy(U, r => r.machine, r => r.min);
    const machines = [...totals].sort((a, b) => b[1] - a[1]).map(x => x[0]);
    const cell = new Map(), reasonsIn = new Map();
    for (const r of U) {
      const k = r.machine + '|' + r.date;
      cell.set(k, (cell.get(k) || 0) + r.min);
      if (!reasonsIn.has(k)) reasonsIn.set(k, new Map());
      const rm = reasonsIn.get(k); rm.set(r.reason, (rm.get(r.reason) || 0) + r.min);
    }
    const max = Math.max(1, ...cell.values());
    const base = T.series[0];
    const showNums = days.length <= 31;
    const dow = d => new Date(d + 'T00:00:00Z').getUTCDay(); // 1 — понедельник
    const dm = d => d.slice(8) + '.' + d.slice(5, 7);
    let h = '<div class="hm-scroll"><div class="hm" style="grid-template-columns:96px repeat(' + days.length + ',minmax(26px,1fr)) 64px">';
    h += '<div></div>' + days.map((d, i) => '<div class="hm-h' + (dow(d) === 1 || i === 0 ? ' hm-h-week' : '') + '">' +
      (dow(d) === 1 || i === 0 ? dm(d) : d.slice(8)) + '</div>').join('') + '<div class="hm-h hm-h-total">Итого</div>';
    for (const m of machines) {
      h += '<div class="hm-row">' + m + ' <span>' + (opOf[m] || '').toLowerCase() + '</span></div>';
      for (const d of days) {
        const v = cell.get(m + '|' + d) || 0;
        if (!v) { h += '<div class="hm-cell hm-zero" title="' + m + ', ' + d.slice(8) + '.' + d.slice(5, 7) + ': простоев нет"></div>'; continue; }
        const bg = mixHex(T.surface, base, 0.18 + 0.82 * v / max);
        const detail = [...reasonsIn.get(m + '|' + d)].sort((a, b) => b[1] - a[1]).map(x => x[0] + ' ' + x[1] + ' мин').join(', ');
        h += '<div class="hm-cell" style="background:' + bg + ';color:' + (lum(bg) < 0.55 ? '#fff' : T.text) + '" title="' +
          m + ', ' + d.slice(8) + '.' + d.slice(5, 7) + ': ' + v + ' мин (' + detail + ')">' + (showNums ? v : '') + '</div>';
      }
      h += '<div class="hm-total">' + hrs(totals.get(m)) + ' ч</div>';
    }
    h += '</div></div>';
    h += '<div class="hm-legend"><span>меньше</span>' + [0.18, 0.4, 0.6, 0.8, 1].map(t => '<i style="background:' + mixHex(T.surface, base, t) + '"></i>').join('') +
      '<span>больше</span><span class="muted">· число в клетке — минуты простоя за день, максимум ' + max + ' мин</span></div>';
    return h;
  }

  // ============ Брак ============

  function stackedColumns(id, labels, titles, series, { unit = 'шт', integer = true, tickFmt } = {}) {
    make(id, {
      type: 'bar',
      data: {
        labels,
        datasets: series.map(s => ({
          label: s.label, data: s.data, backgroundColor: s.color, borderColor: T.surface, borderWidth: 1,
          borderRadius: 2, maxBarThickness: 24
        }))
      },
      options: {
        scales: scales(false, { stacked: true, integer, tickFmt }),
        plugins: {
          legend: legend(series.length > 1 || !!series[0].showLegend),
          tooltip: tooltip({ callbacks: { title: it => titles[it[0].dataIndex], label: c => ' ' + c.dataset.label + ': ' + nf(c.parsed.y, integer ? 0 : 1) + ' ' + unit } })
        }
      }
    });
  }

  function opsByShift(id, B, shifts) {
    const totals = sumBy(B, r => r.op, r => r.qty);
    const ops = [...totals].sort((a, b) => b[1] - a[1]).map(x => x[0]);
    const grid = sumBy(B, r => r.op + '|' + r.shift, r => r.qty);
    make(id, {
      type: 'bar',
      data: {
        labels: ops,
        datasets: shifts.map(s => ({ label: shiftName(s), data: ops.map(o => grid.get(o + '|' + s) || 0), backgroundColor: shiftColor(s), borderRadius: barRadius(true), maxBarThickness: 16 }))
      },
      options: {
        indexAxis: 'y', layout: { padding: { right: 44 } }, scales: scales(true, { integer: true, tickFmt: v => nf(v) }),
        plugins: {
          legend: legend(true), endLabels: { mode: 'each', fmt: v => nf(v) },
          tooltip: tooltip({ callbacks: { label: c => ' ' + c.dataset.label + ': ' + nf(c.parsed.x) + ' шт' } })
        }
      },
      plugins: [endLabels]
    });
  }

  function types(id, B) {
    const total = B.reduce((s, r) => s + r.qty, 0);
    const opOf = {}; B.forEach(r => { opOf[r.type] = r.op; });
    const rows = [...sumBy(B, r => r.type, r => r.qty)].sort((a, b) => b[1] - a[1]);
    make(id, {
      type: 'bar',
      data: { labels: rows.map(r => r[0]), datasets: [{ data: rows.map(r => r[1]), backgroundColor: T.series[0], borderRadius: barRadius(true), maxBarThickness: 24 }] },
      options: {
        indexAxis: 'y', layout: { padding: { right: 84 } }, scales: scales(true, { integer: true, tickFmt: v => nf(v) }),
        plugins: {
          legend: legend(false), endLabels: { mode: 'each', fmt: (v) => nf(v) + ' шт · ' + nf(v / total * 100) + '%' },
          tooltip: tooltip({ callbacks: { label: c => ' ' + nf(c.parsed.x) + ' шт (' + nf(c.parsed.x / total * 100, 1) + '%)', afterLabel: c => ' Операция-источник: ' + opOf[rows[c.dataIndex][0]] } })
        }
      },
      plugins: [endLabels]
    });
  }

  // Линии по неделям (День / Ночь): для малых кратных и для мини-графиков в выводах
  function weeklyLines(id, labels, titles, series, { ymax, unit = 'шт', integer = true, last = true } = {}) {
    make(id, {
      type: 'line',
      data: {
        labels,
        datasets: series.map(s => ({
          label: s.label, data: s.data, borderColor: s.color, backgroundColor: s.color, borderWidth: 2, tension: 0,
          pointRadius: 4.5, pointHoverRadius: 6, pointBackgroundColor: s.color, pointBorderColor: T.surface, pointBorderWidth: 2
        }))
      },
      options: {
        layout: { padding: { right: last ? 30 : 8, top: 6 } }, scales: scales(false, { max: ymax, integer }),
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: legend(series.length > 1),
          lastLabels: last ? { fmt: v => nf(v, integer ? 0 : 1) } : undefined,
          tooltip: tooltip({ callbacks: { title: it => titles[it[0].dataIndex], label: c => ' ' + c.dataset.label + ': ' + nf(c.parsed.y, integer ? 0 : 1) + ' ' + unit } })
        }
      },
      plugins: [lastLabels]
    });
  }

  window.Charts = {
    refreshTheme, destroyIn, theme: () => T, reasonColor, shiftColor, shiftName,
    pareto, machinesByReason, machinesByShift, heatmap, stackedColumns, opsByShift, types, weeklyLines
  };
})();
