import { tool } from 'ai'
import { z } from 'zod'
import { getOverlayWindow } from '../windowManager'

const EmotionSchema = z.enum(['happy', 'sad', 'angry', 'smug'])
const ChangeEmotionInputSchema = z.object({
  emotion: EmotionSchema
})

function isDebugEnabled(): boolean {
  const value = process.env.DEBUG_LLM?.trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes'
}

export const banterTools = {
  changeEmotion: tool({
    description:
      '当你准备输出带明显情绪倾向的吐槽时调用此工具改变 Live2D 表情。示例: 挖苦/得意->smug, 开心夸张->happy, 不爽吐槽->angry, 无奈沮丧->sad。若文本情绪中性可不调用。',
    inputSchema: ChangeEmotionInputSchema,
    async execute({ emotion }: z.infer<typeof ChangeEmotionInputSchema>) {
      const overlayWindow = getOverlayWindow()
      const hasOverlay = overlayWindow !== null && !overlayWindow.isDestroyed()
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send('live2d:change-emotion', emotion)
      }
      if (isDebugEnabled()) {
        console.log('[llm:function-call:execute]', {
          toolName: 'changeEmotion',
          emotion,
          hasOverlay
        })
      }
      return `Live2D emotion changed to ${emotion}`
    }
  })
}
