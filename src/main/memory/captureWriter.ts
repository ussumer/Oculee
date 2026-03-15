import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { getMemoryRoot } from './paths'

function getDateParts(timestamp: string): [string, string, string] {
  const isoDate = timestamp.slice(0, 10)
  const [year = '0000', month = '00', day = '00'] = isoDate.split('-')
  return [year, month, day]
}

function stripDataUriPrefix(imageBase64: string): string {
  return imageBase64.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '')
}

function buildCaptureFilename(timestamp: string): string {
  const match = timestamp.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})/
  )
  if (!match) {
    return 'capture-unknown.jpg'
  }

  const [, year, month, day, hours, minutes, seconds, milliseconds] = match
  return `${year}${month}${day}-${hours}${minutes}${seconds}-${milliseconds}.jpg`
}

export async function saveMemoryCapture(
  _eventId: string,
  timestamp: string,
  imageBase64: string
): Promise<string | undefined> {
  try {
    const [year, month, day] = getDateParts(timestamp)
    const dir = path.join(getMemoryRoot(), 'captures', year, month, day)
    const filePath = path.join(dir, buildCaptureFilename(timestamp))
    const payload = Buffer.from(stripDataUriPrefix(imageBase64), 'base64')

    await mkdir(dir, { recursive: true })
    await writeFile(filePath, payload)
    return filePath
  } catch (error: unknown) {
    console.warn('[memory] capture save failed', error)
    return undefined
  }
}
