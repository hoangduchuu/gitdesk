import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { useSettings } from './useSettings'

export interface GraphPerson {
  email: string
  /** One of their commits that is on screen. */
  hash: string
}

/** Authors asked about per request: small enough to answer quickly, large enough to fill a screen in a few rounds. */
const BATCH = 12
/** Wait for scrolling to settle before asking, so a fast scroll does not look up everyone it passes. */
const SETTLE_MS = 250

/**
 * Pictures for the authors visible in the commit graph, keyed by lowercase email (null: none found).
 * Each author is asked about once per repository and setting; nothing is asked when the setting is off.
 */
export function useGraphAvatars(repo: string, people: readonly GraphPerson[]): Record<string, string | null> {
  const { avatars } = useSettings()
  const [found, setFound] = useState<Record<string, string | null>>({})
  /** Bumped after each answer, so authors still waiting beyond one batch get their turn. */
  const [round, setRound] = useState(0)
  const asked = useRef(new Set<string>())
  /** Changes with the repository and setting, so a late answer for the old ones is dropped. */
  const generation = useRef(0)
  const key = people.map((person) => person.email.toLowerCase()).join('\n')

  useEffect(() => {
    generation.current += 1
    asked.current = new Set()
    setFound({})
  }, [repo, avatars])

  useEffect(() => {
    if (avatars === 'off') return
    const timer = window.setTimeout(() => {
      const batch: GraphPerson[] = []
      for (const person of people) {
        const email = person.email.toLowerCase()
        if (asked.current.has(email)) continue
        asked.current.add(email)
        batch.push(person)
        if (batch.length >= BATCH) break
      }
      if (batch.length === 0) return
      const current = generation.current
      api()
        .getPeopleAvatars(repo, batch, avatars === 'gravatar')
        .then((result) => {
          if (current !== generation.current || !result.ok) return
          setFound((existing) => ({
            ...existing,
            ...Object.fromEntries(Object.entries(result.data).map(([email, picture]) => [email.toLowerCase(), picture]))
          }))
          setRound((value) => value + 1)
        })
        .catch(() => undefined) // a missing picture is not worth an error
    }, SETTLE_MS)
    return () => window.clearTimeout(timer)
    // `people` is covered by `key`; its objects change identity on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, avatars, key, round])

  return avatars === 'off' ? {} : found
}
