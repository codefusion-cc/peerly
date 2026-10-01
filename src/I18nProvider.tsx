import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { detectLocale, storeLocale, STRINGS, type Locale } from './i18n.ts'
import { I18nContext, type I18n } from './i18nContext.ts'

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
