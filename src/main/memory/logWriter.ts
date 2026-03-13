import { appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { getLogsRootPath } from './paths'
import { InteractionEventSchema, type InteractionEvent } from './schema'

function getDateParts(timestamp: string): [string, string, string] {
  const isoDate = timestamp.slice(0, 10)
  const [year = '0000', month = '00', day = '00'] = isoDate.split('-')
  return [year, month, day]
}

function getLogFilePath(event: InteractionEvent, memoryRoot?: string): string {
  const [year, month, day] = getDateParts(event.timestamp)
  return path.join(getLogsRootPath(memoryRoot), year, month, `${day}.jsonl`)
}

export async function appendInteractionLog(event: InteractionEvent): Promise<void>
export async function appendInteractionLog(event: InteractionEvent, memoryRoot: string): Promise<void>
export async function appendInteractionLog(event: InteractionEvent, memoryRoot?: string): Promise<void> {
  try {
    const parsedEvent = InteractionEventSchema.parse(event)
    const filePath = getLogFilePath(parsedEvent, memoryRoot)
    await mkdir(path.dirname(filePath), { recursive: true })
    await appendFile(filePath, `${JSON.stringify(parsedEvent)}\n`, 'utf8')
  } catch (error: unknown) {
    console.warn('[memory] interaction log append failed', error)
  }
}
