import type { SelectionRequest } from '../../shared/api'
import { buildPartialPatch } from '../../shared/partial-patch'
import { readDiff } from './diff'
import { runGit } from './exec'

type HunkAction = SelectionRequest['action']
type HunkSource = SelectionRequest['source']

const APPLY_ARGS: Record<HunkAction, string[]> = {
  stage: ['apply', '--cached', '--recount', '-'],
  unstage: ['apply', '--cached', '-R', '--recount', '-'],
  discard: ['apply', '-R', '--recount', '-']
}

const ALLOWED: Record<HunkSource, readonly HunkAction[]> = {
  unstaged: ['stage', 'discard'],
  staged: ['unstage']
}

/** Stage, unstage or discard selected hunks or lines of one tracked file. */
export async function applySelection(repo: string, request: SelectionRequest): Promise<void> {
  const { path, source, action, selections, expectedDiff } = request
  if (!ALLOWED[source].includes(action)) throw new Error(`Cannot ${action} ${source} changes`)

  const current = await readDiff(repo, { kind: 'working', path, staged: source === 'staged', untracked: false })
  if (current !== expectedDiff) throw new Error(`${path} changed since its diff was shown; review it again`)

  const patch = buildPartialPatch(current, selections, action !== 'stage')
  if (patch === null) throw new Error('The selection contains no changes')
  await runGit(repo, APPLY_ARGS[action], { input: patch })
}
