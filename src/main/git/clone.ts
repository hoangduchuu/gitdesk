import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { GitError, runGit } from './exec'
import { requireRemoteUrl } from './remote'

/** The folder name git would pick: the last path segment of the address, without `.git`. */
export function repoNameFromUrl(value: string): string {
  const url = requireRemoteUrl(value)
  const last = url.replace(/[/\\]+$/, '').split(/[/:\\]/).pop() ?? ''
  const name = last.replace(/\.git$/i, '')
  if (name === '' || name === '.' || name === '..') throw new Error('Cannot tell the repository name from this URL')
  return name
}

const AUTH_FAILURE = /terminal prompts disabled|could not read (Username|Password)|Authentication failed|HTTP Basic: Access denied|Repository not found|returned error: (401|403|404)|Permission denied \(publickey\)/i

/** Clone `url` into a new folder under `parent`; returns the new repository's path. */
export async function cloneRepository(
  url: string,
  parent: string,
  env: Readonly<Record<string, string>> = {},
  /** True when a profile's credentials were supplied, which changes the advice on failure. */
  authenticated = false,
  /** Also clone the repository's submodules. */
  recurseSubmodules = false
): Promise<string> {
  const address = requireRemoteUrl(url)
  const target = join(parent, repoNameFromUrl(address))
  const exists = await stat(target).then(() => true, () => false)
  if (exists) throw new Error(`The folder ${target} already exists`)
  try {
    // `--` keeps the address from ever being read as an option.
    await runGit(parent, ['clone', ...(recurseSubmodules ? ['--recurse-submodules'] : []), '--', address, target], { env })
  } catch (error) {
    if (error instanceof GitError && AUTH_FAILURE.test(error.stderr)) {
      throw new Error(
        authenticated
          ? 'Access was denied. Check that the repository exists and that the connected profile has access to it.'
          : 'This repository is private or does not exist. Choose a profile connected to GitHub or a git server (Profiles) to clone it.'
      )
    }
    throw error
  }
  return target
}
