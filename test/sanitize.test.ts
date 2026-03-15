import test from 'node:test'
import assert from 'node:assert/strict'
import type { WindowContext } from '../shared/types'
import { sanitizeWindowContext } from '../main/privacy/sanitize'

test('sensitive windows are marked and future memory is disabled', () => {
  const ctx: WindowContext = {
    id: 1,
    appName: 'WeChat',
    titleRaw: '验证码登录',
    titleSafe: '验证码登录',
    bounds: null,
    isSensitive: false
  }

  const sanitized = sanitizeWindowContext(ctx)

  assert.equal(sanitized.isSensitive, true)
  assert.equal(sanitized.allowFutureMemory, false)
  assert.equal(sanitized.titleSafe, '某个敏感窗口')
})
