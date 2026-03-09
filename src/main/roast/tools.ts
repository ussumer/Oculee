import { tool } from 'ai'
import { z } from 'zod'
import { getOverlayWindow } from '../windowManager'
import { AVATAR_CHANGE_CHANNEL } from '../../shared/ipc'

const EmotionSchema = z.enum(['idle', 'happy', 'flustered', 'smug', 'sad'])
const ChangeEmotionInputSchema = z.object({
  emotion: EmotionSchema.describe('The target emotion to display.')
})

function isDebugEnabled(): boolean {
  const value = process.env.DEBUG_LLM?.trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes'
}

export const banterTools = {
  changeEmotion: tool({
    description: 'Change the avatar emotion based on the tone of the roast.',
    inputSchema: ChangeEmotionInputSchema,
    async execute({ emotion }: z.infer<typeof ChangeEmotionInputSchema>) {
      const overlayWindow = getOverlayWindow()
      const hasOverlay = overlayWindow !== null && !overlayWindow.isDestroyed()
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send(AVATAR_CHANGE_CHANNEL, emotion)
      }
      if (isDebugEnabled()) {
        console.log('[llm:function-call:execute]', {
          toolName: 'changeEmotion',
          emotion,
          hasOverlay
        })
      }
      return `[Emotion changed to ${emotion}]`
    }
  })
}
