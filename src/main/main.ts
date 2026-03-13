import { app } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerHotkey, unregisterHotkeys } from './hotkeyHandler'
import { loadEnvFiles } from './loadEnv'
import { bootstrapMemory } from './memory/bootstrap'
import { createOverlayWindow } from './windowManager'
import { ProxyAgent, setGlobalDispatcher } from 'undici'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '../..')

loadEnvFiles(PROJECT_ROOT)

const dispatcher = new ProxyAgent(process.env.HTTPS_PROXY || 'http://127.0.0.1:7897')
setGlobalDispatcher(dispatcher)

app.whenReady().then(async () => {
  try {
    const memoryRoot = await bootstrapMemory()
    console.log('[memory] bootstrap ready', memoryRoot)
  } catch (error: unknown) {
    console.error('[memory] bootstrap failed', error)
  }

  createOverlayWindow()
  registerHotkey()
})

app.on('window-all-closed', () => {
  app.quit()
})

app.on('will-quit', () => {
  unregisterHotkeys()
})
