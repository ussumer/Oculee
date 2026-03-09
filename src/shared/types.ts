import { z } from 'zod'

export const ToastShowPayloadSchema = z.object({
  text: z.string()
})

export const WindowBoundsSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number()
})

export const WindowContextSchema = z.object({
  id: z.number().optional(),
  appName: z.string().nullable(),
  titleRaw: z.string().nullable(),
  titleSafe: z.string(),
  bounds: WindowBoundsSchema.nullable(),
  isSensitive: z.boolean()
})

export type ToastShowPayload = z.infer<typeof ToastShowPayloadSchema>
export type WindowBounds = z.infer<typeof WindowBoundsSchema>
export type WindowContext = z.infer<typeof WindowContextSchema>
