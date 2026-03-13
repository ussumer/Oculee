import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import type { App } from 'electron'

const MEMORY_DIR_NAME = '.oculee-memory'

export type AppPathReader = Pick<App, 'getAppPath'>

function getElectronApp(): AppPathReader {
  const require = createRequire(import.meta.url)
  const electron = require('electron') as { app?: AppPathReader }
  const electronApp = electron.app

  if (!electronApp || typeof electronApp.getAppPath !== 'function') {
    throw new Error('Electron app is unavailable while resolving the memory root')
  }

  return electronApp
}

function getProjectRoot(appLike: AppPathReader): string {
  const appPath = appLike.getAppPath()
  if (!appPath) {
    throw new Error('Electron app path is unavailable while resolving the memory root')
  }
  return appPath
}

export function getMemoryRoot(appLike: AppPathReader = getElectronApp()): string {
  return path.join(getProjectRoot(appLike), MEMORY_DIR_NAME)
}

export function getSoulFilePath(memoryRoot = getMemoryRoot()): string {
  return path.join(memoryRoot, 'soul.md')
}

export function getUserFilePath(memoryRoot = getMemoryRoot()): string {
  return path.join(memoryRoot, 'user.md')
}

export function getSessionDirPath(memoryRoot = getMemoryRoot()): string {
  return path.join(memoryRoot, 'session')
}

export function getSessionCurrentFilePath(memoryRoot = getMemoryRoot()): string {
  return path.join(getSessionDirPath(memoryRoot), 'current.json')
}

export function getLogsRootPath(memoryRoot = getMemoryRoot()): string {
  return path.join(memoryRoot, 'logs')
}

export async function ensureMemoryRoot(appLike?: AppPathReader): Promise<string> {
  const memoryRoot = getMemoryRoot(appLike)

  try {
    await mkdir(memoryRoot, { recursive: true })
    return memoryRoot
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to create memory root at ${memoryRoot}: ${reason}`)
  }
}
