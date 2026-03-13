import { randomBytes, randomUUID } from 'node:crypto'

export function createEventId(): string {
  if (typeof randomUUID === 'function') {
    return randomUUID()
  }
  return randomBytes(16).toString('hex')
}
