import OpenAI from 'openai'
import type { AgentEvent } from './types'

// Qwen2.5-VL: vision + Chinese + math formula recognition
const VISION_MODEL = process.env.VISION_MODEL || 'Qwen/Qwen2.5-VL-72B-Instruct'
const BASE_URL = process.env.AI_BASE_URL || 'https://api.siliconflow.cn/v1'

function getClient(): OpenAI {
  const apiKey = process.env.AI_API_KEY
  if (!apiKey) throw new Error('AI_API_KEY 环境变量未配置')
  return new OpenAI({ apiKey, baseURL: BASE_URL, timeout: 60000, maxRetries: 1 })
}

export function runVisionAgent(
  messages: Array<{ role: 'user' | 'assistant'; content: string; image?: string }>,
  systemHint = '你是一个智能学习助手，擅长解读数学公式、物理公式和教材内容。用中文回答。'
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AgentEvent) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))

      try {
        const client = getClient()

        // Build OpenAI-format messages with vision content
        const apiMessages: OpenAI.ChatCompletionMessageParam[] = [
          { role: 'system', content: systemHint },
          ...messages.map(m => {
            if (m.role === 'assistant' || !m.image) {
              return { role: m.role, content: m.content } as OpenAI.ChatCompletionMessageParam
            }
            // User message with image
            const parts: OpenAI.ChatCompletionContentPart[] = []
            if (m.content) parts.push({ type: 'text', text: m.content })
            parts.push({ type: 'image_url', image_url: { url: m.image } })
            return { role: 'user' as const, content: parts }
          }),
        ]

        const stream = await client.chat.completions.create({
          model: VISION_MODEL,
          messages: apiMessages,
          stream: true,
          max_tokens: 2048,
        })

        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content
          if (delta) send({ type: 'text', content: delta })
        }

        send({ type: 'done' })
        controller.close()
      } catch (err) {
        const msg = err instanceof Error ? err.message : '视觉模型调用失败'
        console.error('[VisionAgent Error]', err)
        send({ type: 'error', content: msg })
        controller.close()
      }
    },
  })
}
