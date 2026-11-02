/** A branch being dragged, or a branch it is dropped on. */
export interface DragBranch {
  name: string
  kind: 'local' | 'remote'
}

/** Dropping a branch on itself does nothing, and two remote branches cannot be combined from here. */
export const canDropBranch = (source: DragBranch, target: DragBranch): boolean => {
  if (source.name === target.name) return false
  return source.kind === 'local' || target.kind === 'local'
}

export type BranchDropAction = 'merge' | 'rebase'

/**
 * What dropping `source` on `target` can do: merge into a local target, and rebase a local
 * source onto the target (a remote target is the usual "rebase onto origin/x").
 */
export const branchDropActions = (source: DragBranch, target: DragBranch): BranchDropAction[] => [
  ...(target.kind === 'local' ? (['merge'] as const) : []),
  ...(source.kind === 'local' ? (['rebase'] as const) : [])
]
