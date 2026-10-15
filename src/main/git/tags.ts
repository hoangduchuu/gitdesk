import type { Tag } from '../../shared/model'
import { GitError, runGit } from './exec'
import { defaultRemote } from './remote'

const TAGS = 'refs/tags/'
const FIELDS = ['%(refname:short)', '%(objecttype)', '%(objectname)', '%(*objectname)', '%(contents:subject)']

export async function readTags(repo: string): Promise<Tag[]> {
  const out = await runGit(repo, ['for-each-ref', `--format=${FIELDS.join('%00')}`, TAGS])
  return out
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const [name = '', type = '', object = '', peeled = '', subject = ''] = line.split('\0')
      const annotated = type === 'tag'
      // An annotated tag is its own object; the commit is the peeled target.
      return { name, hash: annotated ? peeled : object, annotated, message: annotated ? subject : null }
    })
}

async function requireTagName(repo: string, name: string): Promise<void> {
  const invalid = new Error(`"${name}" is not a valid tag name`)
  if (name === '' || name.startsWith('-')) throw invalid
  try {
    await runGit(repo, ['check-ref-format', `${TAGS}${name}`])
  } catch (error) {
    if (error instanceof GitError) throw invalid
    throw error
  }
}

/** Lightweight tag when `message` is null, annotated otherwise. */
export async function createTag(repo: string, name: string, hash: string, message: string | null): Promise<void> {
  await requireTagName(repo, name)
  const annotation = message === null || message.trim() === '' ? [] : ['-a', '-m', message.trim()]
  await runGit(repo, ['tag', ...annotation, name, hash])
}

export async function deleteTag(repo: string, name: string): Promise<void> {
  await requireTagName(repo, name)
  await runGit(repo, ['tag', '-d', name])
}

export async function pushTag(repo: string, name: string): Promise<void> {
  await requireTagName(repo, name)
  await runGit(repo, ['push', await defaultRemote(repo), `${TAGS}${name}`])
}

export async function deleteRemoteTag(repo: string, name: string): Promise<void> {
  await requireTagName(repo, name)
  await runGit(repo, ['push', await defaultRemote(repo), '--delete', `${TAGS}${name}`])
}
