import { useEffect, useState } from 'react'
import type { Result } from '../../../shared/types'
import { errorMessage, unwrap } from '../api'

export type FilesState<T> = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; files: T[] }

/** Load a file list (commit or stash) whenever its key changes. */
export function useFiles<T>(key: string, load: () => Promise<Result<T[]>>): FilesState<T> {
  const [state, setState] = useState<FilesState<T>>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    setState({ kind: 'loading' })
    load()
      .then(unwrap)
      .then((files) => !cancelled && setState({ kind: 'ready', files }))
      .catch((error) => !cancelled && setState({ kind: 'error', message: errorMessage(error) }))
    return () => {
      cancelled = true
    }
    // `load` is recreated every render; the key identifies what to load.
  }, [key])

  return state
}
