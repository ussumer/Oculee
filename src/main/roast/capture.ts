import { nativeImage, screen } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import type { WindowBounds } from '../../shared/types'
import { dataLoader } from '../dataLoader'
import type { LlmImagePart } from './llmClient'

const DEFAULT_MAX_SIDE = 960
const DEFAULT_MAX_BYTES = 180_000
const MIN_SIDE = 320
const DEFAULT_CODEC = 'jpeg'
const DEFAULT_JPEG_QUALITY = 72
const DEFAULT_DEBUG_CAPTURE_DIR = '.debug/roast-captures'

type ScreenshotFn = (options?: Record<string, unknown>) => Promise<Buffer>
type ImageCodec = 'png' | 'jpeg'
type CaptureMode = 'foreground' | 'fullscreen'

const CaptureConfigSchema = z
  .object({
    captureMode: z.enum(['foreground', 'fullscreen']).catch('foreground'),
    fallbackToFullscreen: z.boolean().catch(true)
  })
  .catch({
    captureMode: 'foreground',
    fallbackToFullscreen: true
  })

type CaptureConfig = z.infer<typeof CaptureConfigSchema>

function getCaptureConfig(): CaptureConfig {
  return dataLoader.loadJson('capture.json', CaptureConfigSchema)
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback
  }
  const normalized = value.trim().toLowerCase()
  if (normalized === '1' || normalized === 'true' || normalized === 'yes') {
    return true
  }
  if (normalized === '0' || normalized === 'false' || normalized === 'no') {
    return false
  }
  return fallback
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback
  }
  return Math.floor(parsed)
}

function isMultimodalEnabled(): boolean {
  return parseBoolean(process.env.MULTIMODAL_ENABLED, true)
}

function isCaptureDumpEnabled(): boolean {
  return parseBoolean(process.env.MULTIMODAL_DEBUG_DUMP, false)
}

function getMaxSide(): number {
  return parsePositiveInt(process.env.MULTIMODAL_IMAGE_MAX_SIDE, 720)
}

function getMaxBytes(): number {
  return parsePositiveInt(process.env.MULTIMODAL_IMAGE_MAX_BYTES, DEFAULT_MAX_BYTES)
}

function getImageCodec(): ImageCodec {
  const raw = process.env.MULTIMODAL_IMAGE_CODEC?.trim().toLowerCase() || DEFAULT_CODEC
  if (raw === 'png') {
    return 'png'
  }
  return 'jpeg'
}

function getJpegQuality(): number {
  const quality = parsePositiveInt(process.env.MULTIMODAL_JPEG_QUALITY, DEFAULT_JPEG_QUALITY)
  return Math.min(100, Math.max(30, quality))
}

function getCaptureMode(config: CaptureConfig): CaptureMode {
  const envMode = process.env.MULTIMODAL_CAPTURE_MODE?.trim().toLowerCase()
  if (envMode === 'foreground') {
    return 'foreground'
  }
  if (envMode === 'fullscreen') {
    return 'fullscreen'
  }
  return config.captureMode
}

function getDebugCaptureDir(): string {
  const custom = process.env.MULTIMODAL_DEBUG_DUMP_DIR?.trim()
  return custom ? resolve(custom) : resolve(process.cwd(), DEFAULT_DEBUG_CAPTURE_DIR)
}

function buildDebugCaptureFilename(codec: ImageCodec): string {
  const now = new Date()
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '-',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
    '-',
    String(now.getMilliseconds()).padStart(3, '0')
  ].join('')
  const ext = codec === 'png' ? 'png' : 'jpg'
  return `capture-${stamp}.${ext}`
}

async function dumpCaptureForDebug(buffer: Buffer, codec: ImageCodec): Promise<void> {
  const dir = getDebugCaptureDir()
  const file = join(dir, buildDebugCaptureFilename(codec))
  await mkdir(dir, { recursive: true })
  await writeFile(file, buffer)
  if (parseBoolean(process.env.DEBUG_LLM, false)) {
    console.log('[capture] saved debug image', file)
  }
}

async function loadScreenshotFn(): Promise<ScreenshotFn> {
  const moduleValue = (await import('screenshot-desktop')) as unknown
  const moduleAsRecord = moduleValue as Record<string, unknown>

  if (typeof moduleAsRecord.default === 'function') {
    return moduleAsRecord.default as ScreenshotFn
  }
  if (typeof moduleValue === 'function') {
    return moduleValue as ScreenshotFn
  }

  throw new Error('Invalid screenshot-desktop module export')
}

async function captureScreenBuffer(screenshot: ScreenshotFn, screenId?: string): Promise<Buffer> {
  if (screenId) {
    try {
      return await screenshot({ format: 'png', screen: screenId })
    } catch {
      return screenshot({ format: 'png' })
    }
  }

  return screenshot({ format: 'png' })
}

function clampDimensions(width: number, height: number, maxSide: number): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= maxSide) {
    return { width, height }
  }

  const ratio = maxSide / longest
  return {
    width: Math.max(MIN_SIDE, Math.floor(width * ratio)),
    height: Math.max(MIN_SIDE, Math.floor(height * ratio))
  }
}

function encodeImage(image: Electron.NativeImage, codec: ImageCodec, jpegQuality: number): Buffer {
  if (codec === 'png') {
    return image.toPNG()
  }
  return image.toJPEG(jpegQuality)
}

function optimizeImage(
  buffer: Buffer,
  maxSide: number,
  maxBytes: number,
  codec: ImageCodec,
  jpegQuality: number
): Buffer {
  let image = nativeImage.createFromBuffer(buffer)
  if (image.isEmpty()) {
    return buffer
  }

  let size = image.getSize()
  const clamped = clampDimensions(size.width, size.height, maxSide)
  if (clamped.width !== size.width || clamped.height !== size.height) {
    image = image.resize({ width: clamped.width, height: clamped.height, quality: 'good' })
    size = image.getSize()
  }

  let output = encodeImage(image, codec, jpegQuality)
  if (output.length <= maxBytes) {
    return output
  }

  for (let i = 0; i < 4 && output.length > maxBytes; i += 1) {
    const current = image.getSize()
    const ratio = Math.sqrt(maxBytes / output.length) * 0.95
    const nextWidth = Math.max(MIN_SIDE, Math.floor(current.width * ratio))
    const nextHeight = Math.max(MIN_SIDE, Math.floor(current.height * ratio))

    if (nextWidth >= current.width && nextHeight >= current.height) {
      break
    }

    image = image.resize({ width: nextWidth, height: nextHeight, quality: 'good' })
    output = encodeImage(image, codec, jpegQuality)
  }

  return output
}

function cropForegroundWindow(source: Buffer, bounds: WindowBounds): Buffer | undefined {
  const image = nativeImage.createFromBuffer(source)
  if (image.isEmpty()) {
    return undefined
  }

  const imageSize = image.getSize()
  if (imageSize.width <= 0 || imageSize.height <= 0) {
    return undefined
  }

  const center = {
    x: Math.round(bounds.x + bounds.width / 2),
    y: Math.round(bounds.y + bounds.height / 2)
  }

  const display = screen.getDisplayNearestPoint(center)
  const displayBounds = display.bounds

  const scaleX = imageSize.width / Math.max(1, displayBounds.width)
  const scaleY = imageSize.height / Math.max(1, displayBounds.height)

  const rawX = Math.floor((bounds.x - displayBounds.x) * scaleX)
  const rawY = Math.floor((bounds.y - displayBounds.y) * scaleY)
  const rawWidth = Math.ceil(bounds.width * scaleX)
  const rawHeight = Math.ceil(bounds.height * scaleY)

  const x = Math.max(0, rawX)
  const y = Math.max(0, rawY)
  const width = Math.min(imageSize.width - x, rawWidth)
  const height = Math.min(imageSize.height - y, rawHeight)

  if (width <= 0 || height <= 0) {
    return undefined
  }

  try {
    return image.crop({ x, y, width, height }).toPNG()
  } catch {
    return undefined
  }
}

export async function captureRoastImage(windowBounds?: WindowBounds | null): Promise<LlmImagePart | undefined> {
  if (!isMultimodalEnabled()) {
    return undefined
  }

  try {
    const config = getCaptureConfig()
    const captureMode = getCaptureMode(config)
    const screenshot = await loadScreenshotFn()

    const envScreenId = process.env.MULTIMODAL_SCREEN_ID?.trim() || undefined
    const sourceBuffer = await captureScreenBuffer(screenshot, envScreenId)

    if (!Buffer.isBuffer(sourceBuffer) || sourceBuffer.length === 0) {
      return undefined
    }

    const foregroundBuffer =
      captureMode === 'foreground' && windowBounds
        ? cropForegroundWindow(sourceBuffer, windowBounds)
        : undefined

    const selectedBuffer = foregroundBuffer ?? (config.fallbackToFullscreen ? sourceBuffer : undefined)
    if (!selectedBuffer) {
      return undefined
    }

    const codec = getImageCodec()
    const optimized = optimizeImage(
      selectedBuffer,
      getMaxSide(),
      getMaxBytes(),
      codec,
      getJpegQuality()
    )

    if (isCaptureDumpEnabled()) {
      try {
        await dumpCaptureForDebug(optimized, codec)
      } catch {
        // Ignore debug dump errors to avoid blocking roast flow.
      }
    }

    return {
      mimeType: codec === 'png' ? 'image/png' : 'image/jpeg',
      dataBase64: optimized.toString('base64')
    }
  } catch {
    return undefined
  }
}
