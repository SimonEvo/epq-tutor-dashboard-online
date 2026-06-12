import { create } from 'zustand'
import { DEFAULT_THEME_ID, THEME_STORAGE_KEY } from '@/lib/themes'

function applyTheme(id: string) {
  document.documentElement.setAttribute('data-theme', id)
  localStorage.setItem(THEME_STORAGE_KEY, id)
}

interface ThemeState {
  themeId: string
  setTheme: (id: string) => void
}

export const useThemeStore = create<ThemeState>((set) => ({
  themeId: localStorage.getItem(THEME_STORAGE_KEY) ?? DEFAULT_THEME_ID,
  setTheme: (id: string) => {
    applyTheme(id)
    set({ themeId: id })
  },
}))

export function initTheme() {
  const id = localStorage.getItem(THEME_STORAGE_KEY) ?? DEFAULT_THEME_ID
  document.documentElement.setAttribute('data-theme', id)
}
