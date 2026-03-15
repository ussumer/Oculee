import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { getMemoryRoot } from '../main/memory/paths'

test('getMemoryRoot uses the repository-local memory directory', () => {
  const projectRoot = path.join('C:', 'dev', 'oculee')
  const fakeApp = {
    getAppPath() {
      return projectRoot
    }
  }

  const memoryRoot = getMemoryRoot(fakeApp)

  assert.equal(memoryRoot, path.join(projectRoot, '.oculee-memory'))
  assert.notEqual(memoryRoot, path.join(projectRoot, 'memory'))
})
