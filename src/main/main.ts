import { app } from 'electron'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerHotkey, unregisterHotkeys } from './hotkeyHandler'
import { loadEnvFiles } from './loadEnv'
import { createOverlayWindow } from './windowManager'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '../..')

loadEnvFiles(PROJECT_ROOT)
app.setPath('userData', path.join(os.tmpdir(), 'desktop-banter-bot'))

app.whenReady().then(() => {
  createOverlayWindow()
  registerHotkey()
})

app.on('window-all-closed', () => {
  app.quit()
})

app.on('will-quit', () => {
  unregisterHotkeys()
})
