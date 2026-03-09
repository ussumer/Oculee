import activeWin from 'active-win'
import { z } from 'zod'
import { isBlacklisted } from './blacklist'
import {
  WindowBoundsSchema,
  WindowContextSchema,
  type WindowBounds,
  type WindowContext
} from '../shared/types'

const SENSITIVE_TITLE_PLACEHOLDER = '某个敏感窗口'
const UNTITLED_PLACEHOLDER = '未命名窗口'

const NullableTrimmedStringSchema = z
  .string()
  .trim()
  .catch('')
  .transform((value) => (value ? value : null))

const OptionalWindowIdSchema = z.preprocess((value) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined
  }
  return Math.floor(parsed)
}, z.number().int().positive().optional())

const ActiveOwnerSchema = z
  .object({
    name: NullableTrimmedStringSchema,
    processName: NullableTrimmedStringSchema
  })
  .catch({
    name: null,
    processName: null
  })

const ActiveWindowSchema = z
  .object({
    id: OptionalWindowIdSchema,
    title: NullableTrimmedStringSchema,
    owner: ActiveOwnerSchema,
    bounds: z.unknown().optional()
  })
  .catch({
    id: undefined,
    title: null,
    owner: {
      name: null,
      processName: null
    },
    bounds: undefined
  })

function toWindowBounds(value: unknown): WindowBounds | null {
  const result = WindowBoundsSchema.safeParse(value)
  return result.success ? result.data : null
}

function parseWindowContext(input: unknown): WindowContext {
  const parsedWindow = ActiveWindowSchema.parse(input)
  const appName = parsedWindow.owner.name ?? parsedWindow.owner.processName
  const titleRaw = parsedWindow.title
  const bounds = toWindowBounds(parsedWindow.bounds)
  const isSensitive = isBlacklisted(appName, titleRaw)

  return WindowContextSchema.parse({
    id: parsedWindow.id,
    appName,
    titleRaw,
    titleSafe: isSensitive ? SENSITIVE_TITLE_PLACEHOLDER : titleRaw ?? UNTITLED_PLACEHOLDER,
    bounds,
    isSensitive
  })
}

export async function getWindowContext(): Promise<WindowContext> {
  try {
    return parseWindowContext(await activeWin())
  } catch {
    return WindowContextSchema.parse({
      id: undefined,
      appName: null,
      titleRaw: null,
      titleSafe: UNTITLED_PLACEHOLDER,
      bounds: null,
      isSensitive: false
    })
  }
}
