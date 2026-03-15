import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { bootstrapMemory } from '../main/memory/bootstrap'

test('bootstrapMemory creates canonical files without overwriting soul or user', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'oculee-memory-bootstrap-'))
  const memoryRoot = path.join(projectRoot, '.oculee-memory')
  const soulPath = path.join(memoryRoot, 'soul.md')
  const userPath = path.join(memoryRoot, 'user.md')
  await mkdir(memoryRoot, { recursive: true })

  await writeFile(soulPath, '# Custom Soul\nkeep-me\n', 'utf8')
  await writeFile(userPath, '# Custom User\nkeep-me\n', 'utf8')

  const fakeApp = {
    getAppPath() {
      return projectRoot
    }
  }

  const bootstrappedRoot = await bootstrapMemory(fakeApp)

  assert.equal(bootstrappedRoot, memoryRoot)
  assert.equal(await readFile(path.join(bootstrappedRoot, 'soul.md'), 'utf8'), '# Custom Soul\nkeep-me\n')
  assert.equal(await readFile(path.join(bootstrappedRoot, 'user.md'), 'utf8'), '# Custom User\nkeep-me\n')
  assert.ok(await readFile(path.join(bootstrappedRoot, 'session', 'current.json'), 'utf8'))
})
