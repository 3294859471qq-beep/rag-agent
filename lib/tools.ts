import { evaluate } from 'mathjs'
import { getEmbedding } from './embeddings'
import { semanticSearch } from './vector-store'
import type OpenAI from 'openai'

export const TOOL_DEFINITIONS: OpenAI.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'search_knowledge',
      description:
        '在知识库中进行语义搜索，检索与问题最相关的文档片段。当需要回答关于上传文档内容的问题时使用此工具。',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '搜索查询词，应该是问题的核心关键词或完整问题',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calculate',
      description:
        '计算数学表达式，支持加减乘除、幂运算、三角函数、对数、矩阵等。返回精确计算结果。',
      parameters: {
        type: 'object',
        properties: {
          expression: {
            type: 'string',
            description: '数学表达式，如 "sqrt(2^10 + 100)" 或 "sin(pi/4) * 2"',
          },
        },
        required: ['expression'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_datetime',
      description: '获取当前日期和时间（北京时间）',
      parameters: { type: 'object', properties: {} },
    },
  },
]

export async function executeTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  switch (name) {
    case 'search_knowledge': {
      const query = args.query as string
      try {
        const embedding = await getEmbedding(query)
        const results = await semanticSearch(embedding)
        if (results.length === 0) {
          return '知识库中没有找到与此问题相关的内容。'
        }
        return results
          .map(
            (r, i) =>
              `[片段 ${i + 1}] 来源: 《${r.docTitle}》（相关度: ${(r.score * 100).toFixed(1)}%）\n${r.content}`
          )
          .join('\n\n---\n\n')
      } catch (e) {
        return `搜索失败: ${e instanceof Error ? e.message : '未知错误'}`
      }
    }

    case 'calculate': {
      const expr = args.expression as string
      try {
        const result = evaluate(expr)
        return `计算结果: ${expr} = ${result}`
      } catch (e) {
        return `计算错误: ${e instanceof Error ? e.message : '表达式无效'}`
      }
    }

    case 'get_datetime': {
      const now = new Date()
      const formatted = now.toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'long',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
      return `当前时间（北京时间）: ${formatted}`
    }

    default:
      return `未知工具: ${name}`
  }
}
