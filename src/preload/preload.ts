import { contextBridge, ipcRenderer } from 'electron'
import {
  AVATAR_CHANGE_CHANNEL,
  TOAST_SHOW_CHANNEL,
  ToastShowPayloadSchema,
  type ToastShowPayload
} from '../shared/ipc'

type ToastListener = (payload: ToastShowPayload) => void

const toastListeners = new Set<ToastListener>()
let latestToastPayload: ToastShowPayload | null = null

function notifyToastListeners(payload: ToastShowPayload): void {
  latestToastPayload = payload
  for (const listener of toastListeners) {
    listener(payload)
  }
}

ipcRenderer.on(TOAST_SHOW_CHANNEL, (_event, payload: unknown) => {
  const result = ToastShowPayloadSchema.safeParse(payload)
  if (!result.success) {
    return
  }
  notifyToastListeners(result.data)
})

contextBridge.exposeInMainWorld('overlay', {
  onToastShow(listener: ToastListener) {
    toastListeners.add(listener)
    if (latestToastPayload) {
      listener(latestToastPayload)
    }
  },
  onAvatarChange(callback: (emotion: string) => void) {
    ipcRenderer.on(AVATAR_CHANGE_CHANNEL, (_event, emotion: unknown) => {
      if (typeof emotion === 'string') {
        callback(emotion)
      }
    })
  },
  toastShow(text: string) {
    notifyToastListeners({ text })
  }
})
