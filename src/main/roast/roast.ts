import { roastLocal } from '../roastLocal'
import type { WindowContext } from '../../shared/types'
import { captureRoastImage } from './capture'
import { LlmError, type LlmConfig, type LlmErrorCode, generateLlmRoast } from './llmClient'
import { buildRoastPrompt } from './prompt'
import { clampByCodePoints, codePointLength } from '../../shared/utils/stringUtils'
import { z } from 'zod'

const MAX_TOAST_LENGTH = 100
const MIN_TOAST_LENGTH = 8
const MISSING_KEY_NOTICE = '未配置KEY，使用本地吐槽'
const FALLBACK_TEXT = '先深呼吸再继续'
const DEFAULT_MODEL = 'gpt-4o-mini'
const DEFAULT_TIMEOUT_MS = 5000
const DEFAULT_API_URL = 'https://api.openai.com/v1/chat/completions'
const DEFAULT_MAX_OUTPUT_TOKENS = 180
const DEFAULT_TEMPERATURE = 1.1

const PREFIX_LABEL_REGEX = /^(吐槽|建议|回复|输出|结果|一句话|答案)[:：]\s*/i
const LEADING_CHATTER_REGEX = /^(好的|当然|那么|这里是|你可以|可以说|给你一句|建议你|不妨|请)\s*/i
const LIST_PREFIX_REGEX = /^([0-9]+[).、]|[-*•])\s*/

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
  return clampByCodePoints(text, MAX_TOAST_LENGTH)
}

function textLength(text: string): number {
  return codePointLength(text)
}

function cleanRoastText(input: string, ctx?: WindowContext): string {
  void ctx

  const firstLine = input
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0)

  let normalized = firstLine ?? ''
  normalized = normalized.replace(LIST_PREFIX_REGEX, '')
  normalized = normalized.replace(PREFIX_LABEL_REGEX, '')
  normalized = normalized.replace(LEADING_CHATTER_REGEX, '')
  normalized = normalized.replace(/\s+/g, ' ').trim()

  return clampText(normalized)
}

function getFallbackText(ctx?: WindowContext, style?: string): string {
  const local = cleanRoastText(roastLocal(ctx, style), ctx)
  if (local) {
    return local
  }
  return cleanRoastText(FALLBACK_TEXT, ctx)
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
    const image = await captureRoastImage(ctx?.bounds)
    usedImage = Boolean(image)
    const primaryPrompt = buildRoastPrompt(ctx, style, { hasImage: usedImage })

    try {
      const primaryTextRaw = await generateLlmRoast({ prompt: primaryPrompt, image }, primaryConfig)
      const primaryText = cleanRoastText(primaryTextRaw, ctx)

      if (!primaryText) {
        throw new LlmError('EMPTY_TEXT', 'PRIMARY text empty after clean')
      }
      if (textLength(primaryText) < MIN_TOAST_LENGTH) {
        primaryReason = 'TOO_SHORT'
        const fallback = getFallbackText(ctx, style)
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
      logResult('OK', ctx, startedAt, {
        route: 'PRIMARY',
        usedFallback: false,
        usedImage,
        primaryReason,
        flashReason
      })
      return primaryText
    } catch (primaryError: unknown) {
      primaryReason = toErrorCode(primaryError)
      const flashPrompt = usedImage ? buildRoastPrompt(ctx, style, { hasImage: false }) : primaryPrompt

      try {
        const flashTextRaw = await generateLlmRoast({ prompt: flashPrompt }, flashConfig)
        const flashText = cleanRoastText(flashTextRaw, ctx)

        if (!flashText) {
          throw new LlmError('EMPTY_TEXT', 'FLASH_API text empty after clean')
        }
        if (textLength(flashText) < MIN_TOAST_LENGTH) {
          flashReason = 'TOO_SHORT'
          const fallback = getFallbackText(ctx, style)
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
        logResult('OK', ctx, startedAt, {
          route: 'FLASH_API',
          usedFallback: false,
          usedImage: false,
          primaryReason,
          flashReason
        })
        return flashText
      } catch (flashError: unknown) {
        flashReason = toErrorCode(flashError)
        throw flashError
      }
    }
  } catch (error: unknown) {
    const reason = toErrorCode(error)
    maybeQueueMissingKeyNotice(reason)

    const fallback = getFallbackText(ctx, style)

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
  return 'UNKNOWN'
}
