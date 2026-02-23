import { BrowserWindow, screen } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { TOAST_SHOW_CHANNEL, type ToastShowPayload } from '../shared/ipc'
import { trimAndClampByCodePoints } from '../shared/utils/stringUtils'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const WIN_WIDTH = 760
const WIN_HEIGHT = 260
const MARGIN = 16
const MAX_TOAST_LENGTH = 100
const READY_TOAST_MESSAGE = 'MM chat mode ready: Ctrl+Alt+T'

let overlayWindow: BrowserWindow | null = null

function clampToastText(text: string): string {
  return trimAndClampByCodePoints(text, MAX_TOAST_LENGTH)
}

function sendToast(text: string): void {
  const targetWindow = getOverlayWindow()
  if (!targetWindow || targetWindow.isDestroyed()) {
    return
  }

  const payload: ToastShowPayload = { text: clampToastText(text) }
  const send = () => {
    if (!targetWindow || targetWindow.isDestroyed()) {
      return
    }
    targetWindow.webContents.send(TOAST_SHOW_CHANNEL, payload)
  }

  if (targetWindow.webContents.isLoading()) {
    targetWindow.webContents.once('did-finish-load', send)
    return
  }

  send()
}

function runReadyToastSelfTest(targetWindow: BrowserWindow): void {
  targetWindow.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      sendToast(READY_TOAST_MESSAGE)
    }, 1000)
  })
}

export function createOverlayWindow(): BrowserWindow {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    return overlayWindow
  }

  const { x, y, width } = screen.getPrimaryDisplay().workArea
  const windowX = x + width - WIN_WIDTH - MARGIN
  const windowY = y + MARGIN

  const createdWindow = new BrowserWindow({
    x: windowX,
    y: windowY,
    width: WIN_WIDTH,
    height: WIN_HEIGHT,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    focusable: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, '../preload/preload.mjs')
    }
  })

  overlayWindow = createdWindow

  createdWindow.setAlwaysOnTop(true, 'screen-saver')
  createdWindow.setIgnoreMouseEvents(true, { forward: true })
  runReadyToastSelfTest(createdWindow)

  const devServerUrl = process.env.ELECTRON_RENDERER_URL
  if (devServerUrl) {
    createdWindow.loadURL(new URL('overlay.html', devServerUrl).toString())
  } else {
    createdWindow.loadFile(path.join(__dirname, '../renderer/overlay.html'))
  }

  createdWindow.showInactive()
  createdWindow.on('closed', () => {
    if (overlayWindow === createdWindow) {
      overlayWindow = null
    }
  })

  return createdWindow
}

export function getOverlayWindow(): BrowserWindow | null {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    return null
  }
  return overlayWindow
}
