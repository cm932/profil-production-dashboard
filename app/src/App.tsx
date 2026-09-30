import { useEffect } from 'react'
import { AnimatePresence, MotionConfig } from 'motion/react'
import { animate, stagger } from 'animejs'
import { Login, MustChange, ServerDown } from '@/components/Auth'
import { Dialog } from '@/components/Dialog'
import { LoadReport, Sidebar, Topbar } from '@/components/Shell'
import { Button, Card, ToastHost } from '@/components/ui'
import { nf } from '@/lib/format'
import { prefersReduced } from '@/lib/motion'
import { Admin } from '@/sheets/Admin'
import { Defects } from '@/sheets/Defects'
import { DataSheet } from '@/sheets/DataSheet'
import { Downtime } from '@/sheets/Downtime'
import { Summary } from '@/sheets/Summary'
import { StoreProvider, useStore } from '@/store'

function Sheets() {
  const { sheet, bounds, perms } = useStore()
  // Листы, которых у роли нет, не показываем, даже если открыть адрес с #admin вручную (сервер всё равно не отдал бы данные)
  const allowed = perms.sheets.includes(sheet) ? sheet : perms.sheets[0]
  if (!bounds && allowed !== 'admin') {
    return <Card className="empty" id="emptyData">Данных пока нет. {perms.upload ? 'Загрузите журнал простоев или брака кнопкой «Загрузить данные».' : 'Обратитесь к директору или администратору.'}</Card>
  }
  return (
    <AnimatePresence mode="wait" initial={false}>
      {allowed === 'summary' && <Summary key="summary" />}
      {allowed === 'downtime' && <Downtime key="downtime" />}
      {allowed === 'defects' && <Defects key="defects" />}
      {allowed === 'data' && <DataSheet key="data" />}
      {allowed === 'admin' && perms.users && <Admin key="admin" />}
    </AnimatePresence>
  )
}

/** Загрузка файлов на сервере меняет общие данные — спрашиваем: заменить журнал или добавить к нему */
function ImportDialog() {
  const { pendingImport, confirmImport, cancelImport } = useStore()
  return (
    <Dialog open={!!pendingImport} onClose={cancelImport} title="Загрузить данные в базу" width={520}
      footer={
        <div className="dialog-actions">
          <Button variant="ghost" onClick={cancelImport}>Отмена</Button>
          <Button id="importAppend" onClick={() => void confirmImport('append')}>Добавить к существующим</Button>
          <Button variant="danger" id="importReplace" onClick={() => void confirmImport('replace')}>Заменить журнал</Button>
        </div>
      }>
      <ul className="facts">
        {pendingImport?.results.map((r) => (
          <li key={r.fileName}><b>{r.title}</b> из «{r.fileName}»: {nf(r.records.length)} из {nf(r.total)} строк{r.errors.length ? ', ' + r.errors.length + ' пропущено из-за ошибок' : ''}.</li>
        ))}
      </ul>
      <p className="hint">«Заменить» удалит текущие записи выбранных журналов и попадёт в журнал действий. «Добавить» оставит существующие и допишет новые.</p>
    </Dialog>
  )
}

function Workspace() {
  const { toast } = useStore()

  // Вход в приложение: оболочка (сайдбар, панели) появляется каскадом на anime.js, затем работает motion внутри листов
  useEffect(() => {
    if (prefersReduced()) return
    const targets = ['.brand', '.nav-item', '.sidebar-foot', '.sidebar-user', '.topbar']
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
      <ImportDialog />
      {/* на время снимка PDF закрывает экран: пользователь не видит смену темы и раскрытую таблицу */}
      <div className="export-overlay" aria-hidden><div className="export-msg">Готовлю PDF…</div></div>
    </div>
  )
}

function Root() {
  const { mode, toast } = useStore()
  if (mode === 'boot') return <div className="boot" aria-busy="true"><div className="brand-mark">П</div></div>
  if (mode === 'login') return <><Login /><ToastHost toast={toast} /></>
  if (mustChange(mode)) return <><MustChange /><ToastHost toast={toast} /></>
  if (mode === 'error') return <ServerDown />
  return <Workspace />
}
const mustChange = (m: string) => m === 'mustchange'

export default function App() {
  return (
    // reducedMotion="user": при системной настройке «уменьшить движение» переходы motion отключаются
    <MotionConfig reducedMotion="user">
      <StoreProvider>
        <Root />
      </StoreProvider>
    </MotionConfig>
  )
}
