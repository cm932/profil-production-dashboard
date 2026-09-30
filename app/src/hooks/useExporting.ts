import { useEffect, useState } from 'react'

/** true, пока лист снимается в PDF (см. withExportMode в lib/pdf.ts) */
export function useExporting() {
  const [on, setOn] = useState(() => typeof document !== 'undefined' && document.body.classList.contains('exporting'))
  useEffect(() => {
    const h = (e: Event) => setOn(!!(e as CustomEvent<boolean>).detail)
    window.addEventListener('profil:exporting', h)
    return () => window.removeEventListener('profil:exporting', h)
  }, [])
  return on
}
