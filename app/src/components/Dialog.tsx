// Модальное окно VOLT: затемнённая подложка, окно вырастает из центра (scale 0.96 → 1, а не из нуля), Esc закрывает,
// Tab не выходит за пределы окна, фокус возвращается туда, откуда открыли.
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui'
import { EASE_OUT, SPRING } from '@/lib/motion'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function Dialog({ open, onClose, title, children, footer, dismissible = true, width = 480 }: {
  open: boolean; onClose?: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; dismissible?: boolean; width?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()

  useEffect(() => {
    if (!open) return
    const back = document.activeElement as HTMLElement | null
    const t = setTimeout(() => { (ref.current?.querySelector<HTMLElement>('[data-autofocus]') ?? ref.current?.querySelector<HTMLElement>(FOCUSABLE))?.focus() }, 30)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissible) { e.stopPropagation(); onClose?.(); return }
      if (e.key !== 'Tab' || !ref.current) return
      const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
      if (!items.length) return
      const first = items[0], last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => { clearTimeout(t); document.removeEventListener('keydown', onKey); back?.focus?.() }
  }, [open, dismissible, onClose])

  // Окно рисуется в корне страницы (портал): иначе его обрезает и сдвигает родитель — например, боковое меню,
  // у которого включена обрезка содержимого и анимация (так «резалось» окно смены пароля)
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && dismissible) onClose?.() }}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.1 } }} transition={{ duration: 0.16, ease: EASE_OUT }}
        >
          <motion.div
            ref={ref} className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} style={{ width }}
            initial={{ opacity: 0, transform: 'scale(0.96)' }} animate={{ opacity: 1, transform: 'scale(1)' }}
            exit={{ opacity: 0, transform: 'scale(0.98)', transition: { duration: 0.12 } }} transition={SPRING}
          >
            <div className="dialog-head">
              <h2 id={titleId} className="dialog-title">{title}</h2>
              {dismissible && <Button size="sm" variant="ghost" aria-label="Закрыть" onClick={onClose}><X size={16} strokeWidth={1.5} /></Button>}
            </div>
            <div className="dialog-body">{children}</div>
            {footer && <div className="dialog-foot">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
