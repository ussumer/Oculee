import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { prepareMemoryContext } from '../main/memory/context'

test('prepareMemoryContext reads soul, user, and session into prompt-ready summaries', async () => {
  const memoryRoot = await mkdtemp(path.join(os.tmpdir(), 'oculee-memory-context-'))

  await mkdir(path.join(memoryRoot, 'session'), { recursive: true })
  await writeFile(path.join(memoryRoot, 'soul.md'), '# Soul\nBe sharp.\n', 'utf8')
  await writeFile(path.join(memoryRoot, 'user.md'), '# User\nPrefers minimal diff.\n', 'utf8')
  await writeFile(
    path.join(memoryRoot, 'session', 'current.json'),
    JSON.stringify(
      {
        lastApp: 'VSCode',
        lastTitleSafe: 'oculee',
        lastRoute: 'PRIMARY',
        lastEmotion: 'smug',
        lastHasImage: true,
        updatedAt: '2026-03-13T12:00:00.000Z'
      },
      null,
      2
    ),
    'utf8'
  )

  const memoryContext = await prepareMemoryContext({ memoryRoot })

  assert.match(memoryContext.soulText, /Be sharp/)
  assert.match(memoryContext.userProfileSummary, /Prefers minimal diff/)
  assert.match(memoryContext.sessionSummary, /Last app: VSCode/)
  assert.match(memoryContext.sessionSummary, /Last route: PRIMARY/)
  assert.match(memoryContext.sessionSummary, /Last emotion: smug/)
})
