const BLACKLISTED_PROCESS_NAMES = [
  '1password',
  'bitwarden',
  'keepass',
  'wechat',
  'telegram',
  'qq',
  'chrome'
]

const ENABLE_BLACKLIST = false

const BLACKLISTED_TITLE_KEYWORDS = [
  'password',
  '验证码',
  'otp',
  '支付',
  'wallet',
  '无痕',
  'incognito',
  'private',
  'bank',
  'login'
]

function normalize(input: string | null): string {
  if (!input) {
    return ''
  }
  return input.trim().toLowerCase()
}

function normalizeProcessName(input: string | null): string {
  const normalized = normalize(input)
  if (normalized.endsWith('.exe')) {
    return normalized.slice(0, -4)
  }
  return normalized
}

export function isBlacklisted(appName: string | null, title: string | null): boolean {
  if (!ENABLE_BLACKLIST) {
    return false
  }

  const normalizedAppName = normalizeProcessName(appName)
  const normalizedTitle = normalize(title)

  if (
    normalizedAppName &&
    BLACKLISTED_PROCESS_NAMES.some((rule) => normalizedAppName.includes(rule.toLowerCase()))
  ) {
    return true
  }

  if (
    normalizedTitle &&
    BLACKLISTED_TITLE_KEYWORDS.some((rule) => normalizedTitle.includes(rule.toLowerCase()))
  ) {
    return true
  }

  return false
}
