import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createOpenAI } from '@ai-sdk/openai'
import { generateText, type ModelMessage } from 'ai'
import type { LlmConfig } from '../roast/llmClient'
import { getMemoryRoot } from './paths'
import { InteractionEventSchema, type InteractionEvent } from './schema'

const DAY_COMPILER_SYSTEM_PROMPT =
  '你是 Oculee 的后台思考大脑。结合以下时间线的文本流水和截图视觉证据，总结用户今天的核心行为内容、可能的心理状态,整体状态。输出完整不损失信息的精简的 Markdown。'

type CompilerContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; image: string; mediaType: 'image/jpeg' }

function normalizeBaseUrl(apiUrl: string): string {
  return apiUrl.trim().replace(/\/chat\/completions\/?$/i, '')
}

function getLogFilePath(dateStr: string): string {
  const [year = '0000', month = '00', day = '00'] = dateStr.split('-')
  return path.join(getMemoryRoot(), 'logs', year, month, `${day}.jsonl`)
}

function getCompiledFilePath(dateStr: string): string {
  return path.join(getMemoryRoot(), 'compiled', 'days', `${dateStr}.md`)
}

function formatEventTime(timestamp: string): string {
  return timestamp.slice(11, 19) || timestamp
}

async function readDayEvents(dateStr: string): Promise<InteractionEvent[]> {
  const logFilePath = getLogFilePath(dateStr)

  try {
    const raw = await readFile(logFilePath, 'utf8')
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [InteractionEventSchema.parse(JSON.parse(line))]
        } catch (error: unknown) {
          console.warn('[memory] day compiler skipped invalid log line', error)
          return []
        }
      })
  } catch (error: unknown) {
    console.warn('[memory] day compiler could not read log file', error)
    return []
  }
}

async function buildMultimodalMessages(events: InteractionEvent[]): Promise<ModelMessage[]> {
  const content: CompilerContentPart[] = []

  for (const event of events) {
    content.push({
      type: 'text',
      text: `[${formatEventTime(event.timestamp)}] 窗口:${event.appName} | 情绪:${event.emotion ?? 'none'} | 吐槽:${event.roastText}`
    })

    if (!event.imagePath) {
      continue
    }

    try {
      const imageBuffer = await readFile(event.imagePath)
      content.push({
        type: 'image',
        image: imageBuffer.toString('base64'),
        mediaType: 'image/jpeg'
      })
    } catch {
      // Ignore missing or unreadable image files to keep compilation resilient.
    }
  }

  return [{ role: 'user', content }]
}

export async function compileMultimodalDayLog(dateStr: string, config: LlmConfig): Promise<void> {
  const events = await readDayEvents(dateStr)
  const outputPath = getCompiledFilePath(dateStr)

  await mkdir(path.dirname(outputPath), { recursive: true })

  if (events.length === 0) {
    await writeFile(outputPath, `# ${dateStr}\n\n- No interaction logs found.\n`, 'utf8')
    return
  }

  const provider = createOpenAI({
    baseURL: normalizeBaseUrl(config.apiUrl),
    apiKey: config.apiKey
  })

  const messages = await buildMultimodalMessages(events)
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, config.timeoutMs)

  try {
    const result = await generateText({
      model: provider.chat(config.model),
      system: DAY_COMPILER_SYSTEM_PROMPT,
      messages,
      maxOutputTokens: config.maxOutputTokens,
      temperature: config.temperature,
      abortSignal: controller.signal
    })

    await writeFile(outputPath, `${result.text.trim()}\n`, 'utf8')
  } finally {
    clearTimeout(timer)
  }
}
