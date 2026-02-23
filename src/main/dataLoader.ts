import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ZodType } from 'zod'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '../..')
const ASSETS_DIR = path.join(PROJECT_ROOT, 'src/main/assets')

class DataLoader {
  private readonly cache = new Map<string, unknown>()

  loadJson<T>(fileName: string, schema: ZodType<T>): T {
    const absolutePath = path.join(ASSETS_DIR, fileName)
    const cached = this.cache.get(absolutePath)
    if (cached !== undefined) {
      return cached as T
    }

    const raw = fs.readFileSync(absolutePath, 'utf8')
    const parsed = schema.parse(JSON.parse(raw))
    this.cache.set(absolutePath, parsed)
    return parsed
  }
}

export const dataLoader = new DataLoader()
