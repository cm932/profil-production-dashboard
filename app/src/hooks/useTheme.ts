import { useCallback, useEffect, useState } from 'react'

/** Тема = значение data-theme на <html>. Компоненты о ней не знают — только токены VOLT. */
export function useTheme() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const set = document.documentElement.dataset.theme as 'dark' | 'light' | undefined
    if (set) return set
    return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  })
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem('volt-theme', theme) } catch { /* приватный режим */ }
  }, [theme])
  const toggle = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), [])
  return { theme, toggle }
}
