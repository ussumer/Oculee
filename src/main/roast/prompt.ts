import { z } from 'zod'
import type { WindowContext } from '../../shared/types'
import { dataLoader } from '../dataLoader'

interface PromptOptions {
  hasImage?: boolean
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

function buildContextBlock(ctx: WindowContext | undefined, config: PromptsConfig): string {
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
  const title = normalizeTitle(ctx.titleRaw ?? ctx.titleSafe, config)

  return [
    renderTemplate(config.contextLines.app, { appName }),
    renderTemplate(config.contextLines.title, { title })
  ].join('\n')
}

export function buildRoastPrompt(
  ctx?: WindowContext,
  style = 'default',
  options: PromptOptions = {}
): string {
  const config = getPromptsConfig()
  const contextBlock = buildContextBlock(ctx, config)
  const imageHint = options.hasImage
    ? config.defaults.imageHintWithImage
    : config.defaults.imageHintWithoutImage

  return config.promptLines
    .map((line) =>
      renderTemplate(line, {
        style,
        imageHint,
        contextBlock
      })
    )
    .join('\n')
}
