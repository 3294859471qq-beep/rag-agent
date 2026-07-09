import OpenAI from 'openai'
import { TOOL_DEFINITIONS, executeTool } from './tools'
import type { AgentEvent } from './types'

const MODEL = process.env.AI_MODEL || 'deepseek-ai/DeepSeek-V3'
const BASE_URL = process.env.AI_BASE_URL || 'https://api.siliconflow.cn/v1'
const MAX_TOOL_ROUNDS = 5

const SYSTEM_PROMPT = `你是一个智能知识助手，通过工具检索知识库来回答用户问题。

工作原则：
1. 问题涉及文档内容时，必须先调用 search_knowledge，不得直接凭记忆回答
2. 需要精确计算时调用 calculate；询问时间调用 get_datetime
3. 【防幻觉规则】回答时严格区分两类内容：
   - 来自知识库的内容：直接引用，可注明"书中提到"
   - 通用知识：明确说明"（通用知识，非来自知识库）"
4. 知识库检索结果中标注"△低"相关度的片段，不得作为主要依据
5. 不要在检索结果中未出现的内容上展开推断或补充细节
6. 若知识库无结果，如实告知，不要假装知道书中怎么写的

【公式排版规则】
- 独立展示的方程（单独一行）用 $$...$$ 包裹，例如：$$ds^2 = -dt^2 + dr^2$$
- 句子中嵌入的短公式用 $...$ 包裹，例如：其中 $r = 2GM$ 为施瓦西半径
- 禁止使用 \\( \\) 或 \\[ \\] 格式`

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
