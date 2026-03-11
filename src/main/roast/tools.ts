import { tool } from 'ai'
import { z } from 'zod'

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
      if (isDebugEnabled()) {
        console.log('[llm:function-call:execute]', {
          toolName: 'changeEmotion',
          emotion
        })
      }
      return `[Emotion determined as ${emotion}]`
    }
  })
}
