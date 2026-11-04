import { beforeEach, describe, expect, test, vi } from 'vitest'

const store = new Map<string, string>()
const stubStorage = (): void => {
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key)
  })
}

// The hook keeps its state at module level and reads storage once, so each test loads a fresh copy.
const load = async () => {
  vi.resetModules()
  stubStorage()
  return import('../src/renderer/src/hooks/useCollapsedSections')
}

beforeEach(() => {
  store.clear()
  vi.unstubAllGlobals()
})

describe('collapsed sidebar sections', () => {
  test('toggling saves the folded sections', async () => {
    const { toggleSection } = await load()

    toggleSection('tags')
    toggleSection('stashes')
    expect(JSON.parse(store.get('gitdesk.collapsedSections')!)).toEqual(['tags', 'stashes'])

    toggleSection('tags')
    expect(JSON.parse(store.get('gitdesk.collapsedSections')!)).toEqual(['stashes'])
  })

  test('a new launch starts with what was saved', async () => {
    store.set('gitdesk.collapsedSections', JSON.stringify(['tags']))
    const { toggleSection } = await load()

    toggleSection('stashes')

    expect(JSON.parse(store.get('gitdesk.collapsedSections')!)).toEqual(['tags', 'stashes'])
  })

  test('ignores unreadable saved data', async () => {
    store.set('gitdesk.collapsedSections', '{not json')
    const { toggleSection } = await load()

    toggleSection('tags')

    expect(JSON.parse(store.get('gitdesk.collapsedSections')!)).toEqual(['tags'])
  })

  test('keeps working when storage is unavailable', async () => {
    vi.resetModules()
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      }
    })
    const { toggleSection } = await import('../src/renderer/src/hooks/useCollapsedSections')

    expect(() => toggleSection('tags')).not.toThrow()
  })
})
