import { z } from 'zod'
import { formatLocalIsoTimestamp } from './time'

export const SessionRouteSchema = z.enum(['PRIMARY', 'FLASH_API', 'LOCAL_FALLBACK', 'UNKNOWN'])
export const InteractionRouteSchema = z.enum(['primary', 'flash', 'local'])

export const SessionSnapshotSchema = z.object({
  lastApp: z.string().min(1),
  lastTitleSafe: z.string().min(1),
  lastRoute: SessionRouteSchema,
  lastEmotion: z.string().min(1).nullable(),
  lastHasImage: z.boolean(),
  updatedAt: z.string().datetime({ offset: true }),
  cooldownContext: z.string().min(1).optional()
})

export const SessionSnapshotPatchSchema = z.object({
  lastApp: z.string().min(1),
  lastTitleSafe: z.string().min(1),
  lastRoute: SessionRouteSchema,
  lastEmotion: z.string().min(1).nullable(),
  lastHasImage: z.boolean(),
  cooldownContext: z.string().min(1).optional()
})

export const InteractionEventSchema = z.object({
  id: z.string().min(1),
  timestamp: z.string().datetime({ offset: true }),
  source: z.object({
    kind: z.literal('roast'),
    sessionId: z.string().min(1).optional()
  }),
  appName: z.string().min(1),
  titleSafe: z.string().min(1),
  route: InteractionRouteSchema,
  emotion: z.string().min(1).optional(),
  hasImage: z.boolean(),
  usedFallback: z.boolean(),
  blockedByPrivacy: z.boolean(),
  roastText: z.string(),
  sessionSnapshot: z
    .object({
      lastApp: z.string().min(1).optional(),
      lastRoute: z.string().min(1).optional(),
      lastEmotion: z.string().min(1).optional()
    })
    .optional()
})

export type SessionRoute = z.infer<typeof SessionRouteSchema>
export type InteractionRoute = z.infer<typeof InteractionRouteSchema>
export type SessionSnapshot = z.infer<typeof SessionSnapshotSchema>
export type SessionSnapshotPatch = z.infer<typeof SessionSnapshotPatchSchema>
export type InteractionEvent = z.infer<typeof InteractionEventSchema>

export type MemoryContext = {
  soulText: string
  userProfileSummary: string
  sessionSummary: string
}

export function createDefaultSessionSnapshot(): SessionSnapshot {
  return {
    lastApp: '未知应用',
    lastTitleSafe: '未命名窗口',
    lastRoute: 'UNKNOWN',
    lastEmotion: null,
    lastHasImage: false,
    updatedAt: formatLocalIsoTimestamp()
  }
}
