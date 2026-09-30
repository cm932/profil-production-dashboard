// Слой данных: чтение файлов (CSV / XLSX), определение типа журнала, проверка и нормализация строк.
// Ничего не «достраивает»: строка с ошибкой не попадает в расчёт и показывается в отчёте о загрузке.
(function () {
  'use strict';

  // Схемы журналов: внутреннее поле → варианты заголовка в файле (сравнение без регистра и лишних пробелов)
  const SCHEMAS = {
    downtime: {
      title: 'Журнал простоев',
      signature: 'длительность, мин',
      fields: {
        id: ['id_записи', 'id', '№'],
        date: ['дата', 'дата простоя'],
        machine: ['станок', 'код станка'],
        machineName: ['наименование', 'наименование станка'],
        op: ['операция'],
        shop: ['цех'],
        shift: ['смена'],
        shiftName: ['смена_название', 'смена (название)'],
        reason: ['причина простоя', 'причина'],
        planned: ['плановый простой', 'плановый'],
        min: ['длительность, мин', 'длительность']
      },
      required: ['date', 'machine', 'op', 'reason', 'planned', 'min']
    },
    defects: {
      title: 'Журнал брака ОТК',
      signature: 'тип дефекта',
      fields: {
        id: ['№', 'id', 'id_записи'],
        date: ['дата контроля', 'дата'],
        type: ['тип дефекта'],
        op: ['операция-источник', 'операция'],
        qty: ['кол-во, шт', 'количество', 'кол-во'],
        order: ['заказ'],
        shift: ['смена'],
        shiftName: ['смена (название)', 'смена_название']
      },
      required: ['date', 'type', 'op', 'qty']
    }
  };

  const norm = s => String(s == null ? '' : s).replace(/^﻿/, '').trim().replace(/\s+/g, ' ').toLowerCase();

  // ---------- Чтение файлов в «таблицу» (массив массивов) ----------

  function parseCSV(text) {
    text = text.replace(/^﻿/, '');
    const firstLine = text.split(/\r?\n/, 1)[0];
    const counts = { ';': 0, ',': 0, '\t': 0 };
    for (const ch of firstLine) if (ch in counts) counts[ch]++;
    const delim = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];

    const rows = [];
    let row = [], cell = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false;
        } else cell += c;
      } else if (c === '"') inQ = true;
      else if (c === delim) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(v => String(v).trim() !== ''));
  }

  function decodeText(buf) {
    // Сначала UTF-8; если в тексте есть битые символы — пробуем Windows-1251 (частый случай для выгрузок из Excel)
    const utf = new TextDecoder('utf-8').decode(buf);
    if (!utf.includes('�')) return utf;
    try { return new TextDecoder('windows-1251').decode(buf); } catch (e) { return utf; }
  }

  function parseWorkbook(buf) {
    // cellDates выключен: даты Excel приходят серийными числами и переводятся в toISODate() по UTC,
    // иначе объект Date в местном часовом поясе может «съехать» на соседний день
    const wb = XLSX.read(buf, { type: 'array', cellDates: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' })
      .filter(r => r.some(v => String(v).trim() !== ''));
  }

  function fileToTable(name, buf) {
    const ext = name.toLowerCase().split('.').pop();
    if (ext === 'csv' || ext === 'txt') return parseCSV(decodeText(buf));
    if (ext === 'xlsx' || ext === 'xls' || ext === 'xlsm') return parseWorkbook(buf);
    throw new Error('Неподдерживаемый формат «.' + ext + '». Нужен CSV или XLSX.');
  }

  // ---------- Нормализация значений ----------

  const pad = n => String(n).padStart(2, '0');

  function toISODate(v) {
    if (v instanceof Date && !isNaN(v)) return v.getFullYear() + '-' + pad(v.getMonth() + 1) + '-' + pad(v.getDate());
    if (typeof v === 'number' && v > 20000 && v < 80000) { // серийная дата Excel
      const d = new Date((Math.floor(v) - 25569) * 864e5); // дробная часть — время суток, отбрасываем
      return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
    }
    const s = String(v).trim();
    let y, mo, d, m;
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) [y, mo, d] = [+m[1], +m[2], +m[3]];
    else if ((m = s.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/))) [y, mo, d] = [+m[3], +m[2], +m[1]];
    else return null;
    // Проверяем, что такая дата существует (отсекает «2026-13-45», «31.02.2026»)
    const check = new Date(Date.UTC(y, mo - 1, d));
    if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
    return y + '-' + pad(mo) + '-' + pad(d);
  }

  function toNumber(v) {
    if (typeof v === 'number') return v;
    const n = parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
    return isNaN(n) ? null : n;
  }

  function toShift(num, name) {
    const n = norm(num), t = norm(name);
    if (n === '1' || t === 'день' || n === 'день') return 1;
    if (n === '2' || t === 'ночь' || n === 'ночь') return 2;
    return null;
  }

  const cap = s => { s = String(s).trim(); return s ? s[0].toUpperCase() + s.slice(1) : s; };

  // ---------- Таблица → записи журнала ----------

  function detectKind(header) {
    const h = header.map(norm);
    if (h.includes(SCHEMAS.downtime.signature)) return 'downtime';
    if (h.includes(SCHEMAS.defects.signature)) return 'defects';
    return null;
  }

  function tableToRecords(table, fileName) {
    if (!table.length) throw new Error('Файл «' + fileName + '» пустой.');
    const header = table[0];
    const kind = detectKind(header);
    if (!kind) throw new Error('В файле «' + fileName + '» не найдены колонки «Длительность, мин» (простои) или «Тип дефекта» (брак).');
    const schema = SCHEMAS[kind];
    const h = header.map(norm);

    const col = {};
    for (const [field, names] of Object.entries(schema.fields)) {
      col[field] = h.findIndex(x => names.includes(x));
    }
    const missing = schema.required.filter(f => col[f] < 0).map(f => schema.fields[f][0]);
    if (missing.length) throw new Error(schema.title + ': нет обязательных колонок — ' + missing.join(', '));

    const records = [], errors = [];
    table.slice(1).forEach((r, i) => {
      const get = f => (col[f] >= 0 ? r[col[f]] : '');
      const line = i + 2; // номер строки в файле с учётом шапки
      const date = toISODate(get('date'));
      const shift = toShift(get('shift'), get('shiftName'));
      const problems = [];
      if (!date) problems.push('дата «' + get('date') + '»');
      if (!shift) problems.push('смена «' + get('shift') + '»');

      let rec;
      if (kind === 'downtime') {
        const min = toNumber(get('min'));
        const planned = norm(get('planned'));
        if (min == null || min < 0) problems.push('длительность «' + get('min') + '»');
        if (planned !== 'да' && planned !== 'нет') problems.push('плановый простой «' + get('planned') + '»');
        rec = {
          id: String(get('id')), date, machine: String(get('machine')).trim(),
          machineName: String(get('machineName')).trim(), op: cap(get('op')), shop: String(get('shop')).trim(),
          shift, reason: String(get('reason')).trim(), planned: planned === 'да', min
        };
      } else {
        const qty = toNumber(get('qty'));
        if (qty == null || qty < 0) problems.push('кол-во «' + get('qty') + '»');
        rec = {
          id: String(get('id')), date, type: String(get('type')).trim(), op: cap(get('op')),
          qty, order: String(get('order')).trim(), shift
        };
      }
      if (problems.length) errors.push('строка ' + line + ': ' + problems.join(', '));
      else records.push(rec);
    });

    return { kind, title: schema.title, fileName, records, errors, total: table.length - 1 };
  }

  // ---------- Публичный интерфейс ----------

  async function readFile(file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    return tableToRecords(fileToTable(file.name, buf), file.name);
  }

  function readDefaultFile(f) {
    let buf;
    if (f.kind === 'base64') {
      const bin = atob(f.content);
      buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    } else buf = new TextEncoder().encode(f.content);
    return tableToRecords(fileToTable(f.name, buf), f.name);
  }

  window.DataLayer = { readFile, readDefaultFile, SCHEMAS };
})();
