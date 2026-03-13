import test from 'node:test'
import assert from 'node:assert/strict'
import type { MemoryContext } from '../main/memory/schema'
import type { SanitizedWindowContext } from '../main/privacy/sanitize'
import { buildRoastPrompt } from '../main/roast/prompt'

test('prompt builder only uses titleSafe and never raw title', () => {
  const memoryContext: MemoryContext = {
    soulText: '# Soul\nSpeak with restraint.',
    userProfileSummary: '# User\nPrefers minimal diff.',
    sessionSummary: 'Last route: PRIMARY'
  }
  const ctx = {
    appName: 'Mail',
    titleSafe: '某个敏感窗口',
    isSensitive: true,
    allowFutureMemory: false,
    titleRaw: 'bank-otp-secret'
  } as SanitizedWindowContext & { titleRaw: string }

  const prompt = buildRoastPrompt(ctx, 'default', { hasImage: false, memoryContext })

  assert.ok(prompt.indexOf('Soul:') < prompt.indexOf('User:'))
  assert.ok(prompt.indexOf('User:') < prompt.indexOf('Session:'))
  assert.ok(prompt.indexOf('Session:') < prompt.indexOf('上下文:'))
  assert.match(prompt, /某个敏感窗口/)
  assert.doesNotMatch(prompt, /bank-otp-secret/)
})
