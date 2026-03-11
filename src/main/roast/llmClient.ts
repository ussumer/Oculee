import { createOpenAI } from '@ai-sdk/openai'
import { stepCountIs, streamText, type ModelMessage } from 'ai'
import { z } from 'zod'
import { banterTools } from './tools'

const DEFAULT_MODEL = 'gpt-4o-mini'
const DEFAULT_TIMEOUT_MS = 5000
const DEFAULT_API_URL = 'https://api.openai.com/v1'
const DEFAULT_MAX_OUTPUT_TOKENS = 180
const DEFAULT_TEMPERATURE = 1.1
const EMOTION_TOOL_NAME = 'changeEmotion'
const SYSTEM_ROLE_PROMPT =
  '你是一个中文桌面吐槽助手。先调用一次 changeEmotion 工具设置头像情绪，再输出一句中文吐槽成品。不要解释，不要编号，不要前后缀。'
const SYSTEM_ROLE_PROMPT_TEXT_ONLY =
  '你是一个中文桌面吐槽助手。直接输出一句中文吐槽成品。不要解释，不要编号，不要前后缀。'

export type LlmErrorCode = 'MISSING_KEY' | 'TIMEOUT' | 'REQUEST_FAILED' | 'EMPTY_TEXT'

export interface LlmImagePart {
  mimeType: string
  dataBase64: string
}

export interface LlmRoastRequest {
  prompt: string
  image?: LlmImagePart
  allowEmotionTool?: boolean
}

export interface LlmConfig {
  apiKey: string
  apiUrl: string
  model: string
  timeoutMs: number
  maxOutputTokens: number
  temperature: number
}

export class LlmError extends Error {
  readonly code: LlmErrorCode

  constructor(code: LlmErrorCode, message: string) {
    super(message)
    this.name = 'LlmError'
    this.code = code
  }
}

const UrlStringSchema = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim() : value),
  z.url()
)

const LlmConfigSchema = z.object({
  apiKey: z.string().trim().default('').catch(''),
  apiUrl: UrlStringSchema.default(DEFAULT_API_URL).catch(DEFAULT_API_URL),
  model: z.string().trim().min(1).default(DEFAULT_MODEL).catch(DEFAULT_MODEL),
  timeoutMs: z.coerce.number().int().positive().default(DEFAULT_TIMEOUT_MS).catch(DEFAULT_TIMEOUT_MS),
  maxOutputTokens: z.coerce
    .number()
    .int()
    .positive()
    .default(DEFAULT_MAX_OUTPUT_TOKENS)
    .catch(DEFAULT_MAX_OUTPUT_TOKENS),
  temperature: z.coerce
    .number()
    .nonnegative()
    .default(DEFAULT_TEMPERATURE)
    .catch(DEFAULT_TEMPERATURE)
})

function parseEnvConfig(): LlmConfig {
  return LlmConfigSchema.parse({
    apiKey: process.env.LLM_API_KEY,
    apiUrl: process.env.LLM_API_URL,
    model: process.env.LLM_MODEL,
    timeoutMs: process.env.LLM_TIMEOUT_MS,
    maxOutputTokens: process.env.LLM_MAX_OUTPUT_TOKENS,
    temperature: process.env.LLM_TEMPERATURE
  })
}

function resolveConfig(config: LlmConfig): LlmConfig {
  const envConfig = parseEnvConfig()
  return LlmConfigSchema.parse({ ...envConfig, ...config })
}

function normalizeBaseUrl(apiUrl: string): string {
  const trimmed = apiUrl.trim()
  return trimmed.replace(/\/chat\/completions\/?$/i, '')
}

function isDebugEnabled(): boolean {
  const value = process.env.DEBUG_LLM?.trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes'
}

function debugToolStep(step: {
  stepNumber: number
  finishReason: string
  toolCalls: ReadonlyArray<{
    toolName: string
    toolCallId: string
    dynamic?: boolean
  }>
  toolResults: ReadonlyArray<{
    toolName: string
    toolCallId: string
    providerExecuted?: boolean
    dynamic?: boolean
  }>
}): void {
  if (!isDebugEnabled()) {
    return
  }
  if (step.toolCalls.length === 0 && step.toolResults.length === 0) {
    return
  }

  console.log('[llm:function-call]', {
    stepNumber: step.stepNumber,
    finishReason: step.finishReason,
    toolCalls: step.toolCalls.map((call) => ({
      toolName: call.toolName,
      toolCallId: call.toolCallId,
      dynamic: Boolean(call.dynamic)
    })),
    toolResults: step.toolResults.map((result) => ({
      toolName: result.toolName,
      toolCallId: result.toolCallId,
      providerExecuted: Boolean(result.providerExecuted),
      dynamic: Boolean(result.dynamic)
    }))
  })
}

function buildMessages(request: LlmRoastRequest): ModelMessage[] {
  if (!request.image) {
    return [{ role: 'user', content: request.prompt }]
  }

  return [
    {
      role: 'user',
      content: [
        { type: 'text', text: request.prompt },
        {
          type: 'image',
          image: request.image.dataBase64,
          mediaType: request.image.mimeType
        }
      ]
    }
  ]
}

export function hasLlmApiKey(config?: Partial<LlmConfig>): boolean {
  const key = config?.apiKey?.trim() || process.env.LLM_API_KEY?.trim()
  return Boolean(key)
}

export function streamLlmRoast(request: LlmRoastRequest, config: LlmConfig) {
  const resolvedConfig = resolveConfig(config)
  if (!hasLlmApiKey(resolvedConfig)) {
    throw new LlmError('MISSING_KEY', 'LLM API key is missing')
  }
  const allowEmotionTool = request.allowEmotionTool !== false

  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, resolvedConfig.timeoutMs)

  try {
    const provider = createOpenAI({
      baseURL: normalizeBaseUrl(resolvedConfig.apiUrl || process.env.LLM_API_URL || DEFAULT_API_URL),
      apiKey: resolvedConfig.apiKey
    })

    return streamText({
      model: provider.chat(resolvedConfig.model || process.env.LLM_MODEL || DEFAULT_MODEL),
      tools: banterTools,
      system: allowEmotionTool ? SYSTEM_ROLE_PROMPT : SYSTEM_ROLE_PROMPT_TEXT_ONLY,
      messages: buildMessages(request),
      prepareStep: ({ stepNumber }) => {
        if (allowEmotionTool && stepNumber === 0) {
          return {
            activeTools: [EMOTION_TOOL_NAME],
            toolChoice: { type: 'tool', toolName: EMOTION_TOOL_NAME }
          }
        }
        return {
          activeTools: [],
          toolChoice: 'none'
        }
      },
      stopWhen: stepCountIs(allowEmotionTool ? 2 : 1),
      maxOutputTokens: resolvedConfig.maxOutputTokens,
      temperature: resolvedConfig.temperature,
      abortSignal: controller.signal,
      onAbort: () => {
        clearTimeout(timer)
      },
      onError: () => {
        clearTimeout(timer)
      },
      onStepFinish: (step) => {
        debugToolStep(step)
      },
      onFinish: () => {
        clearTimeout(timer)
      }
    })
  } catch (error: unknown) {
    clearTimeout(timer)
    if (error instanceof LlmError) {
      throw error
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new LlmError('TIMEOUT', `LLM request timed out in ${resolvedConfig.timeoutMs}ms`)
    }
    throw new LlmError('REQUEST_FAILED', `LLM request failed: ${String(error)}`)
  }
}
