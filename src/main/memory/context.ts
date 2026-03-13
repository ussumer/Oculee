import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { getSessionCurrentFilePath, getSoulFilePath, getUserFilePath } from './paths'
import {
  SessionSnapshotPatchSchema,
  SessionSnapshotSchema,
  createDefaultSessionSnapshot,
  type MemoryContext,
  type SessionSnapshot,
  type SessionSnapshotPatch
} from './schema'
import { getDefaultSoulText, getDefaultUserText } from './bootstrap'
import { formatLocalIsoTimestamp } from './time'

interface MemoryOptions {
  memoryRoot?: string
}

async function readTextFile(filePath: string, fallback: string): Promise<string> {
  try {
    const text = (await readFile(filePath, 'utf8')).trim()
    return text || fallback
  } catch {
    return fallback
  }
}

async function readSessionSnapshot(memoryRoot?: string): Promise<SessionSnapshot> {
  const sessionPath = getSessionCurrentFilePath(memoryRoot)

  try {
    const raw = await readFile(sessionPath, 'utf8')
    return SessionSnapshotSchema.parse(JSON.parse(raw))
  } catch {
    return createDefaultSessionSnapshot()
  }
}

function formatSessionSummary(session: SessionSnapshot): string {
  const lines = [
    `Last app: ${session.lastApp}`,
    `Last safe title: ${session.lastTitleSafe}`,
    `Last route: ${session.lastRoute}`,
    `Last emotion: ${session.lastEmotion ?? 'unknown'}`,
    `Last had image: ${session.lastHasImage ? 'yes' : 'no'}`,
    `Updated at: ${session.updatedAt}`
  ]

  if (session.cooldownContext) {
    lines.push(`Cooldown context: ${session.cooldownContext}`)
  }

  return lines.join('\n')
}

export async function prepareMemoryContext(options: MemoryOptions = {}): Promise<MemoryContext> {
  const soulText = await readTextFile(getSoulFilePath(options.memoryRoot), getDefaultSoulText())
  const userProfileSummary = await readTextFile(getUserFilePath(options.memoryRoot), getDefaultUserText())
  const sessionSnapshot = await readSessionSnapshot(options.memoryRoot)

  return {
    soulText,
    userProfileSummary,
    sessionSummary: formatSessionSummary(sessionSnapshot)
  }
}

export async function updateCurrentSession(
  patch: SessionSnapshotPatch,
  options: MemoryOptions = {}
): Promise<void> {
  const parsedPatch = SessionSnapshotPatchSchema.parse(patch)
  const current = await readSessionSnapshot(options.memoryRoot)
  const sessionPath = getSessionCurrentFilePath(options.memoryRoot)
  const nextSession = SessionSnapshotSchema.parse({
    ...current,
    ...parsedPatch,
    updatedAt: formatLocalIsoTimestamp()
  })

  await mkdir(dirname(sessionPath), { recursive: true })
  await writeFile(sessionPath, `${JSON.stringify(nextSession, null, 2)}\n`, 'utf8')
}
