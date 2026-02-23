import { z } from 'zod'

const DEFAULT_MODEL = 'gpt-4o-mini'
const DEFAULT_TIMEOUT_MS = 5000
const DEFAULT_API_URL = 'https://api.openai.com/v1/chat/completions'
const DEFAULT_MAX_OUTPUT_TOKENS = 180
const DEFAULT_TEMPERATURE = 1.1

export type LlmErrorCode = 'MISSING_KEY' | 'TIMEOUT' | 'REQUEST_FAILED' | 'EMPTY_TEXT'

export interface LlmImagePart {
  mimeType: string
  dataBase64: string
}

export interface LlmRoastRequest {
  prompt: string
  image?: LlmImagePart
}

export class LlmError extends Error {
  readonly code: LlmErrorCode

  constructor(code: LlmErrorCode, message: string) {
    super(message)
    this.name = 'LlmError'
    this.code = code
  }
}

const OpenAIContentPartsSchema = z.array(
  z.object({
    type: z.literal('text'),
    text: z.string().trim().min(1)
  })
)

const OpenAIChatCompletionResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z
          .object({
            content: z.union([z.string().trim().min(1), OpenAIContentPartsSchema.min(1)])
          })
          .optional(),
        text: z.string().trim().min(1).optional()
      })
    )
    .min(1)
})

function normalizeTimeoutMs(value: string | undefined): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_TIMEOUT_MS
  }
  return Math.floor(parsed)
}

function normalizeMaxOutputTokens(value: string | undefined): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_MAX_OUTPUT_TOKENS
  }
  return Math.floor(parsed)
}

function normalizeTemperature(value: string | undefined): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_TEMPERATURE
  }
  return parsed
}

function resolveApiUrl(): URL {
  const directUrl = process.env.LLM_API_URL?.trim()
  return new URL(directUrl || DEFAULT_API_URL)
}

function buildRequestBody(
  prompt: string,
  model: string,
  image: LlmImagePart | undefined,
  maxOutputTokens: number,
  temperature: number
): Record<string, unknown> {
  const content = image
    ? [
        { type: 'text', text: prompt },
        {
          type: 'image_url',
          image_url: { url: `data:${image.mimeType};base64,${image.dataBase64}` }
        }
      ]
    : prompt

  return {
    model,
    messages: [{ role: 'user', content }],
    stream: false,
    max_tokens: maxOutputTokens,
    temperature
  }
}

function serializeErrorBody(payload: string): string {
  return payload.slice(0, 200)
}

function extractTextFromResponse(payload: string): string {
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(payload)
  } catch {
    throw new LlmError('REQUEST_FAILED', 'LLM returned invalid JSON payload')
  }

  const parsed = OpenAIChatCompletionResponseSchema.safeParse(parsedJson)
  if (!parsed.success) {
    throw new LlmError('EMPTY_TEXT', 'OpenAI response did not match expected schema')
  }

  const choice = parsed.data.choices[0]
  const content = choice.message?.content

  if (typeof content === 'string') {
    return content.trim()
  }
  if (Array.isArray(content) && content[0]) {
    return content[0].text.trim()
  }
  if (choice.text) {
    return choice.text.trim()
  }

  throw new LlmError('EMPTY_TEXT', 'OpenAI response has no text')
}

export function hasLlmApiKey(): boolean {
  return Boolean(process.env.LLM_API_KEY?.trim())
}

export async function generateLlmRoast(request: LlmRoastRequest): Promise<string> {
  const apiKey = process.env.LLM_API_KEY?.trim()
  if (!apiKey) {
    throw new LlmError('MISSING_KEY', 'LLM API key is missing')
  }

  const model = process.env.LLM_MODEL?.trim() || DEFAULT_MODEL
  const timeoutMs = normalizeTimeoutMs(process.env.LLM_TIMEOUT_MS)
  const maxOutputTokens = normalizeMaxOutputTokens(process.env.LLM_MAX_OUTPUT_TOKENS)
  const temperature = normalizeTemperature(process.env.LLM_TEMPERATURE)
  const endpoint = resolveApiUrl()

  const body = buildRequestBody(request.prompt, model, request.image, maxOutputTokens, temperature)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`
  }

  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, timeoutMs)

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    })

    const payload = await response.text()

    if (!response.ok) {
      throw new LlmError('REQUEST_FAILED', `LLM HTTP ${response.status}: ${serializeErrorBody(payload)}`)
    }

    const text = extractTextFromResponse(payload)
    if (!text) {
      throw new LlmError('EMPTY_TEXT', 'LLM returned empty text')
    }

    return text
  } catch (error: unknown) {
    if (error instanceof LlmError) {
      throw error
    }

    if (error instanceof Error && error.name === 'AbortError') {
      throw new LlmError('TIMEOUT', `LLM request timed out in ${timeoutMs}ms`)
    }

    throw new LlmError('REQUEST_FAILED', `LLM request failed: ${String(error)}`)
  } finally {
    clearTimeout(timer)
  }
}
