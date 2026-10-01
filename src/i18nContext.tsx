import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { detectLocale, storeLocale, STRINGS, type Locale, type Strings } from './i18n.ts'

type I18n = { locale: Locale; t: Strings; setLocale(locale: Locale): void }

const I18nContext = createContext<I18n | null>(null)

/** The page's language: the strings every component reads, and switching them. */
export function I18nProvider({ children, initial }: { children: ReactNode; initial?: Locale }) {
  const [locale, setLocale] = useState<Locale>(() => initial ?? detectLocale())
  useEffect(() => { document.documentElement.lang = locale }, [locale])
  const value = useMemo<I18n>(() => ({
    locale, t: STRINGS[locale],
    setLocale: next => { storeLocale(next); setLocale(next) },
  }), [locale])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18n {
  const value = useContext(I18nContext)
  if (!value) throw new Error('useI18n must be used inside <I18nProvider>')
  return value
}
