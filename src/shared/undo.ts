export type UndoKind = 'commit' | 'reset' | 'checkout'

/** The kinds of last action GitDesk can take back, from the text of the newest reflog entry. */
export function undoKindOf(action: string): UndoKind | null {
  if (action.startsWith('commit: ') || action.startsWith('commit (amend): ')) return 'commit'
  if (action.startsWith('reset: moving to ')) return 'reset'
  if (/^checkout: moving from \S+ to \S+$/.test(action)) return 'checkout'
  return null
}

/** Where `checkout: moving from <from> to <to>` came from: a branch name, or a commit when HEAD was detached. */
export function checkoutOrigin(action: string): { name: string; detached: boolean } | null {
  const match = /^checkout: moving from (\S+) to \S+$/.exec(action)
  if (!match) return null
  const name = match[1]!
  return { name, detached: /^[0-9a-f]{40,64}$/.test(name) }
}
