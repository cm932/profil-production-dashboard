import { useEffect, useState } from 'react'

/** Истина, пока лист снимается в PDF: лист «Данные» на это время показывает все строки, а не одну страницу. */
export function useExporting() {
  const [on, setOn] = useState(false)
  useEffect(() => {
    const h = (e: Event) => setOn(!!(e as CustomEvent<boolean>).detail)
    window.addEventListener('profil:exporting', h)
    return () => window.removeEventListener('profil:exporting', h)
  }, [])
  return on
}
