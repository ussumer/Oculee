import { z } from 'zod'
import type { MemoryContext } from '../memory/schema'
import type { SanitizedWindowContext } from '../privacy/sanitize'
import { dataLoader } from '../dataLoader'

interface PromptOptions {
  hasImage?: boolean
  memoryContext?: MemoryContext
}

const PromptsConfigSchema = z.object({
  defaults: z.object({
    unknownApp: z.string().min(1),
    unknownTitle: z.string().min(1),
    unknownWindow: z.string().min(1),
    imageHintWithImage: z.string().min(1),
    imageHintWithoutImage: z.string().min(1)
  }),
  contextLines: z.object({
    app: z.string().min(1),
    title: z.string().min(1),
    fallbackApp: z.string().min(1),
    fallbackTitle: z.string().min(1)
  }),
  promptLines: z.array(z.string()).min(1)
})

type PromptsConfig = z.infer<typeof PromptsConfigSchema>

function getPromptsConfig(): PromptsConfig {
  return dataLoader.loadJson('prompts.json', PromptsConfigSchema)
}

function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => {
    return values[key] ?? ''
  })
}

function normalizeAppName(value: string | null | undefined, config: PromptsConfig): string {
  const text = value?.trim()
  return text || config.defaults.unknownApp
}

function normalizeTitle(value: string | null | undefined, config: PromptsConfig): string {
  const text = value?.trim()
  return text || config.defaults.unknownTitle
}

function buildContextBlock(ctx: SanitizedWindowContext | undefined, config: PromptsConfig): string {
  if (!ctx) {
    return [
      renderTemplate(config.contextLines.fallbackApp, {
        unknownApp: config.defaults.unknownApp
      }),
      renderTemplate(config.contextLines.fallbackTitle, {
        unknownWindow: config.defaults.unknownWindow
      })
    ].join('\n')
  }

  const appName = normalizeAppName(ctx.appName, config)
  const title = normalizeTitle(ctx.titleSafe, config)

  return [
    renderTemplate(config.contextLines.app, { appName }),
    renderTemplate(config.contextLines.title, { title })
  ].join('\n')
}

function buildMemoryBlock(memoryContext: MemoryContext | undefined): string {
  if (!memoryContext) {
    return ''
  }

  const sections = [
    ['Soul', memoryContext.soulText.trim()],
    ['User', memoryContext.userProfileSummary.trim()],
    ['Session', memoryContext.sessionSummary.trim()]
  ]
    .filter(([, value]) => Boolean(value))
    .map(([label, value]) => `${label}:\n${value}`)

  return sections.join('\n\n')
}

export function buildRoastPrompt(
  ctx?: SanitizedWindowContext,
  style = 'default',
  options: PromptOptions = {}
): string {
  const config = getPromptsConfig()
  const memoryBlock = buildMemoryBlock(options.memoryContext)
  const contextBlock = buildContextBlock(ctx, config)
  const imageHint = options.hasImage
    ? config.defaults.imageHintWithImage
    : config.defaults.imageHintWithoutImage

  const promptBody = config.promptLines
    .map((line) =>
      renderTemplate(line, {
        style,
        imageHint,
        contextBlock
      })
    )
    .join('\n')

  return memoryBlock ? `${memoryBlock}\n\n${promptBody}` : promptBody
}
