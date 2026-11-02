import { useEffect, useState } from 'react'
import { api } from '../api'
import { useSettings } from './useSettings'

/**
 * Pictures for the given author emails of one commit, as `data:` URIs (null: none found), per the
 * Avatars setting. Initials stay in place until a picture arrives, and nothing is asked when it is off.
 */
export function useAvatars(repo: string, hash: string, emails: readonly string[]): Record<string, string | null> {
  const { avatars } = useSettings()
  const [found, setFound] = useState<Record<string, string | null>>({})
  const key = emails.join('\n')

  useEffect(() => setFound({}), [repo, hash, avatars])
  useEffect(() => {
    if (avatars === 'off' || key === '') return
    let cancelled = false
    api()
      .getAvatars(repo, hash, key.split('\n'), avatars === 'gravatar')
      .then((result) => {
        if (!cancelled && result.ok) setFound((current) => ({ ...current, ...result.data }))
      })
      .catch(() => undefined) // a missing picture is not worth an error
    return () => {
      cancelled = true
    }
  }, [repo, hash, avatars, key])

  return avatars === 'off' ? {} : found
}
