// Dev tool: launch the built app, optionally drive it with a script, save a PNG of its own
// window, then quit. Captures only GitDesk's page, never the rest of the screen.
//
// Usage: electron scripts/capture.cjs --repo=<path> --out=<file.png> [--wait=<ms>] [--script=<file.js>]
//        [--user-data=<dir>]  settings folder (default: a new temp folder, never the real one)
// The script is the body of an async function run in the page, with helpers:
//   sleep(ms), click(selector, textPrefix?), type(selector, value)
const { app, BrowserWindow } = require('electron')
const { readFileSync, writeFileSync } = require('node:fs')

const arg = (name, fallback) => {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

const out = arg('out', null)
const waitMs = Number(arg('wait', '2500'))
const scriptPath = arg('script', null)
if (!out) {
  console.error('Missing --out=<file.png>')
  process.exit(2)
}

const HELPERS = `
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const find = (selector, text) => {
  const all = [...document.querySelectorAll(selector)];
  const el = text === undefined ? all[0] : all.find((e) => e.textContent.trim().startsWith(text));
  if (!el) throw new Error('not found: ' + selector + (text === undefined ? '' : ' "' + text + '"'));
  return el;
};
const click = async (selector, text) => { find(selector, text).click(); await sleep(500); };
const type = async (selector, value) => {
  const el = find(selector);
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(200);
};
`

// A separate settings folder also gives the capture its own single-instance lock,
// so it runs alongside a GitDesk the user already has open.
const userData = arg('user-data', require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'gitdesk-capture-')))
app.setPath('userData', userData)

require('../out/main/index.js')

app.on('browser-window-created', (_event, window) => {
  window.webContents.once('did-finish-load', () => {
    setTimeout(async () => {
      try {
        if (scriptPath) {
          const body = readFileSync(scriptPath, 'utf8')
          const result = await window.webContents.executeJavaScript(
            `(async () => { ${HELPERS}\n${body}\n })()`
          )
          if (result !== undefined) console.log(`script result: ${JSON.stringify(result)}`)
        }
        // A covered window (e.g. under Stage Manager) stops painting and capturePage would
        // return an old frame: keep it rendering and force a fresh paint before capturing.
        window.webContents.setBackgroundThrottling(false)
        window.webContents.invalidate()
        await new Promise((resolve) => setTimeout(resolve, 400))
        const image = await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
        writeFileSync(out, image.toPNG())
        console.log(`saved ${out} ${JSON.stringify(image.getSize())}`)
      } catch (error) {
        console.error('capture failed:', error.message ?? error)
        process.exitCode = 1
      } finally {
        BrowserWindow.getAllWindows().forEach((w) => w.destroy())
        app.quit()
      }
    }, waitMs)
  })
})
