import OpenAI from 'openai'
import { TOOL_DEFINITIONS, executeTool } from './tools'
import type { AgentEvent } from './types'

const MODEL = process.env.AI_MODEL || 'deepseek-ai/DeepSeek-V3'
const BASE_URL = process.env.AI_BASE_URL || 'https://api.siliconflow.cn/v1'
const MAX_TOOL_ROUNDS = 5

const SYSTEM_PROMPT = `你是一个智能知识助手，能够通过工具检索知识库、进行精确数学计算来回答用户问题。

工作原则：
1. 如果问题涉及文档知识内容，优先调用 search_knowledge 搜索知识库
2. 如果需要精确数值计算，调用 calculate（不要口算估算）
3. 如果用户问当前时间/日期，调用 get_datetime
4. 综合工具结果，给出清晰、完整、有条理的回答
5. 如知识库没有相关内容，如实告知并基于自身知识尽力回答
6. 回答简洁精炼，重点突出`

function getClient(): OpenAI {
  const apiKey = process.env.AI_API_KEY
  if (!apiKey) throw new Error('AI_API_KEY 环境变量未配置')
  return new OpenAI({ apiKey, baseURL: BASE_URL, timeout: 60000, maxRetries: 1 })
}

export function runAgent(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AgentEvent) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))

      try {
        const client = getClient()
        const apiMessages: OpenAI.ChatCompletionMessageParam[] = [
          { role: 'system', content: SYSTEM_PROMPT },
          ...messages,
        ]

        let toolsWereCalled = false

        // Tool calling loop (non-streaming)
        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          const response = await client.chat.completions.create({
            model: MODEL,
            messages: apiMessages,
            tools: TOOL_DEFINITIONS,
            tool_choice: 'auto',
            max_tokens: 2048,
          })

          const msg = response.choices[0].message

          // No tool calls → end the loop
          if (!msg.tool_calls?.length) {
            if (!toolsWereCalled && msg.content) {
              // No tools used at all — just stream this direct response
              for (const ch of msg.content) {
                send({ type: 'text', content: ch })
              }
            }
            // If tools were used, we'll stream the final answer below
            break
          }

          toolsWereCalled = true
          apiMessages.push(msg)

          for (const toolCall of msg.tool_calls) {
            const toolName = toolCall.function.name
            let toolArgs: Record<string, unknown> = {}
            try {
              toolArgs = JSON.parse(toolCall.function.arguments || '{}')
            } catch {
              /* ignore parse errors */
            }

            send({ type: 'tool_start', tool: toolName, input: toolArgs })
            const result = await executeTool(toolName, toolArgs)
            send({ type: 'tool_end', tool: toolName, output: result })

            apiMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: result,
            })
          }
        }

        // If tools were called, stream the final synthesized answer
        if (toolsWereCalled) {
          const stream = await client.chat.completions.create({
            model: MODEL,
            messages: apiMessages,
            stream: true,
            max_tokens: 2048,
          })

          for await (const chunk of stream) {
            const text = chunk.choices[0]?.delta?.content ?? ''
            if (text) send({ type: 'text', content: text })
          }
        }

        send({ type: 'done' })
        controller.close()
      } catch (err) {
        const msg = err instanceof Error ? err.message : '未知错误'
        console.error('[Agent Error]', err)
        send({ type: 'error', content: msg })
        controller.close()
      }
    },
  })
}
