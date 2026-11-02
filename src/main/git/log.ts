import type { CommitDetails } from '../../shared/model'
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
export async function readCommits(repoPath: string, selection: readonly string[]): Promise<Commit[]> {
  const out = await runGit(repoPath, ['log', '-z', '--decorate=full', `--format=${FORMAT}`, ...selection])
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
