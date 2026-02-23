import fs from 'node:fs'
import path from 'node:path'

function parseDotenv(content: string): Record<string, string> {
  const result: Record<string, string> = {}
  const lines = content.split(/\r?\n/)

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) {
      continue
    }

    const separatorIndex = line.indexOf('=')
    if (separatorIndex <= 0) {
      continue
    }

    const key = line.slice(0, separatorIndex).trim()
    let value = line.slice(separatorIndex + 1).trim()

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    if (!key) {
      continue
    }

    result[key] = value
  }

  return result
}

function loadFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) {
    return {}
  }

  const content = fs.readFileSync(filePath, 'utf8')
  return parseDotenv(content)
}

export function loadEnvFiles(projectRoot: string): void {
  const protectedKeys = new Set(Object.keys(process.env))
  const defaultEnv = loadFile(path.join(projectRoot, '.env'))
  const localEnv = loadFile(path.join(projectRoot, '.env.local'))

  for (const [key, value] of Object.entries(defaultEnv)) {
    if (!protectedKeys.has(key)) {
      process.env[key] = value
    }
  }

  for (const [key, value] of Object.entries(localEnv)) {
    if (!protectedKeys.has(key)) {
      process.env[key] = value
    }
  }
}
