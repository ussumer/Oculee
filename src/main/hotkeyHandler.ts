import { globalShortcut } from 'electron'
import { getWindowContext } from './activeWindow'
import { makeCooldown } from './cooldown'
import { consumeRoastNotice, roast } from './roast/roast'
import { getOverlayWindow } from './windowManager'
import { TOAST_SHOW_CHANNEL, type ToastShowPayload } from '../shared/ipc'
import type { WindowContext } from '../shared/types'
import { trimAndClampByCodePoints } from '../shared/utils/stringUtils'

const HOTKEY = 'Control+Alt+T'
const HOTKEY_COOLDOWN_MS = 5000
const HOTKEY_REGISTER_FAILED_MESSAGE = '热键注册失败'
const HOTKEY_FALLBACK_MESSAGE = '先深呼吸再继续'
const MAX_TOAST_LENGTH = 100
const DEBUG_WINDOW_CONTEXT = false
const ROAST_STYLE = 'default'

const hotkeyCooldown = makeCooldown(HOTKEY_COOLDOWN_MS)

function clampToastText(text: string): string {
  return trimAndClampByCodePoints(text, MAX_TOAST_LENGTH)
}

function formatCooldownText(remainingMs: number): string {
  if (remainingMs <= 0) {
    return '冷却中'
  }
  const seconds = Math.max(0.1, Math.ceil(remainingMs / 100) / 10)
  return clampToastText(`冷却中 ${seconds.toFixed(1)}s`)
}

function sendToast(text: string): void {
  const overlayWindow = getOverlayWindow()
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    return
  }

  const payload: ToastShowPayload = { text: clampToastText(text) }
  const send = () => {
    if (!overlayWindow || overlayWindow.isDestroyed()) {
      return
    }
    overlayWindow.webContents.send(TOAST_SHOW_CHANNEL, payload)
  }

  if (overlayWindow.webContents.isLoading()) {
    overlayWindow.webContents.once('did-finish-load', send)
    return
  }

  send()
}

function debugWindowContext(context: WindowContext): void {
  if (!DEBUG_WINDOW_CONTEXT) {
    return
  }

  console.log('[window-context]', {
    appName: context.appName,
    bounds: context.bounds
  })
}

async function onHotkeyPressed(): Promise<void> {
  try {
    const now = Date.now()
    if (hotkeyCooldown.isCooling(now)) {
      sendToast(formatCooldownText(hotkeyCooldown.remainingMs(now)))
      return
    }

    hotkeyCooldown.mark(now)
    let context: WindowContext | undefined
    try {
      context = await getWindowContext()
      if (context) {
        debugWindowContext(context)
      }
    } catch {
      context = undefined
    }

    const text = await roast(context, ROAST_STYLE)
    const notice = consumeRoastNotice()

    if (notice) {
      sendToast(notice)
      setTimeout(() => {
        sendToast(text)
      }, 450)
      return
    }

    sendToast(text)
  } catch (error) {
    console.error('[hotkey] callback failed', error)
    sendToast(HOTKEY_FALLBACK_MESSAGE)
  }
}

export function registerHotkey(): void {
  try {
    const registered = globalShortcut.register(HOTKEY, () => {
      void onHotkeyPressed()
    })

    if (!registered) {
      console.error(`[hotkey] register failed: ${HOTKEY}`)
      sendToast(HOTKEY_REGISTER_FAILED_MESSAGE)
    }
  } catch (error) {
    console.error(`[hotkey] register exception: ${HOTKEY}`, error)
    sendToast(HOTKEY_REGISTER_FAILED_MESSAGE)
  }
}

export function unregisterHotkeys(): void {
  globalShortcut.unregisterAll()
}
