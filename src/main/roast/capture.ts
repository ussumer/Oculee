import { desktopCapturer } from 'electron'
import { z } from 'zod'
import type { WindowContext } from '../../shared/types'
import { dataLoader } from '../dataLoader'
import type { LlmImagePart } from './llmClient'

const DEFAULT_MAX_BYTES = 180_000
const DEFAULT_MAX_SIDE = 960
const MIN_SIDE = 320
const DEFAULT_CODEC = 'jpeg'
const DEFAULT_JPEG_QUALITY = 72
const DEFAULT_CAPTURE_MODE: CaptureMode = 'foreground'
const DEFAULT_THUMBNAIL_SIZE = { width: DEFAULT_MAX_SIDE, height: DEFAULT_MAX_SIDE }

type ImageCodec = 'png' | 'jpeg'
type CaptureMode = 'foreground' | 'fullscreen'

const CaptureConfigSchema = z
  .object({
    captureMode: z.enum(['foreground', 'fullscreen']).catch(DEFAULT_CAPTURE_MODE)
  })
  .catch({
    captureMode: DEFAULT_CAPTURE_MODE
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

function isDebugEnabled(): boolean {
  return parseBoolean(process.env.DEBUG_LLM, false)
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

function toAsciiSafeText(input: string): string {
  let output = ''
  for (const char of input) {
    const code = char.codePointAt(0)
    if (code === undefined) {
      continue
    }
    if (code >= 0x20 && code <= 0x7e) {
      output += char
      continue
    }
    if (code <= 0xffff) {
      output += `\\u${code.toString(16).padStart(4, '0')}`
      continue
    }
    output += `\\u{${code.toString(16)}}`
  }
  return output
}

async function findWindowSource(windowId: number): Promise<Electron.DesktopCapturerSource | undefined> {
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: getThumbnailSize()
  })

  if (isDebugEnabled()) {
    console.log(
      '[capture] window sources',
      sources.map((source) => ({
        id: source.id,
        name: toAsciiSafeText(source.name)
      }))
    )
  }

  const targetIdStr = String(windowId)
  return sources.find(
    (source) => source.id.includes(`:${targetIdStr}:`) || source.id.endsWith(`:${targetIdStr}`)
  )
}

async function findScreenSource(): Promise<Electron.DesktopCapturerSource | undefined> {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: getThumbnailSize()
  })
  return sources[0]
}

function getThumbnailSize(): { width: number; height: number } {
  const side = Math.max(MIN_SIDE, getMaxSide())
  return {
    width: Math.min(DEFAULT_THUMBNAIL_SIZE.width, side),
    height: Math.min(DEFAULT_THUMBNAIL_SIZE.height, side)
  }
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
  input: Electron.NativeImage,
  maxSide: number,
  maxBytes: number,
  codec: ImageCodec,
  jpegQuality: number
): Buffer {
  let image = input
  if (image.isEmpty()) {
    return Buffer.alloc(0)
  }

  let size = image.getSize()
  const clamped = clampDimensions(size.width, size.height, maxSide)
  if (clamped.width !== size.width || clamped.height !== size.height) {
    image = image.resize({ width: clamped.width, height: clamped.height, quality: 'good' })
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

export async function captureRoastImage(ctx?: WindowContext): Promise<LlmImagePart | undefined> {
  if (!isMultimodalEnabled()) {
    return undefined
  }

  try {
    const config = getCaptureConfig()
    const captureMode = getCaptureMode(config)

    let selectedImage: Electron.NativeImage | undefined

    if (captureMode === 'foreground' && typeof ctx?.id === 'number') {
      const source = await findWindowSource(ctx.id)
      if (source && !source.thumbnail.isEmpty()) {
        selectedImage = source.thumbnail
      }
    }

    if (!selectedImage || selectedImage.isEmpty() || captureMode === 'fullscreen') {
      const screenSource = await findScreenSource()
      if (!screenSource || screenSource.thumbnail.isEmpty()) {
        return undefined
      }
      selectedImage = screenSource.thumbnail
    }

    if (!selectedImage || selectedImage.isEmpty()) {
      return undefined
    }

    const codec = getImageCodec()
    const optimized = optimizeImage(
      selectedImage,
      getMaxSide(),
      getMaxBytes(),
      codec,
      getJpegQuality()
    )

    if (optimized.length === 0) {
      return undefined
    }

    return {
      mimeType: codec === 'png' ? 'image/png' : 'image/jpeg',
      dataBase64: optimized.toString('base64')
    }
  } catch {
    return undefined
  }
}
