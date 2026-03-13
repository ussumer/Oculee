import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { appendInteractionLog } from '../main/memory/logWriter'
import type { InteractionEvent } from '../main/memory/schema'

test('appendInteractionLog writes one JSON line into the dated log file', async () => {
  const memoryRoot = await mkdtemp(path.join(os.tmpdir(), 'oculee-log-writer-'))
  const event: InteractionEvent = {
    id: 'evt_test_1',
    timestamp: '2026-03-13T12:00:00.000Z',
    source: { kind: 'roast' },
    appName: 'VSCode',
    titleSafe: 'oculee',
    route: 'primary',
    hasImage: true,
    usedFallback: false,
    blockedByPrivacy: false,
    roastText: '这窗口今天还算争气。',
    sessionSnapshot: {
      lastApp: 'VSCode',
      lastRoute: 'PRIMARY',
      lastEmotion: 'smug'
    }
  }

  await appendInteractionLog(event, memoryRoot)

  const logPath = path.join(memoryRoot, 'logs', '2026', '03', '13.jsonl')
  const content = await readFile(logPath, 'utf8')
  const [line] = content.trim().split('\n')
  const parsed = JSON.parse(line) as InteractionEvent

  assert.equal(parsed.id, 'evt_test_1')
  assert.equal(parsed.route, 'primary')
  assert.equal(parsed.roastText, '这窗口今天还算争气。')
  assert.equal(parsed.hasImage, true)
})
