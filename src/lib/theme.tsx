import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

export type AppTheme = 'winweb' | 'copper'

interface ThemeContextValue {
  theme: AppTheme
  toggleTheme: () => void
}

const STORAGE_KEY = 'notiz-app-theme'
const ThemeContext = createContext<ThemeContextValue | null>(null)

function savedTheme(): AppTheme {
  return localStorage.getItem(STORAGE_KEY) === 'copper' ? 'copper' : 'winweb'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<AppTheme>(savedTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem(STORAGE_KEY, theme)
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'winweb' ? '#11151f' : '#17140f')
  }, [theme])

  return <ThemeContext.Provider value={{ theme, toggleTheme: () => setTheme((value) => value === 'winweb' ? 'copper' : 'winweb') }}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const value = useContext(ThemeContext)
  if (!value) throw new Error('useTheme muss innerhalb des ThemeProvider verwendet werden.')
  return value
}

