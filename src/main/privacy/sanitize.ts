import type { WindowContext } from '../../shared/types'

export type SanitizedWindowContext = {
  appName: string
  titleSafe: string
  isSensitive: boolean
  allowFutureMemory: boolean
}

const UNKNOWN_APP_NAME = '未知应用'
const UNKNOWN_TITLE = '未命名窗口'
const SENSITIVE_TITLE = '某个敏感窗口'

const SENSITIVE_APP_PATTERNS = [
  '1password',
  'bitwarden',
  'keepass',
  'lastpass',
  'dashlane',
  'wechat',
  'qq',
  'telegram',
  'discord',
  'slack',
  'teams',
  'outlook',
  'mail',
  'gmail',
  'foxmail'
]

const SENSITIVE_TITLE_PATTERNS = [
  'password',
  'login',
  'sign in',
  'verify',
  'verification',
  'otp',
  'bank',
  'payment',
  'wallet',
  'email',
  '邮箱',
  '登录',
  '验证码',
  '验证',
  '银行',
  '支付'
]

function normalizeText(value: string | null | undefined, fallback: string): string {
  const normalized = value?.trim()
  return normalized || fallback
}

function normalizeSearchText(value: string | null | undefined): string {
  return value?.trim().toLowerCase() || ''
}

function includesPattern(text: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => text.includes(pattern))
}

function isSensitiveWindow(ctx: WindowContext | undefined): boolean {
  if (!ctx) {
    return false
  }
  if (ctx.isSensitive) {
    return true
  }

  const appName = normalizeSearchText(ctx.appName)
  const title = normalizeSearchText(ctx.titleRaw ?? ctx.titleSafe)

  return includesPattern(appName, SENSITIVE_APP_PATTERNS) || includesPattern(title, SENSITIVE_TITLE_PATTERNS)
}

export function sanitizeWindowContext(ctx?: WindowContext): SanitizedWindowContext {
  const appName = normalizeText(ctx?.appName, UNKNOWN_APP_NAME)
  const isSensitive = isSensitiveWindow(ctx)

  return {
    appName,
    titleSafe: isSensitive ? SENSITIVE_TITLE : normalizeText(ctx?.titleSafe, UNKNOWN_TITLE),
    isSensitive,
    allowFutureMemory: !isSensitive
  }
}
