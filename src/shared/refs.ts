import type { Ref } from './types'

const HEAD_PREFIX = 'HEAD -> '
const TAG_PREFIX = 'tag: '
const LOCAL = 'refs/heads/'
const REMOTE = 'refs/remotes/'
const TAGS = 'refs/tags/'

const classify = (fullName: string, isHead: boolean): Ref | null => {
  if (fullName.startsWith(LOCAL)) {
    return { name: fullName.slice(LOCAL.length), kind: isHead ? 'head' : 'branch' }
  }
  if (fullName.startsWith(REMOTE)) {
    const name = fullName.slice(REMOTE.length)
    return name.endsWith('/HEAD') ? null : { name, kind: 'remote' }
  }
  if (fullName.startsWith(TAGS)) return { name: fullName.slice(TAGS.length), kind: 'tag' }
  return null
}

/** Parse `git log --decorate=full` `%D` entries into labelled refs. */
export const parseDecorations = (decorations: readonly string[]): Ref[] =>
  decorations.flatMap((decoration): Ref[] => {
    if (decoration === 'HEAD') return [{ name: 'HEAD', kind: 'head' }]
    const isHead = decoration.startsWith(HEAD_PREFIX)
    const withoutHead = isHead ? decoration.slice(HEAD_PREFIX.length) : decoration
    const fullName = withoutHead.startsWith(TAG_PREFIX)
      ? withoutHead.slice(TAG_PREFIX.length)
      : withoutHead
    const ref = classify(fullName, isHead)
    return ref ? [ref] : []
  })

export interface RefLabel {
  label: string
  kind: 'branch' | 'tag'
  /** HEAD points here (current branch or detached HEAD). */
  isHead: boolean
  local: boolean
  remote: boolean
}

const withoutRemote = (name: string): string => name.slice(name.indexOf('/') + 1)

/**
 * One label per branch: a local branch and a remote branch of the same name share it.
 * HEAD comes first, then branches in order, tags last.
 */
export function groupRefs(refs: readonly Ref[]): RefLabel[] {
  const localNames = new Set(refs.filter((ref) => ref.kind === 'branch' || ref.kind === 'head').map((ref) => ref.name))
  const branches = new Map<string, RefLabel>()
  const tags: RefLabel[] = []

  for (const ref of refs) {
    if (ref.kind === 'tag') {
      tags.push({ label: ref.name, kind: 'tag', isHead: false, local: false, remote: false })
      continue
    }
    const isRemote = ref.kind === 'remote'
    const key = isRemote && localNames.has(withoutRemote(ref.name)) ? withoutRemote(ref.name) : ref.name
    const label = branches.get(key) ?? { label: key, kind: 'branch', isHead: false, local: false, remote: false }
    branches.set(key, {
      ...label,
      isHead: label.isHead || ref.kind === 'head',
      local: label.local || (!isRemote && ref.name !== 'HEAD'),
      remote: label.remote || isRemote
    })
  }

  const ordered = [...branches.values()]
  return [...ordered.filter((label) => label.isHead), ...ordered.filter((label) => !label.isHead), ...tags]
}
