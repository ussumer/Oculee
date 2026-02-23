import { roastLocal } from '../roastLocal'
import type { WindowContext } from '../../shared/types'
import { captureRoastImage } from './capture'
import { LlmError, type LlmErrorCode, generateLlmRoast, hasLlmApiKey } from './llmClient'
import { buildRoastPrompt } from './prompt'
import { clampByCodePoints, codePointLength } from '../../shared/utils/stringUtils'

const MAX_TOAST_LENGTH = 100
const MIN_TOAST_LENGTH = 8
const MISSING_KEY_NOTICE = '未配置KEY，使用本地吐槽'
const FALLBACK_TEXT = '先深呼吸再继续'

const PREFIX_LABEL_REGEX = /^(吐槽|建议|回复|输出|结果|一句话|答案)[:：]\s*/i
const LEADING_CHATTER_REGEX = /^(好的|当然|那么|这里是|你可以|可以说|给你一句|建议你|不妨|请)\s*/i
const LIST_PREFIX_REGEX = /^([0-9]+[).、]|[-*•])\s*/

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

function sanitizeText(input: string, ctx?: WindowContext): string {
  void ctx

  const normalized = input
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\r?\n|\r/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return clampText(normalized)
}

function normalizeSpokenTone(input: string): string {
  let normalized = input.trim()
  normalized = normalized.split(/\r?\n/).find((line) => line.trim())?.trim() || normalized
  normalized = normalized.replace(LIST_PREFIX_REGEX, '')
  normalized = normalized.replace(PREFIX_LABEL_REGEX, '')
  normalized = normalized.replace(LEADING_CHATTER_REGEX, '')
  normalized = normalized.replace(/\s+/g, ' ').trim()

  return clampText(normalized)
}

function getFallbackText(ctx?: WindowContext, style?: string): string {
  const local = sanitizeText(roastLocal(ctx, style), ctx)
  if (local) {
    return local
  }
  return sanitizeText(FALLBACK_TEXT, ctx)
}

function maybeQueueMissingKeyNotice(reason: LlmErrorCode | 'UNKNOWN'): void {
  if (reason !== 'MISSING_KEY' || missingKeyNoticeShown) {
    return
  }
  pendingNotice = MISSING_KEY_NOTICE
}

function debugLog(data: {
  durationMs: number
  usedFallback: boolean
  usedImage: boolean
  reason: LlmErrorCode | 'UNKNOWN' | 'OK' | 'TOO_SHORT'
  hasContext: boolean
  isSensitive: boolean
}): void {
  if (!isDebugEnabled()) {
    return
  }

  console.log('[roast]', data)
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

  if (!hasLlmApiKey()) {
    maybeQueueMissingKeyNotice('MISSING_KEY')
    const fallback = getFallbackText(ctx, style)
    debugLog({
      durationMs: Date.now() - startedAt,
      usedFallback: true,
      usedImage: false,
      reason: 'MISSING_KEY',
      hasContext: Boolean(ctx),
      isSensitive: Boolean(ctx?.isSensitive)
    })
    return fallback
  }

  try {
    const image = await captureRoastImage(ctx?.bounds)
    usedImage = Boolean(image)
    const prompt = buildRoastPrompt(ctx, style, { hasImage: usedImage })
    const llmText = await generateLlmRoast({ prompt, image })
    const text = normalizeSpokenTone(sanitizeText(llmText, ctx))

    if (!text) {
      throw new LlmError('EMPTY_TEXT', 'LLM text empty after sanitize')
    }
    if (textLength(text) < MIN_TOAST_LENGTH) {
      const fallback = getFallbackText(ctx, style)
      debugLog({
        durationMs: Date.now() - startedAt,
        usedFallback: true,
        usedImage,
        reason: 'TOO_SHORT',
        hasContext: Boolean(ctx),
        isSensitive: Boolean(ctx?.isSensitive)
      })
      return fallback
    }
    debugLog({
      durationMs: Date.now() - startedAt,
      usedFallback: false,
      usedImage,
      reason: 'OK',
      hasContext: Boolean(ctx),
      isSensitive: Boolean(ctx?.isSensitive)
    })

    return text
  } catch (error: unknown) {
    const reason = toErrorCode(error)
    maybeQueueMissingKeyNotice(reason)

    const fallback = getFallbackText(ctx, style)

    debugLog({
      durationMs: Date.now() - startedAt,
      usedFallback: true,
      usedImage,
      reason,
      hasContext: Boolean(ctx),
      isSensitive: Boolean(ctx?.isSensitive)
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
