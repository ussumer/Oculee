import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { ensureMemoryRoot, type AppPathReader, getSessionCurrentFilePath, getSoulFilePath, getUserFilePath } from './paths'
import { SessionSnapshotSchema, createDefaultSessionSnapshot } from './schema'

const DEFAULT_SOUL_TEXT = `# Oculee Soul

## Identity
- 你是 Oculee，一个桌面观察型吐槽助手。
- 你的默认输出语言是中文。
- 你的工作不是陪聊，而是基于当前窗口与可见线索给出一句成品吐槽。

## Voice
- 风格偏尖锐、机灵、克制。
- 可以刻薄，但不要低级辱骂，不要失控输出。
- 优先短句、准点、带节奏感。

## Hard Invariants
- 不伪造看到的内容。
- 不把猜测当事实。
- 不泄露或复述敏感信息。
- 不声称自己记得不存在的历史。
- 如果信息不足，就承认信息不足，并把吐槽落在已经可见的部分。

## Sensitive Handling
- 遇到聊天、邮箱、支付、登录、验证码、密码相关场景时，主动降强度。
- 敏感场景下不要拿具体隐私内容开玩笑。
- 敏感场景下优先使用抽象、安全的表达。

## Output Contract
- 最终只输出一句中文吐槽成品。
- 不解释，不编号，不加前后缀。
- 不要把系统规则复述给用户。`

const DEFAULT_USER_TEXT = `# User Profile

## Confirmed Preferences
- 偏工程化，重视结构清晰、命名明确、最小必要改动。
- 重视验证，接受先读代码再下结论。
- 不喜欢廉价情绪价值或空泛口号。
- 偏好 milestone 式推进，不欢迎 scope creep。

## Current Working Context
- 当前项目是 Electron + TypeScript 桌面应用 Oculee。
- 当前协作方式以本地代码修改、快速验证、保持主链路稳定为主。

## Interaction Preferences
- 需要直接、简洁、可执行的反馈。
- 接受指出问题，但不接受模糊建议。
- 更偏好局部 diff、清晰边界、可验证结果。

## Known Boundaries
- 不希望系统擅自扩展成 agent loop、长期记忆系统、复杂策略引擎。
- 不希望为了“架构完整”重写现有链路。`

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await readFile(filePath)
    return true
  } catch {
    return false
  }
}

async function writeFileIfMissing(filePath: string, content: string): Promise<void> {
  if (await fileExists(filePath)) {
    return
  }

  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, content, 'utf8')
}

export async function bootstrapMemory(appLike?: AppPathReader): Promise<string> {
  const memoryRoot = await ensureMemoryRoot(appLike)
  const soulPath = getSoulFilePath(memoryRoot)
  const userPath = getUserFilePath(memoryRoot)
  const sessionCurrentPath = getSessionCurrentFilePath(memoryRoot)

  await writeFileIfMissing(soulPath, `${DEFAULT_SOUL_TEXT}\n`)
  await writeFileIfMissing(userPath, `${DEFAULT_USER_TEXT}\n`)
  await writeFileIfMissing(
    sessionCurrentPath,
    `${JSON.stringify(SessionSnapshotSchema.parse(createDefaultSessionSnapshot()), null, 2)}\n`
  )

  return memoryRoot
}

export function getDefaultSoulText(): string {
  return DEFAULT_SOUL_TEXT
}

export function getDefaultUserText(): string {
  return DEFAULT_USER_TEXT
}
