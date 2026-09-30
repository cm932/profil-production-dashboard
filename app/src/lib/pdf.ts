// Экспорт листа в PDF. Лист снимается в светлой теме (для печати), затем делится на страницы A4 по границам блоков —
// карточка, вывод, строка таблицы не режутся пополам, кроме блоков выше страницы. Внизу каждой страницы — подпись.
// Подпись рисуется на холсте: встроенные шрифты jsPDF не умеют кириллицу.
import { toCanvas } from 'html-to-image'
import { jsPDF } from 'jspdf'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Режим экспорта: светлая тема, без кнопок и прокруток; после — всё возвращается как было. */
export async function withExportMode<T>(fn: () => Promise<T>): Promise<T> {
  const root = document.documentElement
  const prevTheme = root.getAttribute('data-theme')
  root.setAttribute('data-theme', 'light')
  document.body.classList.add('exporting')
  // Допущения (ставки, длительность смены) в PDF раскрываем: от них зависят рубли и доступность
  const details = [...document.querySelectorAll('details')].map((d) => [d, d.open] as const)
  details.forEach(([d]) => { d.open = true })
  window.dispatchEvent(new CustomEvent('profil:exporting', { detail: true }))
  try {
    await sleep(600) // тема применена, лист «Данные» показал все строки, графики перерисованы
    return await fn()
  } finally {
    window.dispatchEvent(new CustomEvent('profil:exporting', { detail: false }))
    details.forEach(([d, o]) => { d.open = o })
    document.body.classList.remove('exporting')
    if (prevTheme) root.setAttribute('data-theme', prevTheme)
    else root.removeAttribute('data-theme')
  }
}

export interface PdfPages { pages: HTMLCanvasElement[]; mmPerPx: number; margin: number }

export async function renderSheetPages(sheetEl: HTMLElement, title: string, caption: string): Promise<PdfPages> {
  const bg = getComputedStyle(document.body).backgroundColor || '#F4F4F1'
  const rect0 = sheetEl.getBoundingClientRect()
  // Разрешение снимка: 1.6× достаточно для печати A4 (≈165 dpi) и вдвое быстрее 2×; у очень длинных листов снижаем,
  // чтобы холст не превысил предел браузера (~16 000 px по высоте)
  const pixelRatio = Math.max(0.75, Math.min(1.6, 14000 / rect0.height))
  const canvas = await toCanvas(sheetEl, { pixelRatio, backgroundColor: bg, cacheBust: false })
  const k = canvas.width / rect0.width // css-пиксели → пиксели холста
  const A4W = 297, A4H = 210, M = 8
  const mmPerPx = (A4W - 2 * M) / canvas.width
  const footerPx = 44
  const contentPx = Math.floor((A4H - 2 * M) / mmPerPx) - footerPx // высота полезной части страницы

  const blocks = [...sheetEl.querySelectorAll('.view--print, .tile, .card, .block-title, .block-sub, .sheet-head, .table-totals, tbody tr, thead')]
    .map((el) => { const r = el.getBoundingClientRect(); return { t: (r.top - rect0.top) * k, b: (r.bottom - rect0.top) * k } })
    .filter((b) => b.b - b.t > 1 && b.b - b.t < contentPx * 0.95)

  // Шапка таблицы повторяется на каждой странице, кроме первой (там она и так есть)
  const th = sheetEl.querySelector('thead')
  const head = th ? (() => { const r = th.getBoundingClientRect(); return { t: Math.floor((r.top - rect0.top) * k), h: Math.ceil(r.height * k) } })() : null
  const room = (first: boolean) => (head && !first ? contentPx - head.h : contentPx)

  const cuts = [0]
  let y0 = 0
  while (canvas.height - y0 > room(y0 === 0)) {
    let y = y0 + room(y0 === 0)
    for (let guard = 0; guard < 60; guard++) {
      const straddle = blocks.filter((b) => b.t > y0 + 1 && b.t < y - 1 && b.b > y + 1).sort((a, b) => a.t - b.t)[0]
      if (!straddle) break
      y = straddle.t - 8 // зазор, чтобы кромка следующего блока не попала на эту страницу
    }
    if (y < y0 + contentPx * 0.3) y = y0 + room(y0 === 0) // страница получилась бы почти пустой — режем как есть
    y = Math.floor(y)
    cuts.push(y)
    y0 = y
  }
  cuts.push(canvas.height)

  const stamp = new Date().toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
  const n = cuts.length - 1
  const pages: HTMLCanvasElement[] = []
  for (let i = 0; i < n; i++) {
    const sliceH = cuts[i + 1] - cuts[i]
    const withHead = !!head && i > 0
    const top = withHead ? head!.h : 0
    const h = sliceH + top
    const pg = document.createElement('canvas')
    pg.width = canvas.width
    pg.height = h + footerPx
    const c = pg.getContext('2d')!
    c.fillStyle = bg
    c.fillRect(0, 0, pg.width, pg.height)
    if (withHead) c.drawImage(canvas, 0, head!.t, canvas.width, head!.h, 0, 0, canvas.width, head!.h)
    c.drawImage(canvas, 0, cuts[i], canvas.width, sliceH, 0, top, canvas.width, sliceH)
    c.strokeStyle = '#E2E4DD'
    c.lineWidth = 2
    c.beginPath(); c.moveTo(0, h + 8); c.lineTo(pg.width, h + 8); c.stroke()
    c.fillStyle = '#565C56'
    c.font = '22px "Golos Text", system-ui, "Segoe UI", sans-serif'
    c.textBaseline = 'middle'
    c.textAlign = 'left'
    c.fillText('Фабрика «Профиль» · ' + title + ' · ' + caption, 0, h + 8 + footerPx / 2)
    c.textAlign = 'right'
    c.fillText('сформировано ' + stamp + ' · стр. ' + (i + 1) + ' из ' + n, pg.width, h + 8 + footerPx / 2)
    pages.push(pg)
  }
  return { pages, mmPerPx, margin: M }
}

export async function exportSheetPDF(sheetEl: HTMLElement, title: string, caption: string, fileStamp: string) {
  const { pages, mmPerPx, margin } = await withExportMode(() => renderSheetPages(sheetEl, title, caption))
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  pages.forEach((pg, i) => {
    if (i) pdf.addPage()
    pdf.addImage(pg.toDataURL('image/jpeg', 0.92), 'JPEG', margin, margin, pg.width * mmPerPx, pg.height * mmPerPx)
  })
  pdf.setProperties({ title: 'Фабрика «Профиль» — ' + title + ' · ' + caption })
  pdf.save('Профиль_' + title + '_' + fileStamp + '.pdf')
}
