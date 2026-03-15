import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { updateCurrentSession } from '../main/memory/context'

test('updateCurrentSession writes only the current safe session snapshot', async () => {
  const memoryRoot = await mkdtemp(path.join(os.tmpdir(), 'oculee-session-current-'))

  await updateCurrentSession(
    {
      lastApp: 'VSCode',
      lastTitleSafe: 'oculee',
      lastRoute: 'FLASH_API',
      lastEmotion: null,
      lastHasImage: false
    },
    { memoryRoot }
  )

  const raw = await readFile(path.join(memoryRoot, 'session', 'current.json'), 'utf8')
  const parsed = JSON.parse(raw) as Record<string, unknown>

  assert.equal(parsed.lastApp, 'VSCode')
  assert.equal(parsed.lastTitleSafe, 'oculee')
  assert.equal(parsed.lastRoute, 'FLASH_API')
  assert.equal(parsed.lastEmotion, null)
  assert.equal(parsed.lastHasImage, false)
  assert.equal(typeof parsed.updatedAt, 'string')
  assert.equal('titleRaw' in parsed, false)
})
