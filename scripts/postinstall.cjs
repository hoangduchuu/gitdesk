// node-pty's prebuilt spawn-helper is published without the executable bit on macOS,
// which makes every terminal fail with "posix_spawnp failed". Restore it after install.
const { chmodSync, existsSync } = require('node:fs')
const { join } = require('node:path')

const helper = join(__dirname, '..', 'node_modules', 'node-pty', 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper')
if (existsSync(helper)) {
  chmodSync(helper, 0o755)
  console.log(`made executable: ${helper}`)
}
