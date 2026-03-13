import { roastLocal } from '../roastLocal'
import type { WindowContext } from '../../shared/types'
import { captureRoastImage } from './capture'
import { LlmError, type LlmConfig, type LlmErrorCode, streamLlmRoast } from './llmClient'
import { buildRoastPrompt } from './prompt'
import { createEventId } from '../memory/eventId'
import { appendInteractionLog } from '../memory/logWriter'
import { prepareMemoryContext, updateCurrentSession } from '../memory/context'
import type { InteractionEvent, InteractionRoute, SessionRoute } from '../memory/schema'
import { formatLocalIsoTimestamp } from '../memory/time'
import { sanitizeWindowContext, type SanitizedWindowContext } from '../privacy/sanitize'
import { codePointLength, trimAndClampByCodePoints } from '../../shared/utils/stringUtils'
import { z } from 'zod'
import { getOverlayWindow } from '../windowManager'
import { APICallError, AISDKError } from 'ai'
import { TOAST_SHOW_CHANNEL, AVATAR_CHANGE_CHANNEL, type ToastShowPayload } from '../../shared/ipc'

const MAX_TOAST_LENGTH = 100
const MIN_TOAST_LENGTH = 8
const MISSING_KEY_NOTICE = '未配置KEY，使用本地吐槽'
const FALLBACK_TEXT = '先深呼吸再继续'
const DEFAULT_MODEL = 'gpt-4o-mini'
const DEFAULT_TIMEOUT_MS = 5000
const DEFAULT_API_URL = 'https://api.openai.com/v1'
const DEFAULT_MAX_OUTPUT_TOKENS = 180
const DEFAULT_TEMPERATURE = 1.1
const STREAM_RENDER_CHARS_PER_TICK = 12
const STREAM_RENDER_DELAY_MS = 0
const REDACTED_LOG_TITLE = '[redacted]'

type RoastRoute = 'PRIMARY' | 'FLASH_API' | 'LOCAL_FALLBACK'
type RoastReason = LlmErrorCode | 'UNKNOWN' | 'OK' | 'TOO_SHORT'
type RouteReason = RoastReason | 'SKIPPED'

const PositiveIntSchema = z.coerce.number().int().positive()
const NonNegativeNumberSchema = z.coerce.number().nonnegative()
const UrlStringSchema = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim() : value),
  z.url()
)

let missingKeyNoticeShown = false
let pendingNotice: string | null = null

function isDebugEnabled(): boolean {
  const value = process.env.DEBUG_LLM?.trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes'
}

function clampText(text: string): string {
  return trimAndClampByCodePoints(text, MAX_TOAST_LENGTH)
}

function textLength(text: string): number {
  return codePointLength(text)
}

function getFallbackText(ctx?: WindowContext, style?: string): string {
  const local = clampText(roastLocal(ctx, style))
  if (local) {
    return local
  }
  return clampText(FALLBACK_TEXT)
}

function readEnv(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key]?.trim()
    if (value) {
      return value
    }
  }
  return undefined
}

function resolveLlmConfig(raw: Record<keyof LlmConfig, unknown>, defaults: LlmConfig): LlmConfig {
  const schema = z.object({
    apiKey: z.string().trim().catch(defaults.apiKey),
    apiUrl: UrlStringSchema.catch(defaults.apiUrl),
    model: z.string().trim().min(1).catch(defaults.model),
    timeoutMs: PositiveIntSchema.catch(defaults.timeoutMs),
    maxOutputTokens: PositiveIntSchema.catch(defaults.maxOutputTokens),
    temperature: NonNegativeNumberSchema.catch(defaults.temperature)
  })

  return schema.parse(raw)
}

function buildPrimaryConfig(): LlmConfig {
  const defaults: LlmConfig = {
    apiKey: '',
    apiUrl: DEFAULT_API_URL,
    model: DEFAULT_MODEL,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    temperature: DEFAULT_TEMPERATURE
  }

  return resolveLlmConfig(
    {
      apiKey: readEnv('PRIMARY_LLM_API_KEY', 'LLM_API_KEY'),
      apiUrl: readEnv('PRIMARY_LLM_API_URL', 'LLM_API_URL'),
      model: readEnv('PRIMARY_LLM_MODEL', 'LLM_MODEL'),
      timeoutMs: readEnv('PRIMARY_LLM_TIMEOUT_MS', 'LLM_TIMEOUT_MS'),
      maxOutputTokens: readEnv('PRIMARY_LLM_MAX_OUTPUT_TOKENS', 'LLM_MAX_OUTPUT_TOKENS'),
      temperature: readEnv('PRIMARY_LLM_TEMPERATURE', 'LLM_TEMPERATURE')
    },
    defaults
  )
}

function buildFlashConfig(primaryConfig: LlmConfig): LlmConfig {
  const defaults: LlmConfig = {
    apiKey: '',
    apiUrl: primaryConfig.apiUrl,
    model: primaryConfig.model,
    timeoutMs: primaryConfig.timeoutMs,
    maxOutputTokens: primaryConfig.maxOutputTokens,
    temperature: primaryConfig.temperature
  }

  return resolveLlmConfig(
    {
      apiKey: readEnv('FLASH_LLM_API_KEY'),
      apiUrl: readEnv('FLASH_LLM_API_URL'),
      model: readEnv('FLASH_LLM_MODEL'),
      timeoutMs: readEnv('FLASH_LLM_TIMEOUT_MS'),
      maxOutputTokens: readEnv('FLASH_LLM_MAX_OUTPUT_TOKENS'),
      temperature: readEnv('FLASH_LLM_TEMPERATURE')
    },
    defaults
  )
}

function maybeQueueMissingKeyNotice(reason: LlmErrorCode | 'UNKNOWN'): void {
  if (reason !== 'MISSING_KEY' || missingKeyNoticeShown) {
    return
  }
  pendingNotice = MISSING_KEY_NOTICE
}

function pushToastText(text: string): void {
  const content = clampText(text)
  if (!content) {
    return
  }
  const overlayWindow = getOverlayWindow()
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    return
  }
  const payload: ToastShowPayload = { text: content }
  overlayWindow.webContents.send(TOAST_SHOW_CHANNEL, payload)
}

function splitByCodePoints(text: string, size: number): string[] {
  const normalizedSize = Math.max(1, Math.floor(size))
  const units = Array.from(text)
  const chunks: string[] = []
  for (let i = 0; i < units.length; i += normalizedSize) {
    chunks.push(units.slice(i, i + normalizedSize).join(''))
  }
  return chunks
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function appendToastChunkWithPacing(currentText: string, chunk: string): Promise<string> {
  if (STREAM_RENDER_DELAY_MS <= 0) {
    const nextText = currentText + chunk
    pushToastText(nextText)
    return nextText
  }

  const parts = splitByCodePoints(chunk, STREAM_RENDER_CHARS_PER_TICK)
  let nextText = currentText
  for (let i = 0; i < parts.length; i += 1) {
    nextText += parts[i]
    pushToastText(nextText)
    if (STREAM_RENDER_DELAY_MS > 0 && i < parts.length - 1) {
      await sleep(STREAM_RENDER_DELAY_MS)
    }
  }
  return nextText
}

type StreamPart = {
  type: string
  [key: string]: unknown
}

interface StreamedRoastResult {
  fullStream: AsyncIterable<StreamPart>
}

interface CollectedStreamText {
  text: string
  emotion: string | null
}

function getElapsedMs(startTime: number): number {
  return Date.now() - startTime
}

function readPartString(part: StreamPart, key: string): string | undefined {
  const value = part[key]
  return typeof value === 'string' ? value : undefined
}

function readEmotionFromPayload(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const emotion = (value as Record<string, unknown>).emotion
  if (typeof emotion !== 'string') {
    return null
  }
  const normalized = emotion.trim()
  return normalized || null
}

function readEmotionFromToolCallPart(part: StreamPart): string | null {
  if (readPartString(part, 'toolName') !== 'changeEmotion') {
    return null
  }

  const fromInput = readEmotionFromPayload(part.input)
  if (fromInput) {
    return fromInput
  }

  const fromArgs = readEmotionFromPayload(part.args)
  if (fromArgs) {
    return fromArgs
  }

  return null
}

function debugStreamTiming(
  route: Exclude<RoastRoute, 'LOCAL_FALLBACK'>,
  event: string,
  data: Record<string, unknown>
): void {
  if (!isDebugEnabled()) {
    return
  }

  console.log('[roast:timing]', {
    route,
    event,
    ...data
  })
}

function debugFullStreamEvent(
  route: Exclude<RoastRoute, 'LOCAL_FALLBACK'>,
  part: StreamPart,
  elapsedMs?: number
): void {
  if (!isDebugEnabled()) {
    return
  }

  if (part.type === 'tool-call' || part.type === 'tool-result') {
    console.log('[roast:stream]', {
      route,
      type: part.type,
      elapsedMs,
      toolName: readPartString(part, 'toolName'),
      toolCallId: readPartString(part, 'toolCallId')
    })
    return
  }

  if (part.type === 'finish-step' || part.type === 'finish') {
    console.log('[roast:stream]', {
      route,
      type: part.type,
      elapsedMs,
      finishReason: readPartString(part, 'finishReason'),
      rawFinishReason: readPartString(part, 'rawFinishReason')
    })
  }
}

function toStreamError(route: Exclude<RoastRoute, 'LOCAL_FALLBACK'>, error: unknown): LlmError {
  if (error instanceof LlmError) {
    return error
  }
  if (APICallError.isInstance(error)) {
    if (error.statusCode === 408 || /timed?\s*out|timeout/i.test(error.message)) {
      return new LlmError('TIMEOUT', `${route} stream timeout: ${error.message}`)
    }
    return new LlmError('REQUEST_FAILED', `${route} stream request failed: ${error.message}`)
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return new LlmError('TIMEOUT', `${route} stream aborted`)
  }
  if (error instanceof Error) {
    return new LlmError('REQUEST_FAILED', `${route} stream error: ${error.message}`)
  }
  return new LlmError('REQUEST_FAILED', `${route} stream error: ${String(error)}`)
}

async function collectStreamedText(
  route: Exclude<RoastRoute, 'LOCAL_FALLBACK'>,
  result: StreamedRoastResult,
  requestStartedAt: number
): Promise<CollectedStreamText> {
  let text = ''
  let pendingEmotion: string | null = null
  let lastEmotion: string | null = null
  let isFirstToken = true
  let firstToolCallMs: number | null = null
  let firstTextDeltaMs: number | null = null
  let textChunkCount = 0
  let textCharsTotal = 0
  for await (const part of result.fullStream) {
    const elapsedMs = getElapsedMs(requestStartedAt)
    switch (part.type) {
      case 'text-delta': {
        const chunk = readPartString(part, 'textDelta') || readPartString(part, 'text')
        if (!chunk) {
          break
        }

        if (firstTextDeltaMs === null) {
          firstTextDeltaMs = elapsedMs
          debugStreamTiming(route, 'first-text-delta', {
            elapsedMs,
            chunkChars: codePointLength(chunk),
            hadPendingEmotion: Boolean(pendingEmotion)
          })
        }

        if (isFirstToken) {
          if (pendingEmotion) {
            const win = getOverlayWindow()
            if (win && !win.isDestroyed()) {
              win.webContents.send(AVATAR_CHANGE_CHANNEL, pendingEmotion)
            }
            pendingEmotion = null
          }
          isFirstToken = false
        }
        textChunkCount += 1
        textCharsTotal += codePointLength(chunk)
        text = await appendToastChunkWithPacing(text, chunk)
        break
      }
      case 'tool-call': {
        const emotion = readEmotionFromToolCallPart(part)
        if (firstToolCallMs === null) {
          firstToolCallMs = elapsedMs
          debugStreamTiming(route, 'first-tool-call', {
            elapsedMs,
            toolName: readPartString(part, 'toolName'),
            emotion
          })
        }
        if (emotion) {
          pendingEmotion = emotion
          lastEmotion = emotion
        }
        debugFullStreamEvent(route, part, elapsedMs)
        break
      }
      case 'tool-result':
      case 'finish-step':
      case 'finish':
        debugFullStreamEvent(route, part, elapsedMs)
        break
      case 'abort':
        throw new LlmError('TIMEOUT', `${route} stream aborted`)
      case 'error':
        throw toStreamError(route, part.error)
      default:
        break
    }
  }

  debugStreamTiming(route, 'stream-complete', {
    elapsedMs: getElapsedMs(requestStartedAt),
    firstToolCallMs,
    firstTextDeltaMs,
    textChunkCount,
    textCharsTotal,
    outputChars: codePointLength(text)
  })

  return {
    text: clampText(text),
    emotion: lastEmotion
  }
}

function toSessionSafeAppName(ctx: SanitizedWindowContext): string {
  return ctx.isSensitive ? '敏感应用' : ctx.appName
}

function queueSessionUpdate(
  ctx: SanitizedWindowContext,
  route: SessionRoute,
  lastEmotion: string | null,
  lastHasImage: boolean
): void {
  void updateCurrentSession({
    lastApp: toSessionSafeAppName(ctx),
    lastTitleSafe: ctx.titleSafe,
    lastRoute: route,
    lastEmotion,
    lastHasImage
  }).catch((error: unknown) => {
    if (!isDebugEnabled()) {
      return
    }
    console.error('[memory] session update failed', error)
  })
}

function toInteractionRoute(route: RoastRoute): InteractionRoute {
  switch (route) {
    case 'PRIMARY':
      return 'primary'
    case 'FLASH_API':
      return 'flash'
    case 'LOCAL_FALLBACK':
      return 'local'
  }
}

function buildInteractionEvent(
  ctx: SanitizedWindowContext,
  route: RoastRoute,
  roastText: string,
  lastEmotion: string | null,
  hasImage: boolean
): InteractionEvent {
  const blockedByPrivacy = ctx.isSensitive
  const safeAppName = toSessionSafeAppName(ctx)

  return {
    id: createEventId(),
    timestamp: formatLocalIsoTimestamp(),
    source: { kind: 'roast' },
    appName: safeAppName,
    titleSafe: blockedByPrivacy ? REDACTED_LOG_TITLE : ctx.titleSafe,
    route: toInteractionRoute(route),
    emotion: blockedByPrivacy ? undefined : lastEmotion ?? undefined,
    hasImage: blockedByPrivacy ? false : hasImage,
    usedFallback: route !== 'PRIMARY',
    blockedByPrivacy,
    roastText: blockedByPrivacy ? '' : roastText,
    sessionSnapshot: {
      lastApp: safeAppName,
      lastRoute: route,
      lastEmotion: blockedByPrivacy ? undefined : lastEmotion ?? undefined
    }
  }
}

function queueInteractionLog(
  ctx: SanitizedWindowContext,
  route: RoastRoute,
  roastText: string,
  lastEmotion: string | null,
  hasImage: boolean
): void {
  void appendInteractionLog(buildInteractionEvent(ctx, route, roastText, lastEmotion, hasImage))
}

function debugLog(data: {
  durationMs: number
  route: RoastRoute
  usedFallback: boolean
  usedImage: boolean
  reason: RoastReason
  primaryReason: RouteReason
  flashReason: RouteReason
  hasContext: boolean
  isSensitive: boolean
}): void {
  if (!isDebugEnabled()) {
    return
  }

  console.log('[roast]', data)
}

interface LogResultExtra {
  route: RoastRoute
  usedFallback: boolean
  usedImage: boolean
  primaryReason: RouteReason
  flashReason: RouteReason
}

function logResult(
  reason: RoastReason,
  ctx: WindowContext | undefined,
  startTime: number,
  extra?: Partial<LogResultExtra>
): void {
  debugLog({
    durationMs: Date.now() - startTime,
    route: extra?.route ?? 'LOCAL_FALLBACK',
    usedFallback: extra?.usedFallback ?? true,
    usedImage: extra?.usedImage ?? false,
    reason,
    primaryReason: extra?.primaryReason ?? 'SKIPPED',
    flashReason: extra?.flashReason ?? 'SKIPPED',
    hasContext: Boolean(ctx),
    isSensitive: Boolean(ctx?.isSensitive)
  })
}

function debugRouteError(route: Exclude<RoastRoute, 'LOCAL_FALLBACK'>, error: unknown): void {
  if (!isDebugEnabled()) {
    return
  }

  if (APICallError.isInstance(error)) {
    console.log('[roast:error]', {
      route,
      type: 'APICallError',
      message: error.message,
      statusCode: error.statusCode,
      isRetryable: error.isRetryable,
      responseBody: error.responseBody?.slice(0, 200)
    })
    return
  }

  if (AISDKError.isInstance(error)) {
    console.log('[roast:error]', {
      route,
      type: error.name,
      message: error.message
    })
    return
  }

  if (error instanceof Error) {
    console.log('[roast:error]', {
      route,
      type: error.name,
      message: error.message
    })
    return
  }

  console.log('[roast:error]', {
    route,
    type: 'UnknownNonError',
    error: String(error)
  })
}

export function consumeRoastNotice(): string | null {
  if (!pendingNotice) {
    return null
  }

  const text = pendingNotice
  pendingNotice = null
  missingKeyNoticeShown = true
  return text
}

export async function roast(ctx?: WindowContext, style?: string): Promise<string> {
  const startedAt = Date.now()
  let usedImage = false
  let primaryReason: RouteReason = 'SKIPPED'
  let flashReason: RouteReason = 'SKIPPED'

  const primaryConfig = buildPrimaryConfig()
  const flashConfig = buildFlashConfig(primaryConfig)

  try {
    const image = await captureRoastImage(ctx)
    usedImage = Boolean(image)
    const sanitizedCtx = sanitizeWindowContext(ctx)
    const memoryContext = await prepareMemoryContext()
    const primaryPrompt = buildRoastPrompt(sanitizedCtx, style, {
      hasImage: usedImage,
      memoryContext
    })
    const primaryRequestStartedAt = Date.now()

    debugStreamTiming('PRIMARY', 'request-start', {
      elapsedMs: 0,
      hasImage: usedImage,
      promptChars: codePointLength(primaryPrompt),
      timeoutMs: primaryConfig.timeoutMs,
      model: primaryConfig.model
    })

    try {
      const primaryResult = streamLlmRoast({ prompt: primaryPrompt, image }, primaryConfig)
      const primaryOutput = await collectStreamedText('PRIMARY', primaryResult, primaryRequestStartedAt)
      const primaryText = primaryOutput.text

      if (!primaryText) {
        throw new LlmError('EMPTY_TEXT', 'PRIMARY text empty after stream')
      }
      if (textLength(primaryText) < MIN_TOAST_LENGTH) {
        primaryReason = 'TOO_SHORT'
        const fallback = getFallbackText(ctx, style)
        queueSessionUpdate(sanitizedCtx, 'LOCAL_FALLBACK', null, false)
        queueInteractionLog(sanitizedCtx, 'LOCAL_FALLBACK', fallback, null, false)
        logResult('TOO_SHORT', ctx, startedAt, {
          route: 'LOCAL_FALLBACK',
          usedFallback: true,
          usedImage,
          primaryReason,
          flashReason
        })
        return fallback
      }

      primaryReason = 'OK'
      queueSessionUpdate(sanitizedCtx, 'PRIMARY', primaryOutput.emotion, usedImage)
      queueInteractionLog(sanitizedCtx, 'PRIMARY', primaryText, primaryOutput.emotion, usedImage)
      logResult('OK', ctx, startedAt, {
        route: 'PRIMARY',
        usedFallback: false,
        usedImage,
        primaryReason,
        flashReason
      })
      return primaryText
    } catch (primaryError: unknown) {
      debugRouteError('PRIMARY', primaryError)
      primaryReason = toErrorCode(primaryError)
      const flashPrompt = usedImage
        ? buildRoastPrompt(sanitizedCtx, style, { hasImage: false, memoryContext })
        : primaryPrompt
      const flashRequestStartedAt = Date.now()

      debugStreamTiming('FLASH_API', 'request-start', {
        elapsedMs: 0,
        hasImage: false,
        promptChars: codePointLength(flashPrompt),
        timeoutMs: flashConfig.timeoutMs,
        model: flashConfig.model
      })

      try {
        const flashResult = streamLlmRoast({ prompt: flashPrompt, allowEmotionTool: false }, flashConfig)
        const flashOutput = await collectStreamedText('FLASH_API', flashResult, flashRequestStartedAt)
        const flashText = flashOutput.text

        if (!flashText) {
          throw new LlmError('EMPTY_TEXT', 'FLASH_API text empty after stream')
        }
        if (textLength(flashText) < MIN_TOAST_LENGTH) {
          flashReason = 'TOO_SHORT'
          const fallback = getFallbackText(ctx, style)
          queueSessionUpdate(sanitizedCtx, 'LOCAL_FALLBACK', null, false)
          queueInteractionLog(sanitizedCtx, 'LOCAL_FALLBACK', fallback, null, false)
          logResult('TOO_SHORT', ctx, startedAt, {
            route: 'LOCAL_FALLBACK',
            usedFallback: true,
            usedImage: false,
            primaryReason,
            flashReason
          })
          return fallback
        }

        flashReason = 'OK'
        queueSessionUpdate(sanitizedCtx, 'FLASH_API', flashOutput.emotion, false)
        queueInteractionLog(sanitizedCtx, 'FLASH_API', flashText, flashOutput.emotion, false)
        logResult('OK', ctx, startedAt, {
          route: 'FLASH_API',
          usedFallback: false,
          usedImage: false,
          primaryReason,
          flashReason
        })
        return flashText
      } catch (flashError: unknown) {
        debugRouteError('FLASH_API', flashError)
        flashReason = toErrorCode(flashError)
        throw flashError
      }
    }
  } catch (error: unknown) {
    const reason = toErrorCode(error)
    maybeQueueMissingKeyNotice(reason)

    const fallback = getFallbackText(ctx, style)
    const sanitizedCtx = sanitizeWindowContext(ctx)
    queueSessionUpdate(sanitizedCtx, 'LOCAL_FALLBACK', null, false)
    queueInteractionLog(sanitizedCtx, 'LOCAL_FALLBACK', fallback, null, false)

    logResult(reason, ctx, startedAt, {
      route: 'LOCAL_FALLBACK',
      usedFallback: true,
      usedImage,
      primaryReason,
      flashReason
    })

    return fallback
  }
}

function toErrorCode(error: unknown): LlmErrorCode | 'UNKNOWN' {
  if (error instanceof LlmError) {
    return error.code
  }
  if (APICallError.isInstance(error)) {
    if (error.statusCode === 408 || /timed?\s*out|timeout/i.test(error.message)) {
      return 'TIMEOUT'
    }
    return 'REQUEST_FAILED'
  }
  if (AISDKError.isInstance(error)) {
    if (/timed?\s*out|timeout/i.test(error.message)) {
      return 'TIMEOUT'
    }
    return 'REQUEST_FAILED'
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return 'TIMEOUT'
  }
  if (error instanceof Error) {
    if (/timed?\s*out|timeout/i.test(error.message)) {
      return 'TIMEOUT'
    }
    return 'REQUEST_FAILED'
  }
  return 'UNKNOWN'
}
