export interface Theme {
  id: string
  label: string
  primary: string
  accent: string
  bg: string
}

export const THEMES: Theme[] = [
  { id: 'dodger-salmon',    label: '道奇蓝 × 珊瑚粉', primary: '#1E90FF', accent: '#FA8072', bg: '#F7F4EF' },
  { id: 'klein-orange',     label: '克莱因蓝 × 焰橙',  primary: '#002FA7', accent: '#F25C2A', bg: '#F5F5F8' },
  { id: 'green-burgundy',   label: '森林绿 × 酒红',    primary: '#2D6A4F', accent: '#8B1A2B', bg: '#F2F5F1' },
  { id: 'caramel-electric', label: '电光蓝 × 焦糖',    primary: '#2148C0', accent: '#C0802A', bg: '#F5F3EF' },
  { id: 'teal-coral',       label: '松石绿 × 珊瑚红',  primary: '#0D9488', accent: '#E45B50', bg: '#F0F7F6' },
  { id: 'morandi',          label: '莫兰迪灰蓝 × 暖棕', primary: '#6B8299', accent: '#C09070', bg: '#F4F2EF' },
]

export const DEFAULT_THEME_ID = 'dodger-salmon'
export const THEME_STORAGE_KEY = 'epq-theme'
