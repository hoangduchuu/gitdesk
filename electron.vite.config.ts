import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const { version } = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version: string }

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    // File-type icons (material-icon-theme, MIT) are served as static files next to index.html.
    publicDir: resolve(__dirname, 'node_modules/material-icon-theme/icons'),
    // The app version, shown in Settings; package.json stays the single source of truth.
    define: { __APP_VERSION__: JSON.stringify(version) },
    plugins: [react()]
  }
})
