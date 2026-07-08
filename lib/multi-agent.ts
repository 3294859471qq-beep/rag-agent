import OpenAI from 'openai'
import { TOOL_DEFINITIONS, executeTool } from './tools'
import type { AgentEvent } from './types'

// Plan C: 四个角色严格分工，互不越界
//   规划Agent  → 确定需要研究哪些信息
//   研究Agent  → 只负责调用工具收集数据（不写答案）
//   写作Agent  → 只负责组织语言撰写草稿（不调工具）
//   审核Agent  → 审查草稿准确性并流式输出最终答案

const MODEL = process.env.AI_MODEL || 'deepseek-ai/DeepSeek-V3'
const BASE_URL = process.env.AI_BASE_URL || 'https://api.siliconflow.cn/v1'
const MAX_RESEARCH_ROUNDS = 3

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
        const historyCtx =
          history.length > 0
            ? '\n\n对话历史:\n' +
              history.map(m => `${m.role === 'user' ? '用户' : '助手'}: ${m.content}`).join('\n')
            : ''

        // ── 规划Agent ───────────────────────────────────────────────────
        // 职责：分析问题，列出需要研究的信息目标
        send({ type: 'agent_start', agent: 'planner', description: '分析问题，规划研究方向' })

        const plannerResp = await client.chat.completions.create({
          model: MODEL,
          messages: [
            {
              role: 'system',
              content: `你是规划Agent。分析用户问题，列出研究Agent需要收集的信息目标（1-4个）。

可用工具：search_knowledge（搜索知识库）、calculate（计算）、get_datetime（获取时间）

只输出 JSON，不要其他文字：
{"research_goals":[{"id":"r1","description":"需要了解什么"},{"id":"r2","description":"需要计算什么"}]}`,
            },
            { role: 'user', content: `问题: ${userQuestion}${historyCtx}` },
          ],
          temperature: 0.2,
          max_tokens: 512,
        })

        let goals: Array<{ id: string; description: string }> = []
        try {
          const raw = plannerResp.choices[0].message.content ?? '{}'
          const jsonMatch = raw.match(/\{[\s\S]*\}/)
          const parsed = JSON.parse(jsonMatch?.[0] ?? raw)
          goals = Array.isArray(parsed.research_goals) ? parsed.research_goals : []
        } catch { /* fallthrough */ }
        if (goals.length === 0) {
          goals = [{ id: 'r1', description: '搜索知识库获取相关信息' }]
        }

        send({ type: 'plan', tasks: goals })

        // ── 研究Agent ───────────────────────────────────────────────────
        // 职责：只调用工具收集原始数据，不做任何总结或写作
        send({ type: 'agent_start', agent: 'researcher', description: '调用工具，收集原始数据' })

        const findings: Array<{ goalId: string; description: string; data: string }> = []

        for (const goal of goals) {
          send({ type: 'task_start', taskId: goal.id, description: goal.description })

          const researchMsgs: OpenAI.ChatCompletionMessageParam[] = [
            {
              role: 'system',
              content: `你是研究Agent。职责是收集信息，不是回答问题。
使用工具获取原始数据后，只输出收集到的原始信息（不要总结，不要写回答）。
如果工具没有返回有用内容，如实说明"未找到相关信息"。`,
            },
            {
              role: 'user',
              content: `原始问题: ${userQuestion}${historyCtx}\n\n研究目标: ${goal.description}`,
            },
          ]

          let rawData = '（未收集到数据）'

          for (let round = 0; round < MAX_RESEARCH_ROUNDS; round++) {
            const resp = await client.chat.completions.create({
              model: MODEL,
              messages: researchMsgs,
              tools: TOOL_DEFINITIONS,
              tool_choice: 'auto',
              max_tokens: 1024,
            })

            const msg = resp.choices[0].message

            if (!msg.tool_calls?.length) {
              rawData = msg.content ?? '（无数据）'
              break
            }

            researchMsgs.push(msg)
            const toolResults: OpenAI.ChatCompletionToolMessageParam[] = []

            for (const tc of msg.tool_calls) {
              let args: Record<string, unknown> = {}
              try { args = JSON.parse(tc.function.arguments || '{}') } catch { /* */ }

              send({ type: 'tool_start', tool: tc.function.name, input: args })
              const output = await executeTool(tc.function.name, args)
              send({ type: 'tool_end', tool: tc.function.name, output })
              toolResults.push({ role: 'tool', tool_call_id: tc.id, content: output })
            }

            researchMsgs.push(...toolResults)
          }

          findings.push({ goalId: goal.id, description: goal.description, data: rawData })
          send({ type: 'task_result', taskId: goal.id, result: rawData })
        }

        // ── 写作Agent ───────────────────────────────────────────────────
        // 职责：只根据研究数据组织语言，不调用任何工具
        send({ type: 'agent_start', agent: 'writer', description: '整合研究数据，撰写回答草稿' })

        const researchSummary = findings
          .map(f => `【${f.description}】\n${f.data}`)
          .join('\n\n')

        const writerResp = await client.chat.completions.create({
          model: MODEL,
          messages: [
            {
              role: 'system',
              content: `你是写作Agent。将研究数据组织成回答，严格遵守以下规则：

【有检索结果时】
- 只能使用研究数据中明确出现的内容，不得添加任何研究数据中未提及的事实
- 每个关键论断后用括号标注来源片段编号，如（见片段2）
- 若某个细节研究数据中未涉及，写"（书中未检索到此细节）"，不要自行补充
- 低相关度片段（△低）的内容要谨慎使用，只作参考

【无检索结果时】
- 明确告知用户知识库未找到相关内容，末尾注明"（以上为通用知识，非来自书本）"
- 建议用户上传对应章节

不提"研究数据""片段"等内部词汇，直接给用户看的是引用标注。`,
            },
            {
              role: 'user',
              content: `用户问题: ${userQuestion}${historyCtx}\n\n研究数据:\n${researchSummary}\n\n请撰写回答草稿:`,
            },
          ],
          max_tokens: 2048,
        })

        const draft = writerResp.choices[0].message.content ?? ''

        // ── 审核Agent ───────────────────────────────────────────────────
        // 职责：可运行代码验证正确性，对照研究数据审查草稿，流式输出最终答案
        send({ type: 'agent_start', agent: 'checker', description: '运行代码验证，审核草稿，输出最终回答' })

        const checkerSystemPrompt = `你是审核Agent。逐项检查写作草稿：

1. 【事实核查】对照原始研究数据，检查每个有片段编号标注的论断是否确实出现在对应片段中；若草稿声称某内容来自书本但研究数据中找不到依据，将该论断删除或标注"（未在书中找到依据）"
2. 【代码验证】若草稿含代码，调用 run_code 实际运行，根据结果修正
3. 【通用知识区分】确保草稿清晰区分了"来自书本内容"和"通用知识"，若混淆则纠正
4. 【无中生有检测】删除所有研究数据中没有依据但草稿自行添加的具体数字、定理名称、推导步骤

直接输出最终答案，保留引用标注（见片段N），不要说"草稿已审核"之类的元信息。`

        const checkerMsgs: OpenAI.ChatCompletionMessageParam[] = [
          { role: 'system', content: checkerSystemPrompt },
          {
            role: 'user',
            content: `用户问题: ${userQuestion}${historyCtx}\n\n原始研究数据:\n${researchSummary}\n\n写作草稿:\n${draft}\n\n请先验证（如有代码），再输出最终回答:`,
          },
        ]

        // 工具验证阶段（非流式，最多 2 轮，只允许 run_code）
        const checkerTools = TOOL_DEFINITIONS.filter(t => t.function.name === 'run_code')
        for (let round = 0; round < 2; round++) {
          const verifyResp = await client.chat.completions.create({
            model: MODEL,
            messages: checkerMsgs,
            tools: checkerTools,
            tool_choice: 'auto',
            max_tokens: 512,
          })
          const verifyMsg = verifyResp.choices[0].message
          if (!verifyMsg.tool_calls?.length) break

          checkerMsgs.push(verifyMsg)
          const toolResults: OpenAI.ChatCompletionToolMessageParam[] = []
          for (const tc of verifyMsg.tool_calls) {
            let args: Record<string, unknown> = {}
            try { args = JSON.parse(tc.function.arguments || '{}') } catch { /* */ }
            send({ type: 'tool_start', tool: tc.function.name, input: args })
            const output = await executeTool(tc.function.name, args)
            send({ type: 'tool_end', tool: tc.function.name, output })
            toolResults.push({ role: 'tool', tool_call_id: tc.id, content: output })
          }
          checkerMsgs.push(...toolResults)
        }

        // 流式输出最终答案
        const checkerStream = await client.chat.completions.create({
          model: MODEL,
          messages: checkerMsgs,
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
