// Примитивы VOLT на классах из components.css (дизайн-система: «если Tailwind не используется»).
// Движение — motion: нажатие кнопки, скользящая «таблетка» переключателей, появление тоста.
import { forwardRef, useId, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { EASE_OUT } from '@/lib/motion'
import { cn } from '@/lib/utils'
import type { ToastMsg } from '@/store'

/* ------------------------------------------------------------------ Button */
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart'> {
  variant?: Variant
  size?: 'sm' | 'md' | 'lg'
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ variant = 'secondary', size = 'md', className, children, ...rest }, ref) => (
  <motion.button
    ref={ref}
    whileTap={{ transform: 'scale(0.97)' }} // отклик на нажатие (на pointerdown): 0.95–0.98, 160 мс; полная строка transform — на GPU
    transition={{ duration: 0.16, ease: EASE_OUT }}
    className={cn('btn', 'btn--' + variant, size !== 'md' && 'btn--' + size, className)}
    {...rest}
  >
    {children}
  </motion.button>
))
Button.displayName = 'Button'

/* ------------------------------------------------------------------- Badge */
export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info'
export const Badge = ({ tone = 'neutral', dot, children }: { tone?: Tone; dot?: boolean; children: ReactNode }) => (
  <span className={cn('badge', tone !== 'neutral' && 'badge--' + tone)}>
    {dot && <i className="led" />}
    {children}
  </span>
)

/* -------------------------------------------------------------------- Card */
export const Card = ({ accent, className, children, ...rest }: { accent?: boolean; className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('card', accent && 'card--accent', className)} {...rest}>{children}</div>
)
export const CardHead = ({ title, sub, aside }: { title: ReactNode; sub?: ReactNode; aside?: ReactNode }) => (
  <div className="card-head">
    <div className="min-w-0">
      <h3 className="card-title">{title}</h3>
      {sub && <p className="hint mt-1">{sub}</p>}
    </div>
    {aside}
  </div>
)

/* --------------------------------------------------------------- Segmented */
/** Переключатель-«таблетка»: акцентная подложка плавно переезжает к выбранному пункту (motion layoutId). */
export function Segmented<T extends string>({ items, value, onChange, label, size }: {
  items: { id: T; label: ReactNode; title?: string }[]
  value: T
  onChange: (v: T) => void
  label: string
  size?: 'sm'
}) {
  const group = useId()
  return (
    <div role="tablist" aria-label={label} className={cn('tabs tabs--slide', size === 'sm' && 'tabs--sm')}>
      {items.map((it) => {
        const on = it.id === value
        return (
          <button key={it.id} role="tab" aria-selected={on} title={it.title} onClick={() => onChange(it.id)} className="tab">
            {on && <motion.span layoutId={'pill' + group} className="tab-pill" transition={{ duration: 0.18, ease: EASE_OUT }} />}
            <span className="tab-label">{it.label}</span>
          </button>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------- Toast */
const LED: Record<ToastMsg['tone'], string> = { success: 'var(--success)', warning: 'var(--warning)', danger: 'var(--danger)', info: 'var(--info)' }

export function ToastHost({ toast }: { toast: ToastMsg | null }) {
  return (
    <div className="toast-host" aria-live="polite">
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            className="toast"
            initial={{ opacity: 0, transform: 'translateY(12px) scale(0.96)' }}
            animate={{ opacity: 1, transform: 'translateY(0px) scale(1)' }}
            exit={{ opacity: 0, transform: 'translateY(8px) scale(0.98)', transition: { duration: 0.14, ease: EASE_OUT } }} // система отвечает — уходит быстрее, чем появилась
            transition={{ duration: 0.22, ease: EASE_OUT }}
          >
            <i className="led" style={{ background: LED[toast.tone] }} />
            <div>
              <b>{toast.title}</b>
              {toast.text && <span>{toast.text}</span>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ------------------------------------------------------------------- Field */
/** Поле = подпись + контрол + подсказка (класс .field из VOLT). */
export const Field = ({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) => (
  <label className="field">
    <span className="label">{label}</span>
    {children}
    {hint && <span className="hint">{hint}</span>}
  </label>
)
