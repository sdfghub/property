import React from 'react'
import { Lang, TranslationKey, translations } from './lang'

type I18nContextValue = {
  lang: Lang
  setLang: (lang: Lang) => void
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string
  available: Lang[]
}

const STORAGE_KEY = 'pe-lang'
const allLangs = Object.keys(translations) as Lang[]

function detectInitial(): Lang {
  // 1) honor cached choice, 2) fall back to browser language, 3) default to English.
  if (typeof localStorage !== 'undefined') {
    const cached = localStorage.getItem(STORAGE_KEY) as Lang | null
    if (cached && allLangs.includes(cached)) return cached
  }
  if (typeof navigator !== 'undefined') {
    const nav = navigator.language?.toLowerCase() || ''
    if (nav.startsWith('ro')) return 'ro'
  }
  return 'en'
}

function interpolate(template: string, vars?: Record<string, string | number>) {
  if (!vars) return template
  return Object.keys(vars).reduce((out, key) => out.replace(new RegExp(`{{${key}}}`, 'g'), String(vars[key])), template)
}

// Simple context-powered i18n with localStorage persistence.
// Keeps implementation tiny while still supporting variable substitution.
const I18nContext = React.createContext<I18nContextValue | null>(null)

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = React.useState<Lang>(() => detectInitial())

  const setLang = React.useCallback((l: Lang) => {
    setLangState(l)
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, l)
  }, [])

  const t = React.useCallback(
    (key: TranslationKey, vars?: Record<string, string | number>) => {
      const template = translations[lang]?.[key] ?? translations.en[key] ?? key
      return interpolate(template, vars)
    },
    [lang],
  )

  const value: I18nContextValue = { lang, setLang, t, available: allLangs }
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const ctx = React.useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>')
  return ctx
}
