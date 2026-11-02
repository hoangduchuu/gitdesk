import type { GitflowConfig, GitflowKind, GitflowState, MergeOutcome } from '../../shared/model'
import { readBranches } from './branches'
import { allowConflicts } from './conflict'
import { GitError, runGit } from './exec'
import { currentOperation } from './status'

const KINDS: readonly GitflowKind[] = ['feature', 'release', 'hotfix']

/** The same keys git-flow (AVH) uses, so both tools see one configuration. */
const KEYS: Record<keyof GitflowConfig, string> = {
  main: 'gitflow.branch.master',
  develop: 'gitflow.branch.develop',
  feature: 'gitflow.prefix.feature',
  release: 'gitflow.prefix.release',
  hotfix: 'gitflow.prefix.hotfix',
  versionTag: 'gitflow.prefix.versiontag'
}

const readConfigValue = async (repo: string, key: string): Promise<string | null> => {
  const out = await runGit(repo, ['config', '--local', '--get', key], { okExitCodes: [1] })
  return out === '' ? null : out.replace(/\n$/, '')
}

const refValid = async (repo: string, ref: string): Promise<boolean> => {
  try {
    await runGit(repo, ['check-ref-format', ref])
    return true
  } catch (error) {
    if (error instanceof GitError) return false
    throw error
  }
}

const isAncestor = async (repo: string, ancestor: string, of: string): Promise<boolean> => {
  try {
    await runGit(repo, ['merge-base', '--is-ancestor', ancestor, of])
    return true
  } catch (error) {
    if (error instanceof GitError && error.exitCode === 1) return false
    throw error
  }
}

const branchExists = async (repo: string, name: string): Promise<boolean> =>
  (await readBranches(repo)).some((branch) => branch.kind === 'local' && branch.name === name)

const tagExists = async (repo: string, name: string): Promise<boolean> =>
  (await runGit(repo, ['tag', '--list', name])).trim() !== ''

const defaultConfig = async (repo: string): Promise<GitflowConfig> => {
  const main = (await branchExists(repo, 'main')) || !(await branchExists(repo, 'master')) ? 'main' : 'master'
  return { main, develop: 'develop', feature: 'feature/', release: 'release/', hotfix: 'hotfix/', versionTag: '' }
}

/** The saved settings; null until Git Flow has been initialized in this repository. */
const savedConfig = async (repo: string): Promise<GitflowConfig | null> => {
  const base = await defaultConfig(repo)
  const main = await readConfigValue(repo, KEYS.main)
  const develop = await readConfigValue(repo, KEYS.develop)
  if (main === null || develop === null) return null
  return {
    main,
    develop,
    feature: (await readConfigValue(repo, KEYS.feature)) ?? base.feature,
    release: (await readConfigValue(repo, KEYS.release)) ?? base.release,
    hotfix: (await readConfigValue(repo, KEYS.hotfix)) ?? base.hotfix,
    versionTag: (await readConfigValue(repo, KEYS.versionTag)) ?? base.versionTag
  }
}

const requireConfig = async (repo: string): Promise<GitflowConfig> => {
  const config = await savedConfig(repo)
  if (config === null) throw new Error('Git Flow is not initialized in this repository')
  return config
}

export async function readGitflow(repo: string): Promise<GitflowState> {
  const saved = await savedConfig(repo)
  const config = saved ?? (await defaultConfig(repo))
  const open: GitflowState['open'] = { feature: [], release: [], hotfix: [] }
  let current: GitflowState['current'] = null
  if (saved !== null) {
    for (const branch of await readBranches(repo)) {
      if (branch.kind !== 'local') continue
      for (const kind of KINDS) {
        const prefix = config[kind]
        if (!branch.name.startsWith(prefix) || branch.name === prefix) continue
        const name = branch.name.slice(prefix.length)
        open[kind].push(name)
        if (branch.isHead) current = { kind, name }
      }
    }
  }
  return { initialized: saved !== null, config, open, current }
}

async function validateConfig(repo: string, config: GitflowConfig): Promise<void> {
  for (const [label, name] of [['production', config.main], ['development', config.develop]] as const) {
    if (name === '' || name.startsWith('-') || !(await refValid(repo, `refs/heads/${name}`))) {
      throw new Error(`"${name}" is not a valid ${label} branch name`)
    }
  }
  if (config.main === config.develop) throw new Error('The production and development branches must differ')
  for (const kind of KINDS) {
    const prefix = config[kind]
    if (prefix === '' || prefix.startsWith('-') || !(await refValid(repo, `refs/heads/${prefix}x`))) {
      throw new Error(`"${prefix}" is not a valid ${kind} prefix`)
    }
  }
  if (new Set(KINDS.map((kind) => config[kind])).size !== KINDS.length) throw new Error('The branch prefixes must differ')
  if (config.versionTag !== '' && (config.versionTag.startsWith('-') || !(await refValid(repo, `refs/tags/${config.versionTag}x`)))) {
    throw new Error(`"${config.versionTag}" is not a valid version tag prefix`)
  }
}

/** Save the naming, and create the development branch (from the remote's, else the production branch) if missing. */
export async function initGitflow(repo: string, config: GitflowConfig): Promise<void> {
  await validateConfig(repo, config)
  if (!(await branchExists(repo, config.main))) {
    throw new Error(`The production branch "${config.main}" does not exist. Create it (make a first commit) or pick another.`)
  }
  if (!(await branchExists(repo, config.develop))) {
    const remote = (await readBranches(repo)).find((branch) => branch.kind === 'remote' && branch.name.endsWith(`/${config.develop}`))
    await runGit(repo, remote ? ['branch', '--track', config.develop, remote.name] : ['branch', config.develop, config.main])
  }
  for (const key of Object.keys(KEYS) as Array<keyof GitflowConfig>) {
    await runGit(repo, ['config', '--local', KEYS[key], config[key]])
  }
}

const baseFor = (kind: GitflowKind, config: GitflowConfig): string => (kind === 'hotfix' ? config.main : config.develop)

async function requireName(repo: string, config: GitflowConfig, kind: GitflowKind, name: string): Promise<string> {
  const full = `${config[kind]}${name}`
  if (name === '' || name.startsWith('-') || !(await refValid(repo, `refs/heads/${full}`))) {
    throw new Error(`"${name}" is not a valid ${kind} name`)
  }
  return full
}

/** Create `<prefix><name>` from develop (feature, release) or the production branch (hotfix) and check it out. */
export async function startGitflow(repo: string, kind: GitflowKind, name: string): Promise<void> {
  const config = await requireConfig(repo)
  const full = await requireName(repo, config, kind, name)
  if (await branchExists(repo, full)) throw new Error(`The branch ${full} already exists`)
  if (kind !== 'feature') {
    // Like git-flow: one release and one hotfix at a time.
    const open = (await readGitflow(repo)).open[kind]
    if (open.length > 0) throw new Error(`There is already a ${kind} in progress: ${config[kind]}${open[0]}. Finish it first.`)
  }
  const base = baseFor(kind, config)
  if (!(await branchExists(repo, base))) throw new Error(`The branch "${base}" does not exist`)
  await runGit(repo, ['switch', '-c', full, base])
}

export interface FinishOptions {
  /** Remove the branch once it is merged. */
  deleteBranch: boolean
  /** Message of the annotated tag made for a release or hotfix; defaults to the tag name. */
  tagMessage: string | null
}

const requireCleanTree = async (repo: string): Promise<void> => {
  if ((await currentOperation(repo)) !== null) throw new Error('Finish the merge, rebase or cherry-pick in progress first')
  if ((await runGit(repo, ['status', '--porcelain', '--untracked-files=no'])).trim() !== '') {
    throw new Error('Commit or stash your changes before finishing: Git Flow switches branches')
  }
}

/** Merge `source` into `target` with a merge commit; nothing to do when it is already in. */
async function mergeInto(repo: string, target: string, source: string): Promise<MergeOutcome> {
  if (await isAncestor(repo, source, target)) return { conflicts: false }
  await runGit(repo, ['switch', target])
  return allowConflicts(repo, () => runGit(repo, ['merge', '--no-ff', '--no-edit', source]))
}

/**
 * Finish a feature, release or hotfix: merge it where it belongs, tag releases and hotfixes,
 * and leave the user on develop. Stopping on conflicts is reported; after resolving and
 * continuing the merge, finishing again picks up where it stopped, because finished steps
 * are detected and skipped.
 */
export async function finishGitflow(repo: string, kind: GitflowKind, name: string, options: FinishOptions): Promise<MergeOutcome> {
  const config = await requireConfig(repo)
  const full = await requireName(repo, config, kind, name)
  if (!(await branchExists(repo, full))) throw new Error(`The branch ${full} does not exist`)
  await requireCleanTree(repo)

  // Where the work ends up last: develop, or the release in progress for a hotfix.
  let last = config.develop
  const targets: string[] = []
  if (kind === 'feature') {
    targets.push(config.develop)
  } else {
    const tag = `${config.versionTag}${name}`
    const merged = await isAncestor(repo, full, config.main)
    if (!merged && (await tagExists(repo, tag))) throw new Error(`The tag ${tag} already exists`)
    const outcome = await mergeInto(repo, config.main, full)
    if (outcome.conflicts) return outcome
    if (!(await tagExists(repo, tag))) {
      await runGit(repo, ['tag', '-a', tag, '-m', options.tagMessage?.trim() || tag, config.main])
    }
    if (kind === 'hotfix') {
      const release = (await readGitflow(repo)).open.release[0]
      if (release !== undefined) last = `${config.release}${release}`
    }
    targets.push(last)
  }
  for (const target of targets) {
    const outcome = await mergeInto(repo, target, full)
    if (outcome.conflicts) return outcome
  }
  // Land on develop like git-flow does, unless the work went into a release branch.
  await runGit(repo, ['switch', kind === 'feature' ? config.develop : last])
  if (options.deleteBranch) {
    // Every merge above is confirmed, so the safe check of `branch -d` (which looks at HEAD only) is not needed.
    if (await isAncestor(repo, full, last)) await runGit(repo, ['branch', '-D', full])
  }
  return { conflicts: false }
}
