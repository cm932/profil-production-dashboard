import { useEffect } from 'react'
import { AnimatePresence, MotionConfig } from 'motion/react'
import { animate, stagger } from 'animejs'
import { LoadReport, Sidebar, Topbar } from '@/components/Shell'
import { ToastHost } from '@/components/ui'
import { prefersReduced } from '@/lib/motion'
import { Defects } from '@/sheets/Defects'
import { DataSheet } from '@/sheets/DataSheet'
import { Downtime } from '@/sheets/Downtime'
import { Summary } from '@/sheets/Summary'
import { StoreProvider, useStore } from '@/store'

function Sheets() {
  const { sheet } = useStore()
  return (
    <AnimatePresence mode="wait" initial={false}>
      {sheet === 'summary' && <Summary key="summary" />}
      {sheet === 'downtime' && <Downtime key="downtime" />}
      {sheet === 'defects' && <Defects key="defects" />}
      {sheet === 'data' && <DataSheet key="data" />}
    </AnimatePresence>
  )
}

function Shell() {
  const { toast } = useStore()

  // Вход в приложение: оболочка (сайдбар, панели) появляется каскадом на anime.js, затем работает motion внутри листов
  useEffect(() => {
    if (prefersReduced()) return
    const targets = ['.brand', '.nav-item', '.sidebar-foot', '.topbar']
    const els = targets.flatMap((s) => Array.from(document.querySelectorAll<HTMLElement>(s)))
    const a = animate(els, { opacity: [0, 1], translateY: [6, 0], duration: 320, ease: 'outQuart', delay: stagger(36) })
    return () => { a.cancel(); els.forEach((e) => { e.style.opacity = ''; e.style.transform = '' }) }
  }, [])

  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <Topbar />
        <main className="content">
          <LoadReport />
          <Sheets />
        </main>
      </div>
      <ToastHost toast={toast} />
      {/* на время снимка PDF закрывает экран: пользователь не видит смену темы и раскрытую таблицу */}
      <div className="export-overlay" aria-hidden><div className="export-msg">Готовлю PDF…</div></div>
    </div>
  )
}

export default function App() {
  return (
    // reducedMotion="user": при системной настройке «уменьшить движение» переходы motion отключаются
    <MotionConfig reducedMotion="user">
      <StoreProvider>
        <Shell />
      </StoreProvider>
    </MotionConfig>
  )
}
