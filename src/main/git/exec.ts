import { execFile } from 'node:child_process'

const MAX_OUTPUT_BYTES = 64 * 1024 * 1024
const GIT_BINARY = 'git'

export class GitError extends Error {
  constructor(
    readonly args: readonly string[],
    readonly exitCode: number | null,
    readonly stderr: string
  ) {
    super(stderr.trim() || `git ${args[0] ?? ''} failed with exit code ${exitCode}`)
    this.name = 'GitError'
  }
}

export interface RunOptions {
  /** Exit codes other than 0 that still count as success (e.g. 1 for `diff --no-index`). */
  okExitCodes?: readonly number[]
  /** Written to git's standard input (e.g. a patch for `git apply -`). */
  input?: string
  /** Extra environment variables for this command only. */
  env?: Readonly<Record<string, string>>
}

/**
 * Run git without a shell, so arguments are never interpreted by one.
 * Prompts are disabled: the app never waits on a hidden terminal.
 */
export function runGit(
  cwd: string,
  args: readonly string[],
  options: RunOptions = {}
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      GIT_BINARY,
      ['-c', 'color.ui=false', '-c', 'core.quotepath=false', ...args],
      {
        cwd,
        maxBuffer: MAX_OUTPUT_BYTES,
        encoding: 'utf8',
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat', ...options.env }
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve(stdout)
          return
        }
        const code = typeof error.code === 'number' ? error.code : null
        if (code !== null && options.okExitCodes?.includes(code)) {
          resolve(stdout)
          return
        }
        reject(new GitError(args, code, stderr || error.message))
      }
    )
    if (options.input !== undefined) child.stdin?.end(options.input)
  })
}

/** Run git and return raw stdout bytes (for blobs). Fails with GitError on a non-zero exit. */
export function runGitBytes(cwd: string, args: readonly string[], maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      GIT_BINARY,
      ['-c', 'core.quotepath=false', ...args],
      { cwd, maxBuffer: maxBytes, encoding: 'buffer', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
      (error, stdout, stderr) => {
        if (!error) resolve(stdout)
        else reject(new GitError(args, typeof error.code === 'number' ? error.code : null, stderr.toString() || error.message))
      }
    )
  })
}
