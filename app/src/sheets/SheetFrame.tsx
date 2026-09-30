import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { FileDown } from 'lucide-react'
import { Button, Segmented } from '@/components/ui'
import { EASE_OUT } from '@/lib/motion'
import { filterCaption } from '@/lib/model'
import { exportSheetPDF, renderSheetPages, withExportMode } from '@/lib/pdf'
import type { SheetId } from '@/lib/types'
import { useExporting } from '@/hooks/useExporting'
import { useStore } from '@/store'

const TITLE: Record<SheetId, string> = { summary: 'Сводка', downtime: 'Простои', defects: 'Брак', data: 'Данные', admin: 'Администрирование' }

/** Вкладка внутри листа: на экране видна одна (крупно, без прокрутки), в PDF — все подряд, каждая с новой страницы. */
export interface SheetView { id: string; label: string; render: () => ReactNode }

// Выбранная вкладка запоминается для каждого листа, пока открыта панель
const lastView: Partial<Record<SheetId, string>> = {}

/** Общий каркас листа: шапка (название, фильтры строкой, вкладки, действия) и кнопка «Скачать PDF», сохраняющая именно этот лист.
 *  Содержимое занимает всю оставшуюся высоту окна — прокрутки страницы нет. */
export function SheetFrame({ id, children, views, actions, captionExtra, caption: captionOverride }: {
  id: SheetId; children?: ReactNode; views?: SheetView[]; actions?: ReactNode; captionExtra?: string; caption?: string
}) {
  const { filters, notify, perms, shops } = useStore()
  const ref = useRef<HTMLElement>(null)
  const [busy, setBusy] = useState(false)
  const exporting = useExporting()
  const [view, setViewState] = useState(() => lastView[id] ?? views?.[0]?.id ?? '')
  const setView = (v: string) => { lastView[id] = v; setViewState(v) }
  const cur = views?.find((v) => v.id === view) ?? views?.[0]
  const caption = captionOverride ?? filterCaption(filters, shops.length === 1) + (captionExtra ? ' · ' + captionExtra : '')

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
      notify({ tone: 'success', title: 'PDF сохранён', text: 'Лист «' + TITLE[id] + '»' + (views && views.length > 1 ? ' (все вкладки)' : '') + ' — в папке загрузок.' })
    } catch (e) {
      console.error(e)
      notify({ tone: 'danger', title: 'Не удалось сформировать PDF', text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <motion.section
      ref={ref} id={'sheet-' + id} className={'sheet sheet--' + id + (views ? ' sheet--views' : '')} data-title={TITLE[id]} data-view={cur?.id}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.08 } }} transition={{ duration: 0.16, ease: EASE_OUT }}
    >
      <div className="sheet-head">
        <div className="sheet-title">
          <h1 className="h-title">{TITLE[id]}</h1>
          <p className="sheet-caption filter-caption" title={caption}>{caption}</p>
        </div>
        {views && views.length > 1 && (
          <div className="view-tabs no-print">
            <Segmented label={'Вкладки листа «' + TITLE[id] + '»'} value={cur!.id} items={views.map((v) => ({ id: v.id, label: v.label }))} onChange={setView} />
          </div>
        )}
        <div className="sheet-actions no-print">
          {actions}
          {perms.pdf && id !== 'admin' && <Button className="pdf-btn" onClick={pdf} disabled={busy}><FileDown size={16} strokeWidth={1.5} />{busy ? 'Готовлю PDF…' : 'Скачать PDF'}</Button>}
        </div>
      </div>
      {children}
      {views && (exporting
        ? views.map((v) => (
          <div key={v.id} className="view view--print" data-view={v.id}>
            {views.length > 1 && <h2 className="view-print-title">{v.label}</h2>}
            <div className="view-body">{v.render()}</div>
          </div>
        ))
        : (
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={cur!.id} className="view" data-view={cur!.id}
              initial={{ opacity: 0, transform: 'translateY(6px)' }} animate={{ opacity: 1, transform: 'translateY(0px)' }}
              exit={{ opacity: 0, transition: { duration: 0.08 } }} transition={{ duration: 0.2, ease: EASE_OUT }}
            >
              {cur!.render()}
            </motion.div>
          </AnimatePresence>
        ))}
    </motion.section>
  )
}
