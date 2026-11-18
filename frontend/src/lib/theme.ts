import { useEffect, useLayoutEffect, useState } from 'react'

export type ThemePreference = 'light' | 'dark' | 'system'
const storageKey = 'studio-theme'
function readPreference(): ThemePreference {
  try {
    const value = localStorage.getItem(storageKey)
    if (value === 'light' || value === 'dark') return value
  } catch { /* Storage can be unavailable in private sessions. */ }
  return 'system'
}
export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>(readPreference)
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)
  const dark = preference === 'system' ? systemDark : preference === 'dark'
  useLayoutEffect(() => {
    const root = document.documentElement
    root.dataset.theme = dark ? 'dark' : 'light'
    root.classList.toggle('dark', dark)
    root.style.colorScheme = dark ? 'dark' : 'light'
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0c0c0e' : '#f7f7f8')
  }, [dark])
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)')
    const update = () => setSystemDark(media.matches)
    media.addEventListener('change', update)
    update()
    const sync = (event: StorageEvent) => { if (event.key === storageKey || event.key === null) setPreference(readPreference()) }
    window.addEventListener('storage', sync)
    return () => { media.removeEventListener('change', update); window.removeEventListener('storage', sync) }
  }, [])
  function changeTheme(value: ThemePreference) {
    setPreference(value)
    try { localStorage.setItem(storageKey, value) } catch { /* Keep this session's selection. */ }
  }
  return { preference, dark, changeTheme }
}
