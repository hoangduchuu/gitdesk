// UI smoke test: launches the built app on a temporary repository, stages everything and commits
// through the real UI (flow-commit.js), then checks the result with git and checks the screenshot.
//
//   npm run build && node scripts/e2e/smoke.cjs      (or: npm run e2e)
//
// Exit code 0 = passed. Failures print what was wrong and exit 1. Needs a display session
// (the app opens a window); the screenshot is saved next to the temp repository.
const { execFileSync, spawnSync } = require('node:child_process')
const { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')

const root = resolve(__dirname, '..', '..')
const electron = require('electron') // the path of the Electron binary
const failures = []
const check = (ok, message) => {
  if (!ok) failures.push(message)
}

if (!existsSync(join(root, 'out', 'main', 'index.js'))) {
  console.error('Not built: run `npm run build` first.')
  process.exit(2)
}

const work = mkdtempSync(join(tmpdir(), 'gitdesk-e2e-'))
const repo = join(work, 'repo')
const screenshot = join(work, 'after.png')
const git = (...args) =>
  execFileSync('git', ['-C', repo, '-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', ...args], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' } })

try {
  execFileSync('git', ['init', '-q', '-b', 'main', repo])
  writeFileSync(join(repo, 'a.txt'), 'one\n')
  git('add', '.')
  git('commit', '-q', '-m', 'first')
  writeFileSync(join(repo, 'a.txt'), 'one\ntwo\n')
  writeFileSync(join(repo, 'b.txt'), 'new\n')

  const run = spawnSync(
    electron,
    [join(root, 'scripts', 'capture.cjs'), `--repo=${repo}`, `--out=${screenshot}`, `--script=${join(__dirname, 'flow-commit.js')}`],
    { cwd: root, encoding: 'utf8', timeout: 120_000 }
  )
  check(run.status === 0, `the app exited with ${run.status ?? run.signal}: ${run.stderr || run.stdout}`)
  check(/script result:.*UNSTAGED \(2\)/i.test(run.stdout), `the Changes panel did not list the 2 changed files:\n${run.stdout}`)
  check(git('log', '-1', '--format=%s').trim() === 'commit from driver', `the commit was not made (last commit: ${git('log', '-1', '--format=%s').trim()})`)
  check(git('status', '--porcelain').trim() === '', 'files were left uncommitted')

  // A window that failed to render is a small, almost blank PNG; a real one is far bigger.
  if (existsSync(screenshot)) {
    const png = readFileSync(screenshot)
    check(png.subarray(1, 4).toString() === 'PNG', 'the screenshot is not a PNG')
    check(png.length > 40_000, `the screenshot is only ${png.length} bytes: the window looks blank`)
  } else {
    check(false, 'no screenshot was saved')
  }
} catch (error) {
  failures.push(String(error))
} finally {
  if (failures.length === 0) rmSync(work, { recursive: true, force: true })
}

if (failures.length > 0) {
  console.error(`UI smoke test FAILED (kept ${work} for inspection):\n- ${failures.join('\n- ')}`)
  process.exit(1)
}
console.log('UI smoke test passed')
