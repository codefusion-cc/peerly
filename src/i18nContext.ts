import { createContext, useContext } from 'react'
import type { Locale, Strings } from './i18n.ts'

export type I18n = { locale: Locale; t: Strings; setLocale(locale: Locale): void }

export const I18nContext = createContext<I18n | null>(null)

/** The page's strings and language (inside `I18nProvider`). */
export function useI18n(): I18n {
  const value = useContext(I18nContext)
  if (!value) throw new Error('useI18n must be used inside <I18nProvider>')
  return value
}
