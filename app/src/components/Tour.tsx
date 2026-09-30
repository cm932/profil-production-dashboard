// Приветственный тур: по шагам подсвечивает части интерфейса и объясняет, что с ними делать.
// Открывается сам при первом входе пользователя (запоминается в браузере) и в любой момент — кнопкой «Как пользоваться».
// Шаги зависят от роли: чего у роли нет (деньги, админ-панель, записи), о том тур не рассказывает.
// Подсветка переезжает от элемента к элементу пружиной без отскока (навык apple-design); при «уменьшить движение» — без перемещений.
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { Button } from '@/components/ui'
import { SPRING } from '@/lib/motion'
import type { Perms, SheetId } from '@/lib/types'
import { useStore } from '@/store'

interface Step {
  target?: string          // CSS-селектор; без него — карточка по центру
  sheet?: SheetId          // на каком листе показать
  view?: string            // какую вкладку листа открыть (текст вкладки)
  title: string
  text: string
  when?: (p: Perms, mode: string) => boolean
}

const STEPS: Step[] = [
  { title: 'Добро пожаловать в «Профиль»', text: 'Панель собирает журналы простоев и брака и показывает, где фабрика теряет время и деньги и что с этим делать. Короткий тур — 1 минута. Его можно пропустить и открыть позже кнопкой «Как пользоваться» в меню слева.' },
  { target: '.nav', title: 'Листы', text: 'Слева — листы: «Сводка» с главным, «Простои» и «Брак» с подробностями, «Данные» с исходными таблицами. Набор листов зависит от вашей роли.' },
  { target: '.tb-filters', title: 'Фильтры', text: 'Период, смена и цех. Фильтры меняют сразу все цифры, графики и выводы на всех листах. Кнопки «Нед. 1–4» выбирают неделю одним щелчком.' },
  { target: '#kpis', sheet: 'summary', title: 'Главные показатели', text: 'Сколько времени потеряно на внеплановых простоях, какая доступность станков, сколько брака. Наведите на показатель — появится расшифровка.', when: (p) => p.sheets.includes('summary') },
  { target: '.ins-grid', sheet: 'summary', title: 'Выводы: что случилось и что делать', text: 'Три главных вывода за выбранный период: цифра, пояснение и конкретное действие. «Подробнее» открывает разбор с графиком.', when: (p) => p.sheets.includes('summary') },
  { target: '#allInsights', sheet: 'summary', title: 'Все выводы', text: 'Здесь — полный список выводов за период, включая общую картину потерь.', when: (p) => p.sheets.includes('summary') },
  { target: '.view-tabs', sheet: 'downtime', view: 'По дням', title: 'Вкладки листа', text: 'У листов «Простои» и «Брак» есть вкладки: на экране — одна тема крупно, без прокрутки. «По дням» — тепловая карта: какой станок и когда простаивал.', when: (p) => p.sheets.includes('downtime') },
  { target: '.heat-chips', sheet: 'downtime', view: 'По дням', title: 'Причины простоя', text: 'Выберите причину — на карте останутся только её простои. Так видно, например, что «Ожидание заготовок» у К-1 шло 4 дня подряд.', when: (p) => p.sheets.includes('downtime') },
  { target: '.view-tabs', sheet: 'defects', title: 'Брак по дням и по неделям', text: '«По дням» — сколько брака и на какой операции; «По неделям» — день и ночь по каждой операции в одной шкале и типы дефектов.', when: (p) => p.sheets.includes('defects') },
  { target: '.pdf-btn', title: 'PDF', text: 'Сохраняет открытый лист в PDF — со всеми вкладками, в светлом оформлении для печати, с подписью фильтров на каждой странице.', when: (p) => p.pdf },
  { target: '.table-card', sheet: 'data', title: 'Исходные данные', text: 'Обе таблицы с поиском и сортировкой. Над таблицей — итоги по видимым строкам, чтобы любую цифру панели можно было проверить вручную.', when: (p) => p.sheets.includes('data') },
  { target: '#addRecord', sheet: 'data', title: 'Добавление записей', text: 'Ваша роль может вносить записи в журнал. Свои записи можно исправить или удалить — значки в конце строки.', when: (p, mode) => mode === 'app' && Object.keys(p.records).length > 0 },
  { target: '#fileInput-btn', title: 'Загрузка своих файлов', text: 'CSV и XLSX с журналами простоев и брака. Панель сама поймёт, где какой журнал, и покажет отчёт о пропущенных строках.', when: (p) => p.upload },
  { target: '[data-nav="admin"]', title: 'Админ-панель', text: 'Пользователи и роли, сброс паролей, журнал действий. Видна только администратору.', when: (p) => p.users },
  { target: '#tourBtn', title: 'Тур всегда под рукой', text: 'Этот тур можно открыть снова кнопкой «Как пользоваться». Удачной работы!' },
]

const PAD = 8
const seenKey = (login: string) => 'profil.tour.seen.' + login

type Rect = { top: number; left: number; width: number; height: number }

export function Tour({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { perms, mode, setSheet } = useStore()
  const steps = useMemo(() => STEPS.filter((s) => !s.when || s.when(perms, mode)), [perms, mode])
  const [i, setI] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)
  const [vw, setVw] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }))
  const step = steps[Math.min(i, steps.length - 1)]

  useEffect(() => { if (open) setI(0) }, [open])

  // Переход на нужный лист и вкладку, затем ждём, пока элемент появится, и меряем его
  useLayoutEffect(() => {
    if (!open || !step) return
    if (step.sheet) setSheet(step.sheet)
    let raf = 0, tries = 0, clicked = false
    const find = () => {
      if (step.view && !clicked) {
        const tab = [...document.querySelectorAll<HTMLElement>('.view-tabs .tab')].find((t) => t.textContent?.trim() === step.view)
        if (tab) { if (tab.getAttribute('aria-selected') !== 'true') tab.click(); clicked = true }
      }
      const el = step.target ? document.querySelector<HTMLElement>(step.target) : null
      if (step.target && !el && tries++ < 90) { raf = requestAnimationFrame(find); return }
      if (!el) { setRect(null); return }
      const r = el.getBoundingClientRect()
      setRect({ top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 })
    }
    raf = requestAnimationFrame(find)
    const onResize = () => { setVw({ w: window.innerWidth, h: window.innerHeight }); cancelAnimationFrame(raf); tries = 0; raf = requestAnimationFrame(find) }
    window.addEventListener('resize', onResize)
    // лист появляется с анимацией — перемеряем, когда она закончится
    const t = setTimeout(() => { tries = 0; raf = requestAnimationFrame(find) }, 420)
    return () => { cancelAnimationFrame(raf); clearTimeout(t); window.removeEventListener('resize', onResize) }
  }, [open, step, setSheet])

  const next = useCallback(() => (i >= steps.length - 1 ? onClose() : setI(i + 1)), [i, steps.length, onClose])
  const prev = useCallback(() => setI((x) => Math.max(0, x - 1)), [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
      else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); next() }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); prev() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, next, prev, onClose])

  // Карточка — под подсветкой, если снизу есть место; иначе над ней; иначе справа. Всегда в пределах окна.
  const CW = 360, CH = 210, M = 12
  let pos: { top: number; left: number }
  if (!rect) pos = { top: vw.h / 2 - CH / 2, left: vw.w / 2 - CW / 2 }
  else if (rect.top + rect.height + M + CH < vw.h) pos = { top: rect.top + rect.height + M, left: rect.left }
  else if (rect.top - M - CH > 0) pos = { top: rect.top - M - CH, left: rect.left }
  else pos = { top: rect.top + 8, left: rect.left + rect.width + M }
  pos = { top: Math.max(M, Math.min(pos.top, vw.h - CH - M)), left: Math.max(M, Math.min(pos.left, vw.w - CW - M)) }

  return createPortal(
    <AnimatePresence>
      {open && step && (
        <motion.div className="tour" key="tour" role="dialog" aria-modal="true" aria-labelledby="tourTitle"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.15 } }} transition={{ duration: 0.2 }}>
          {/* подсветка: «дыра» в затемнении вокруг элемента; без элемента — сплошное затемнение */}
          <motion.div className="tour-spot" aria-hidden
            initial={false}
            animate={rect ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height, opacity: 1 } : { top: vw.h / 2, left: vw.w / 2, width: 0, height: 0, opacity: 1 }}
            transition={SPRING} />
          <motion.div className="tour-card" style={{ width: CW }}
            initial={false} animate={{ top: pos.top, left: pos.left }} transition={SPRING}>
            <div className="tour-count">{i + 1} из {steps.length}</div>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
                <h2 id="tourTitle" className="tour-title">{step.title}</h2>
                <p className="tour-text">{step.text}</p>
              </motion.div>
            </AnimatePresence>
            <div className="tour-actions">
              <Button variant="ghost" size="sm" id="tourSkip" onClick={onClose}>{i >= steps.length - 1 ? 'Закрыть' : 'Пропустить'}</Button>
              <div className="tour-nav">
                {i > 0 && <Button size="sm" onClick={prev} aria-label="Назад"><ChevronLeft size={15} strokeWidth={2} />Назад</Button>}
                <Button size="sm" variant="primary" id="tourNext" onClick={next} data-autofocus>{i >= steps.length - 1 ? 'Готово' : 'Далее'}{i < steps.length - 1 && <ChevronRight size={15} strokeWidth={2} />}</Button>
              </div>
            </div>
            <button className="tour-close" aria-label="Закрыть тур" onClick={onClose}><X size={15} strokeWidth={2} /></button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

/** Состояние тура: открыт ли; при первом входе пользователя открывается сам (один раз для каждого логина в этом браузере). */
export function useTour() {
  const { user, mode } = useStore()
  const [open, setOpen] = useState(false)
  const login = user?.login ?? 'demo'
  useEffect(() => {
    if (!['app', 'sealed', 'demo'].includes(mode)) return
    let off = false
    try { off = localStorage.getItem('profil.tour.off') === '1' || localStorage.getItem(seenKey(login)) === '1' } catch { /* нет хранилища */ }
    if (off) return
    const t = setTimeout(() => setOpen(true), 700)
    return () => clearTimeout(t)
  }, [mode, login])
  const close = useCallback(() => {
    setOpen(false)
    try { localStorage.setItem(seenKey(login), '1') } catch { /* нет хранилища */ }
  }, [login])
  return { open, start: () => setOpen(true), close }
}
