import { z } from 'zod'
import type { WindowContext } from '../shared/types'
import { trimAndClampByCodePoints } from '../shared/utils/stringUtils'
import { dataLoader } from './dataLoader'

const FALLBACK_ROAST = '先深呼吸再继续'
const APP_NAME_MAX_LENGTH = 8
const TITLE_MAX_LENGTH = 6

const RoastsConfigSchema = z.object({
  maxRoastLength: z.number().int().positive(),
  fallbackRoast: z.string().min(1),
  untitledPlaceholder: z.string().min(1),
  genericRoasts: z.array(z.string().min(1)).min(1),
  templates: z.object({
    sensitiveApp: z.array(z.string().min(1)).min(1),
    app: z.array(z.string().min(1)).min(1),
    title: z.array(z.string().min(1)).min(1)
  })
})

type RoastsConfig = z.infer<typeof RoastsConfigSchema>

function getRoastsConfig(): RoastsConfig {
  return dataLoader.loadJson('roasts.json', RoastsConfigSchema)
}

function pickOne(candidates: string[], fallback: string): string {
  const index = Math.floor(Math.random() * candidates.length)
  return candidates[index] ?? fallback
}

function shorten(text: string, maxLength: number): string {
  return trimAndClampByCodePoints(text, maxLength)
}

function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => {
    return values[key] ?? ''
  })
}

function buildSensitiveRoast(ctx: WindowContext, config: RoastsConfig): string {
  if (!ctx.appName) {
    return pickOne(config.genericRoasts, config.fallbackRoast)
  }

  const appName = shorten(ctx.appName, APP_NAME_MAX_LENGTH)
  const template = pickOne(config.templates.sensitiveApp, config.fallbackRoast)
  return renderTemplate(template, { appName })
}

function buildContextRoast(ctx: WindowContext, config: RoastsConfig): string {
  if (ctx.isSensitive) {
    return buildSensitiveRoast(ctx, config)
  }

  const appName = ctx.appName ? shorten(ctx.appName, APP_NAME_MAX_LENGTH) : null
  if (appName) {
    const template = pickOne(config.templates.app, config.fallbackRoast)
    return renderTemplate(template, { appName })
  }

  const hasUsableTitle = ctx.titleSafe && ctx.titleSafe !== config.untitledPlaceholder
  const shortTitle = hasUsableTitle ? shorten(ctx.titleSafe, TITLE_MAX_LENGTH) : null
  if (shortTitle) {
    const template = pickOne(config.templates.title, config.fallbackRoast)
    return renderTemplate(template, { title: shortTitle })
  }

  return pickOne(config.genericRoasts, config.fallbackRoast)
}

export function roastLocal(ctx?: WindowContext, style?: string): string {
  try {
    void style

    const config = getRoastsConfig()
    const selected = ctx
      ? buildContextRoast(ctx, config)
      : pickOne(config.genericRoasts, config.fallbackRoast)

    return trimAndClampByCodePoints(selected, config.maxRoastLength)
  } catch {
    return FALLBACK_ROAST
  }
}
