import OpenAI from 'openai'
import { TOOL_DEFINITIONS, executeTool } from './tools'
import type { AgentEvent } from './types'

const MODEL = process.env.AI_MODEL || 'deepseek-ai/DeepSeek-V3'
const BASE_URL = process.env.AI_BASE_URL || 'https://api.siliconflow.cn/v1'
const MAX_EXECUTOR_ROUNDS = 3

function getClient(): OpenAI {
  const apiKey = process.env.AI_API_KEY
  if (!apiKey) throw new Error('AI_API_KEY 环境变量未配置')
  return new OpenAI({ apiKey, baseURL: BASE_URL, timeout: 60000, maxRetries: 1 })
}

export function runMultiAgent(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AgentEvent) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))

      try {
        const client = getClient()
        const userQuestion = messages.filter(m => m.role === 'user').pop()?.content ?? ''
        const history = messages.slice(0, -1)
        const historyContext =
          history.length > 0
            ? '\n\n对话历史:\n' +
              history.map(m => `${m.role === 'user' ? '用户' : '助手'}: ${m.content}`).join('\n')
            : ''

        // ── Phase 1: Planner ────────────────────────────────────────────
        send({ type: 'agent_start', agent: 'planner', description: '分析问题，制定执行计划' })

        const plannerResp = await client.chat.completions.create({
          model: MODEL,
          messages: [
            {
              role: 'system',
              content: `你是规划Agent。分析用户问题，拆解为2-4个具体可执行的子任务。

可用工具：search_knowledge（搜索知识库）、calculate（数学计算）、get_datetime（获取时间）

原则：简单问题1-2个任务，复杂问题3-4个。每个任务要明确可操作。
只输出 JSON，不要其他文字：
{"tasks":[{"id":"t1","description":"任务描述"},{"id":"t2","description":"任务描述"}]}`,
            },
            { role: 'user', content: `用户问题: ${userQuestion}${historyContext}` },
          ],
          temperature: 0.2,
          max_tokens: 512,
        })

        let plan: Array<{ id: string; description: string }> = []
        try {
          const raw = plannerResp.choices[0].message.content ?? '{}'
          const jsonMatch = raw.match(/\{[\s\S]*\}/)
          const parsed = JSON.parse(jsonMatch?.[0] ?? raw)
          plan = Array.isArray(parsed.tasks) ? parsed.tasks : []
        } catch {
          /* fallthrough */
        }
        if (plan.length === 0) {
          plan = [{ id: 't1', description: '搜索知识库并回答用户问题' }]
        }

        send({ type: 'plan', tasks: plan })

        // ── Phase 2: Executor ───────────────────────────────────────────
        send({ type: 'agent_start', agent: 'executor', description: '按计划逐步执行，调用工具' })

        const results: Array<{ taskId: string; description: string; result: string }> = []

        for (const task of plan) {
          send({ type: 'task_start', taskId: task.id, description: task.description })

          const priorContext =
            results.length > 0
              ? '\n\n前置任务结果:\n' +
                results.map(r => `[${r.taskId}] ${r.description}\n→ ${r.result}`).join('\n\n')
              : ''

          const execMessages: OpenAI.ChatCompletionMessageParam[] = [
            {
              role: 'system',
              content:
                '你是执行Agent。专注完成分配的具体任务，按需调用工具。完成后给出简洁结果（不超过200字）。',
            },
            {
              role: 'user',
              content: `原始问题: ${userQuestion}${historyContext}${priorContext}\n\n当前任务: ${task.description}`,
            },
          ]

          let taskResult = '（无结果）'

          for (let round = 0; round < MAX_EXECUTOR_ROUNDS; round++) {
            const execResp = await client.chat.completions.create({
              model: MODEL,
              messages: execMessages,
              tools: TOOL_DEFINITIONS,
              tool_choice: 'auto',
              max_tokens: 1024,
            })

            const msg = execResp.choices[0].message

            if (!msg.tool_calls?.length) {
              taskResult = msg.content ?? '任务完成'
              break
            }

            execMessages.push(msg)
            const toolResults: OpenAI.ChatCompletionToolMessageParam[] = []

            for (const tc of msg.tool_calls) {
              let args: Record<string, unknown> = {}
              try {
                args = JSON.parse(tc.function.arguments || '{}')
              } catch { /* */ }

              send({ type: 'tool_start', tool: tc.function.name, input: args })
              const output = await executeTool(tc.function.name, args)
              send({ type: 'tool_end', tool: tc.function.name, output })
              toolResults.push({ role: 'tool', tool_call_id: tc.id, content: output })
            }

            execMessages.push(...toolResults)
          }

          results.push({ taskId: task.id, description: task.description, result: taskResult })
          send({ type: 'task_result', taskId: task.id, result: taskResult })
        }

        // ── Phase 3: Checker (streaming) ───────────────────────────────
        send({ type: 'agent_start', agent: 'checker', description: '审查执行结果，生成最终回答' })

        const executionSummary = results
          .map(r => `[${r.taskId}] ${r.description}\n→ ${r.result}`)
          .join('\n\n')

        const checkerStream = await client.chat.completions.create({
          model: MODEL,
          messages: [
            {
              role: 'system',
              content: `你是审查Agent。基于执行结果，给用户一个完整准确的最终回答。
直接回答问题，语言自然流畅，重点突出，不要提"执行结果"等内部信息。`,
            },
            {
              role: 'user',
              content: `用户问题: ${userQuestion}${historyContext}\n\n执行结果:\n${executionSummary}\n\n请给出最终回答:`,
            },
          ],
          stream: true,
          max_tokens: 2048,
        })

        for await (const chunk of checkerStream) {
          const delta = chunk.choices[0]?.delta?.content
          if (delta) send({ type: 'text', content: delta })
        }

        send({ type: 'done' })
        controller.close()
      } catch (err) {
        const msg = err instanceof Error ? err.message : '未知错误'
        console.error('[MultiAgent Error]', err)
        send({ type: 'error', content: msg })
        controller.close()
      }
    },
  })
}
