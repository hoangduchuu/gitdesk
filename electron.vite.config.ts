import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    // File-type icons (material-icon-theme, MIT) are served as static files next to index.html.
    publicDir: resolve(__dirname, 'node_modules/material-icon-theme/icons'),
    plugins: [react()]
  }
})
