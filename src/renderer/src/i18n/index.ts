import { useCallback } from 'react'
import { useSettings, type Language } from '../hooks/useSettings'
import { en, type MessageKey } from './en'
import { vi } from './vi'

export type { MessageKey }
export type Params = Readonly<Record<string, string | number>>
export type Translate = (key: MessageKey, params?: Params) => string

export const DICTIONARIES: Record<Language, Record<MessageKey, string>> = { en, vi }

/** Fill {name} placeholders; unknown placeholders are left as written. */
export function translate(language: Language, key: MessageKey, params?: Params): string {
  return DICTIONARIES[language][key].replace(/\{(\w+)\}/g, (match, name: string) =>
    params && name in params ? String(params[name]) : match
  )
}

/** `{base}_one` for a count of 1, `{base}_other` otherwise; {count} is filled in. */
export function translateCount(language: Language, base: string, count: number, params?: Params): string {
  const key = `${base}_${count === 1 ? 'one' : 'other'}` as MessageKey
  return translate(language, key, { count, ...params })
}

/** BCP 47 locale for dates and relative times. */
export const localeOf = (language: Language): string => (language === 'vi' ? 'vi-VN' : 'en-US')

export function useT(): Translate {
  const { language } = useSettings()
  return useCallback((key, params) => translate(language, key, params), [language])
}

export function useTCount(): (base: string, count: number, params?: Params) => string {
  const { language } = useSettings()
  return useCallback((base, count, params) => translateCount(language, base, count, params), [language])
}
