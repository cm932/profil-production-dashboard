// Автоматические выводы для директора. Каждый вывод вычисляется из отфильтрованных данных,
// поэтому при загрузке нового файла или смене фильтров тексты и цифры пересчитываются.
// Правило: то, что данные не доказывают (причина), формулируется как гипотеза «проверить», а не как факт.
(function () {
  'use strict';

  const nf = (n, d = 0) => Number(n).toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d });
  const hrs = min => nf(min / 60, 1);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const dm = d => d.slice(8) + '.' + d.slice(5, 7);
  const sum = (a, f) => a.reduce((s, r) => s + f(r), 0);
  const mean = a => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
  const CHAIN = ['раскрой', 'кромка', 'присадка', 'сборка']; // порядок переделов на фабрике

  // Что делать по каждой причине простоя (короткие практические шаги)
  const ACTION = {
    'Ожидание заготовок': 'сверить график подачи заготовок на этот станок с планом раскроя, при необходимости ввести межоперационный буфер и ответственного за подачу.',
    'Нет материала': 'проверить складской остаток и заявки на плиту/кромку/фурнитуру до начала смены.',
    'Нет оператора': 'проверить график смен и замены: кто выходит на станок при отсутствии основного оператора.',
    'Переналадка': 'сгруппировать заказы по типоразмеру, чтобы переналадок было меньше, и стандартизировать порядок переналадки.',
    'Поломка': 'проверить график ТО этого станка и запас расходников; разобрать повторяющиеся отказы.',
    'Прочее': 'причина «Прочее» ничего не объясняет — сделать выбор конкретной причины обязательным при записи простоя.'
  };

  // Недели, выровненные по концу выбранного периода; неполная неделя в начале не берётся, чтобы не искажать сравнение
  function windows(from, to, util) {
    const total = util.daysBetween(from, to), n = Math.floor(total / 7), out = [];
    for (let i = 0; i < n; i++) {
      const end = util.addDays(to, -7 * (n - 1 - i)), start = util.addDays(end, -6);
      out.push({ from: start, to: end, label: [dm(start), '–' + dm(end)], title: dm(start) + ' — ' + dm(end) });
    }
    return out;
  }
  const inWin = (r, w) => r.date >= w.from && r.date <= w.to;

  // ---------- Вывод 1: станок, у которого потери резко выросли на последней неделе ----------
  function machineSpike(ctx, C) {
    const { from, to, util } = ctx;
    if (!from || util.daysBetween(from, to) < 14) return null;
    const U = ctx.D.filter(r => !r.planned);
    const recentFrom = util.addDays(to, -6);
    const priorWeeks = (util.daysBetween(from, recentFrom) - 1) / 7;
    if (priorWeeks < 1) return null;

    let best = null;
    for (const m of new Set(U.map(r => r.machine))) {
      const rows = U.filter(r => r.machine === m);
      const rec = sum(rows.filter(r => r.date >= recentFrom), r => r.min);
      const avg = sum(rows.filter(r => r.date < recentFrom), r => r.min) / priorWeeks;
      if (rec >= 180 && rec >= 2 * Math.max(avg, 1) && (!best || rec - avg > best.rec - best.avg)) best = { m, rec, avg, rows };
    }
    if (!best) return null;

    const recRows = best.rows.filter(r => r.date >= recentFrom);
    const byReason = new Map();
    recRows.forEach(r => byReason.set(r.reason, (byReason.get(r.reason) || 0) + r.min));
    const [topReason, topMin] = [...byReason].sort((a, b) => b[1] - a[1])[0];
    const topRows = recRows.filter(r => r.reason === topReason);
    const days = [...new Set(topRows.map(r => r.date))].sort();
    let streak = 0; // подряд идущие дни в конце периода
    for (let d = to; days.includes(d); d = util.addDays(d, -1)) streak++;
    const shiftMin = { 1: 0, 2: 0 }; topRows.forEach(r => { shiftMin[r.shift] += r.min; });
    const domShift = shiftMin[1] >= 0.8 * topMin ? 1 : shiftMin[2] >= 0.8 * topMin ? 2 : 0;
    const op = recRows[0].op.toLowerCase();

    let text = '<b>' + esc(best.m) + '</b> (' + esc(op) + '): за последние 7 дней (' + dm(recentFrom) + '–' + dm(to) + ') потеряно <b>' + hrs(best.rec) +
      ' ч</b> — в ' + nf(best.rec / Math.max(best.avg, 1), 1) + ' раза больше обычных ' + hrs(best.avg) + ' ч в неделю. ' +
      nf(topMin) + ' мин (' + nf(topMin / best.rec * 100) + '%) — «' + esc(topReason) + '»' +
      (streak >= 2 ? ', <b>' + streak + ' дня подряд</b> (' + dm(util.addDays(to, -streak + 1)) + '–' + dm(to) + ')' : '') +
      (domShift ? ', почти целиком в ' + (domShift === 1 ? 'дневную' : 'ночную') + ' смену' : '') + '.';

    // Для «ожидания заготовок» смотрим, простаивал ли предыдущий передел: без этого нельзя отличить поломку раскроя от проблемы подачи
    let upstream = '';
    const idx = CHAIN.indexOf(op);
    if (topReason === 'Ожидание заготовок' && idx > 0) {
      const upOp = CHAIN[idx - 1];
      const upRecent = sum(ctx.Dall.filter(r => !r.planned && r.op.toLowerCase() === upOp && r.date >= recentFrom), r => r.min);
      const upRows = ctx.Dall.filter(r => !r.planned && r.op.toLowerCase() === upOp);
      if (upRows.length) {
        const upAvg = sum(upRows.filter(r => r.date < recentFrom), r => r.min) / priorWeeks;
        upstream = ' Станки предыдущего передела (' + upOp + ') за эти же 7 дней простояли всего <b>' + nf(upRecent) + ' мин</b> (обычно ' + nf(upAvg) + ' мин в неделю): ' +
          (upRecent <= upAvg * 1.2
            ? 'то есть раскрой работал в обычном режиме (даже с меньшими простоями), а заготовок на кромку всё равно не хватало — проблема, вероятно, в очерёдности и подаче, а не в поломках раскроя. Журнал этого не доказывает, проверьте на месте.'
            : 'возможно, причина в них — проверьте, не они задерживают подачу.');
      }
    }

    // Мини-график: минуты простоя по дням за последние 14 дней, главная причина отдельным цветом
    const start = util.addDays(to, -13) < from ? from : util.addDays(to, -13);
    const dayList = []; for (let d = start; d <= to; d = util.addDays(d, 1)) dayList.push(d);
    const minutesOf = (d, pred) => sum(best.rows.filter(r => r.date === d && pred(r)), r => r.min) / 60;

    return {
      level: 'crit', kind: 'spike',
      title: 'Резкий рост простоев станка ' + best.m,
      body: text + upstream,
      action: ACTION[topReason] || ACTION['Прочее'],
      mini: {
        type: 'columns', labels: dayList.map(d => d.slice(8)), titles: dayList.map(dm),
        series: [
          { label: '«' + topReason + '»', color: C.reasonColor(topReason), data: dayList.map(d => minutesOf(d, r => r.reason === topReason)) },
          { label: 'Другие причины', color: C.theme().neutral, data: dayList.map(d => minutesOf(d, r => r.reason !== topReason)) }
        ],
        note: best.m + ' — простои по дням, ч'
      }
    };
  }

  // ---------- Вывод 2: операция и смена, где брак резко вырос ----------
  function defectSpike(ctx, C) {
    const { from, to, util } = ctx;
    if (!from) return null;
    const wins = windows(from, to, util);
    if (wins.length < 3) return null;
    const last = wins.length - 1;

    let best = null;
    for (const op of new Set(ctx.B.map(r => r.op))) {
      for (const shift of [1, 2]) {
        const counts = wins.map(w => sum(ctx.B.filter(r => r.op === op && r.shift === shift && inWin(r, w)), r => r.qty));
        const prev = mean(counts.slice(0, last));
        if (counts[last] >= 10 && counts[last] >= 2 * Math.max(prev, 1) && (!best || counts[last] - prev > best.rec - best.prev)) {
          best = { op, shift, counts, rec: counts[last], prev };
        }
      }
    }
    if (!best) return null;

    const w = wins[last], shiftWord = best.shift === 1 ? 'дневную' : 'ночную', shiftWord2 = best.shift === 1 ? 'днём' : 'ночью';
    const other = 3 - best.shift;
    const otherCounts = wins.map(x => sum(ctx.B.filter(r => r.op === best.op && r.shift === other && inWin(r, x)), r => r.qty));
    const recRows = ctx.B.filter(r => r.op === best.op && r.shift === best.shift && inWin(r, w));
    const byType = new Map(); recRows.forEach(r => byType.set(r.type, (byType.get(r.type) || 0) + r.qty));
    const [topType, topQty] = [...byType].sort((a, b) => b[1] - a[1])[0];
    const opLow = best.op.toLowerCase();

    let text = '<b>' + esc(best.op) + ', ' + (best.shift === 1 ? 'день' : 'ночь') + '</b>: за последнюю неделю (' + w.title + ') <b>' + best.rec + ' шт</b> брака — в ' +
      nf(best.rec / Math.max(best.prev, 1), 1) + ' раза больше среднего за прошлые недели (' + nf(best.prev, 1) + ' шт). ' +
      'В другую смену на этой операции за ту же неделю — ' + otherCounts[last] + ' шт, то есть проблема именно ' + (best.shift === 1 ? 'в дневной' : 'в ночной') + ' смене. ' +
      'Основной дефект: «' + esc(topType) + '» (' + topQty + ' из ' + best.rec + ' шт).';

    // Что совпало по времени: причина простоя на станках этой операции в ту же смену и неделю
    const dRows = ctx.Dall.filter(r => !r.planned && r.op === best.op && r.shift === best.shift);
    const reasons = [...new Set(dRows.map(r => r.reason))].map(re => {
      const per = wins.map(x => sum(dRows.filter(r => r.reason === re && inWin(r, x)), r => r.min));
      return { re, rec: per[last], avg: mean(per.slice(0, last)) };
    }).filter(x => x.rec >= 60 && x.rec >= 2 * Math.max(x.avg, 15)).sort((a, b) => (b.rec - b.avg) - (a.rec - a.avg));
    if (reasons.length) {
      const x = reasons[0];
      text += ' В ту же неделю на станках этой операции ' + shiftWord2 + ' — <b>' + nf(x.rec) + ' мин простоя по причине «' + esc(x.re) + '»</b> (раньше в среднем ' + nf(x.avg) + ' мин в неделю). ' +
        'Совпадение по времени — не доказанная причина, но это первое, что стоит проверить.';
    }

    const extra = best.rec - best.prev;
    return {
      level: 'crit', kind: 'defects',
      title: 'Рост брака: ' + opLow + ', ' + (best.shift === 1 ? 'дневная' : 'ночная') + ' смена',
      body: text + ' Лишний брак за неделю ≈ ' + nf(extra) + ' шт (≈ ' + nf(extra * ctx.params.pieceCost / 1000) + ' тыс. ₽ по заданной ставке).',
      action: 'на ' + shiftWord + ' смену поставить контроль первых деталей после каждой переналадки' + (topType ? ' («' + topType + '»)' : '') +
        ', сравнить с ' + (best.shift === 1 ? 'ночной' : 'дневной') + ' сменой: инструмент, настройка, кто работал, и передачу смены.',
      mini: {
        type: 'lines', labels: wins.map(x => x.label), titles: wins.map(x => x.title),
        series: [
          { label: C.shiftName(1), color: C.shiftColor(1), data: best.shift === 1 ? best.counts : otherCounts },
          { label: C.shiftName(2), color: C.shiftColor(2), data: best.shift === 2 ? best.counts : otherCounts }
        ],
        note: best.op + ' — брак по неделям, шт'
      }
    };
  }

  // ---------- Вывод 3: одна смена теряет заметно больше времени ----------
  function shiftGap(ctx) {
    const U = ctx.D.filter(r => !r.planned);
    const t = { 1: sum(U.filter(r => r.shift === 1), r => r.min), 2: sum(U.filter(r => r.shift === 2), r => r.min) };
    if (!t[1] || !t[2]) return null;
    const lead = t[2] >= t[1] ? 2 : 1, oth = 3 - lead;
    if (t[lead] / t[oth] < 1.2) return null;
    const by = s => { const m = new Map(); U.filter(r => r.shift === s).forEach(r => m.set(r.reason, (m.get(r.reason) || 0) + r.min)); return m; };
    const a = by(lead), b = by(oth);
    const diffs = [...a].map(([re, v]) => [re, v - (b.get(re) || 0)]).sort((x, y) => y[1] - x[1]);
    const [re, dv] = diffs[0];
    const name = s => (s === 1 ? 'Дневная' : 'Ночная');
    return {
      level: 'warn', kind: 'shift',
      title: name(lead) + ' смена теряет больше времени',
      body: name(lead) + ' смена: <b>' + hrs(t[lead]) + ' ч</b> внеплановых простоев против ' + hrs(t[oth]) + ' ч в ' + (oth === 1 ? 'дневную' : 'ночную') +
        ' (на ' + nf((t[lead] / t[oth] - 1) * 100) + '% больше). Больше всего разницы даёт «' + esc(re) + '»: +' + hrs(dv) + ' ч к другой смене.',
      action: (ACTION[re] || ACTION['Прочее'])
    };
  }

  // ---------- Вывод 4: общая картина потерь ----------
  function overview(ctx) {
    const U = ctx.D.filter(r => !r.planned);
    if (!U.length) return null;
    const loss = sum(U, r => r.min);
    const m = new Map(); U.forEach(r => m.set(r.reason, (m.get(r.reason) || 0) + r.min));
    const reasons = [...m].sort((a, b) => b[1] - a[1]);
    const mm = new Map(); U.forEach(r => mm.set(r.machine, (mm.get(r.machine) || 0) + r.min));
    const machines = [...mm].sort((a, b) => b[1] - a[1]);
    const s = ctx.summary;
    const topShare = reasons[0][1] / loss * 100;
    const top3 = reasons.slice(0, 3).reduce((x, r) => x + r[1], 0) / loss * 100;
    const other = m.get('Прочее') || 0;

    let text = 'Потеряно <b>' + hrs(loss) + ' ч</b>' + (s.fundMin ? ' (' + nf(loss / s.fundMin * 100, 1) + '% фонда времени)' : '') +
      ', ≈ ' + nf(loss / 60 * ctx.params.hourCost / 1000) + ' тыс. ₽ по ставке ' + nf(ctx.params.hourCost) + ' ₽/ч. ' +
      'Больше всего теряют ' + machines.slice(0, 2).map(x => '<b>' + esc(x[0]) + '</b> (' + hrs(x[1]) + ' ч)').join(' и ') + '. ' +
      'Крупнейшая причина — «' + esc(reasons[0][0]) + '» (' + nf(topShare) + '%).';
    if (topShare < 25) text += ' Потери размазаны по всем причинам: три крупнейшие дают лишь ' + nf(top3) + '%, поэтому одним решением проблему не закрыть.';
    if (other / loss > 0.15) text += ' На «Прочее» приходится ' + nf(other / loss * 100) + '% — это значит, что часть причин при записи не определена.';

    return {
      level: 'info', kind: 'overview', title: 'Общая картина потерь', body: text,
      action: other / loss > 0.15 ? ACTION['Прочее'] : 'начать со станка-лидера по потерям и его главной причины (см. лист «Простои»).'
    };
  }

  function build(ctx, C) {
    return [machineSpike(ctx, C), defectSpike(ctx, C), shiftGap(ctx), overview(ctx)].filter(Boolean);
  }

  const LEVEL = { crit: 'Приоритет', warn: 'Внимание', info: 'Контекст' };

  function render(list, ctxNote) {
    if (!list.length) return '<div class="card empty">Для выбранного периода и смены выводов нет: данных мало для сравнения недель или резких отклонений не найдено.</div>';
    return list.map((x, i) =>
      '<article class="insight ' + x.level + '"><div class="insight-tag">' + LEVEL[x.level] + '</div>' +
      '<h3>' + esc(x.title) + '</h3><p>' + x.body + '</p>' +
      (x.mini ? '<div class="mini-note">' + esc(x.mini.note) + '</div><div class="mini-box"><canvas id="mini' + i + '"></canvas></div>' : '') +
      '<p class="action"><b>Что делать:</b> ' + esc(x.action) + '</p></article>').join('') +
      (ctxNote ? '<p class="muted small insight-foot">' + ctxNote + '</p>' : '');
  }

  function drawMinis(list, C) {
    list.forEach((x, i) => {
      if (!x.mini) return;
      const m = x.mini;
      if (m.type === 'columns') C.stackedColumns('mini' + i, m.labels, m.titles, m.series, { unit: 'ч', integer: false, tickFmt: v => nf(v, 1) });
      else C.weeklyLines('mini' + i, m.labels, m.titles, m.series, {});
    });
  }

  window.Insights = { build, render, drawMinis, windows };
})();
