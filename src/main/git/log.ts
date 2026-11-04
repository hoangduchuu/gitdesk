import type { CommitDetails, FileHistoryEntry } from '../../shared/model'
import { parseDecorations } from '../../shared/refs'
import type { Commit } from '../../shared/types'
import { runGit } from './exec'

const FIELD = '\x1f'
// The body comes last: it is free text, so anything after the subject belongs to it.
const FORMAT = ['%H', '%P', '%an', '%ae', '%at', '%D', '%s', '%b'].join('%x1f')
const FIELDS_BEFORE_BODY = 7

const parseRecord = (record: string): Commit | null => {
  const fields = record.split(FIELD)
  if (fields.length <= FIELDS_BEFORE_BODY) return null
  const [hash, parents, authorName, authorEmail, authorTime, refs, subject] = fields as [
    string, string, string, string, string, string, string
  ]
  const body = fields.slice(FIELDS_BEFORE_BODY).join(FIELD).trim()
  return {
    hash,
    parents: parents === '' ? [] : parents.split(' '),
    authorName,
    authorEmail,
    authorTime: Number(authorTime),
    refs: refs === '' ? [] : parseDecorations(refs.split(', ')),
    subject,
    body
  }
}

/** Run `git log` with the given selection arguments and parse the commits. */
export async function readCommits(repoPath: string, selection: readonly string[], signal?: AbortSignal): Promise<Commit[]> {
  const out = await runGit(repoPath, ['log', '-z', '--decorate=full', `--format=${FORMAT}`, ...selection], signal ? { signal } : {})
  return out
    .split('\0')
    .filter((record) => record.length > 0)
    .map(parseRecord)
    .filter((commit): commit is Commit => commit !== null)
}

/** Newest-first, topologically ordered commits from every branch and tag. */
export function readLog(repoPath: string, limit: number): Promise<Commit[]> {
  return readCommits(repoPath, ['--topo-order', `--max-count=${limit}`, '--exclude=refs/stash', '--all'])
}

/**
 * Commits that changed `path`, newest first, following it across renames, each with the name the
 * file had in that commit. `rev` starts the walk at a commit instead of HEAD. Git's rename
 * detection is a heuristic, so history can stop early when a file was heavily rewritten while it moved.
 */
export async function readFileHistory(repoPath: string, path: string, limit: number, rev: string | null = null): Promise<FileHistoryEntry[]> {
  const selection = ['--follow', `--max-count=${limit}`, ...(rev === null ? [] : [rev]), '--', path]
  const [commits, names] = await Promise.all([
    readCommits(repoPath, selection),
    // `--name-only` prints the file's name under each hash: it is the only place `--follow` reveals past names.
    runGit(repoPath, ['log', '--follow', '--name-only', '--format=%x01%H', `--max-count=${limit}`, ...(rev === null ? [] : [rev]), '--', path])
  ])
  const pathAt = new Map<string, string>()
  for (const block of names.split('\x01')) {
    const [hash, ...rest] = block.split('\n')
    const name = rest.find((line) => line !== '')
    if (hash && name) pathAt.set(hash, name)
  }
  return commits.map((commit) => ({ commit, path: pathAt.get(commit.hash) ?? path }))
}

/** Author and committer of one commit. */
export async function readCommitDetails(repoPath: string, hash: string): Promise<CommitDetails> {
  const out = await runGit(repoPath, ['log', '-1', `--format=${['%H', '%an', '%ae', '%at', '%cn', '%ce', '%ct'].join('%x1f')}`, hash, '--'])
  const [full, authorName, authorEmail, authorTime, committerName, committerEmail, committerTime] = out.replace(/\n$/, '').split(FIELD)
  if (!full || committerTime === undefined) throw new Error(`Unknown commit: ${hash}`)
  return {
    hash: full,
    authorName: authorName!,
    authorEmail: authorEmail!,
    authorTime: Number(authorTime),
    committerName: committerName!,
    committerEmail: committerEmail!,
    committerTime: Number(committerTime)
  }
}
