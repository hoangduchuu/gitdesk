import { describe, expect, test } from 'vitest'
import { en } from '../src/renderer/src/i18n/en'
import { vi } from '../src/renderer/src/i18n/vi'

const placeholders = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort()

describe('translations', () => {
  test('Vietnamese has exactly the English keys, none empty', () => {
    expect(Object.keys(vi).sort()).toEqual(Object.keys(en).sort())
    for (const [key, value] of Object.entries(vi)) expect(value.trim(), key).not.toBe('')
  })

  test('every translation keeps the same placeholders', () => {
    for (const key of Object.keys(en) as Array<keyof typeof en>) {
      expect(placeholders(vi[key]), key).toEqual(placeholders(en[key]))
    }
  })

  test('counted strings come in _one/_other pairs', () => {
    const counted = Object.keys(en).filter((key) => /_(one|other)$/.test(key))
    for (const key of counted) {
      const base = key.replace(/_(one|other)$/, '')
      expect(Object.keys(en), base).toEqual(expect.arrayContaining([`${base}_one`, `${base}_other`]))
    }
  })
})
