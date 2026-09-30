import { useEffect, useRef, useState, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { FileDown } from 'lucide-react'
import { Button } from '@/components/ui'
import { EASE_OUT } from '@/lib/motion'
import { filterCaption } from '@/lib/model'
import { exportSheetPDF, renderSheetPages, withExportMode } from '@/lib/pdf'
import type { SheetId } from '@/lib/types'
import { useStore } from '@/store'

const TITLE: Record<SheetId, string> = { summary: 'Сводка', downtime: 'Простои', defects: 'Брак', data: 'Данные' }

/** Общий каркас листа: компактная шапка (название, фильтры, действия) и кнопка «Скачать PDF», сохраняющая именно этот лист.
 *  Содержимое листа занимает всю оставшуюся высоту окна — прокрутки страницы нет. */
export function SheetFrame({ id, children, actions, captionExtra }: { id: SheetId; children: ReactNode; actions?: ReactNode; captionExtra?: string }) {
  const { filters, notify } = useStore()
  const ref = useRef<HTMLElement>(null)
  const [busy, setBusy] = useState(false)
  const caption = filterCaption(filters) + (captionExtra ? ' · ' + captionExtra : '')

  // Служебный вход для автоматической проверки PDF: возвращает страницы листа картинками (в интерфейсе не используется)
  useEffect(() => {
    ;(window as unknown as { __pdfPages?: () => Promise<string[]> }).__pdfPages = async () => {
      const r = await withExportMode(() => renderSheetPages(ref.current!, TITLE[id], caption))
      return r.pages.map((p) => p.toDataURL('image/png'))
    }
  }, [id, caption])

  const pdf = async () => {
    if (!ref.current || busy) return
    setBusy(true)
    try {
      await exportSheetPDF(ref.current, TITLE[id], caption, filters.from + '_' + filters.to)
      notify({ tone: 'success', title: 'PDF сохранён', text: 'Лист «' + TITLE[id] + '» — в папке загрузок.' })
    } catch (e) {
      console.error(e)
      notify({ tone: 'danger', title: 'Не удалось сформировать PDF', text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <motion.section
      ref={ref} id={'sheet-' + id} className={'sheet sheet--' + id} data-title={TITLE[id]}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.08 } }} transition={{ duration: 0.16, ease: EASE_OUT }}
    >
      <div className="sheet-head">
        <div className="sheet-title">
          <h1 className="h-title">{TITLE[id]}</h1>
          <p className="sheet-caption filter-caption">{caption}</p>
        </div>
        <div className="sheet-actions no-print">
          {actions}
          <Button className="pdf-btn" onClick={pdf} disabled={busy}><FileDown size={16} strokeWidth={1.5} />{busy ? 'Готовлю PDF…' : 'Скачать PDF'}</Button>
        </div>
      </div>
      {children}
    </motion.section>
  )
}
