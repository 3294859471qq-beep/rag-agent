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
  {
    type: 'function',
    function: {
      name: 'web_search',
      description:
        '联网搜索最新信息、Wikipedia 百科、arXiv 论文等。当知识库没有相关内容，或需要最新资料、外部参考时使用。',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '搜索关键词，中英文均可，如 "黎曼曲率张量 定义" 或 "Riemann curvature tensor"',
          },
          lang: {
            type: 'string',
            enum: ['zh', 'en'],
            description: '优先语言：zh=中文（默认），en=英文',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_code',
      description:
        '在安全沙箱中执行代码并返回运行结果（stdout/stderr）。适合验证代码逻辑、运行测试、计算复杂表达式。支持 python、javascript、typescript、go、rust、java、cpp 等语言。',
      parameters: {
        type: 'object',
        properties: {
          language: {
            type: 'string',
            description: '编程语言，如 python、javascript、typescript、go、rust、java、cpp',
          },
          code: {
            type: 'string',
            description: '要执行的完整代码',
          },
        },
        required: ['language', 'code'],
      },
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
          return '知识库中没有找到与此问题相关的内容（当前阈值0.2，请检查Vercel日志确认top scores）。'
        }
        return results
          .map((r, i) => {
            const reliability = r.score >= 0.7 ? '★高' : r.score >= 0.55 ? '☆中' : '△低'
            return `[片段 ${i + 1}] 来源:《${r.docTitle}》| 相关度: ${(r.score * 100).toFixed(1)}% (${reliability})\n${r.content}`
          })
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

    case 'web_search': {
      const query = args.query as string
      const lang = (args.lang as string) || 'zh'

      // Tavily（若配置了 API key，效果更好）
      const tavilyKey = process.env.TAVILY_API_KEY
      if (tavilyKey) {
        try {
          const resp = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              api_key: tavilyKey,
              query,
              search_depth: 'basic',
              max_results: 4,
              include_answer: true,
            }),
            signal: AbortSignal.timeout(15000),
          })
          if (resp.ok) {
            const data = await resp.json() as {
              answer?: string
              results?: Array<{ title: string; url: string; content: string }>
            }
            const lines: string[] = []
            if (data.answer) lines.push(`摘要: ${data.answer}\n`)
            data.results?.forEach((r, i) => {
              lines.push(`[${i + 1}] ${r.title}\n来源: ${r.url}\n${r.content.slice(0, 400)}`)
            })
            return lines.join('\n\n---\n\n') || '未找到结果'
          }
        } catch { /* fallthrough to Wikipedia */ }
      }

      // 免费 fallback：Wikipedia
      try {
        const searchUrl = `https://${lang}.wikipedia.org/w/api.php?` +
          `action=query&list=search&srsearch=${encodeURIComponent(query)}` +
          `&srlimit=3&format=json&utf8=1&origin=*`
        const searchResp = await fetch(searchUrl, { signal: AbortSignal.timeout(10000) })
        if (!searchResp.ok) return '搜索失败'
        const searchData = await searchResp.json() as {
          query: { search: Array<{ title: string; snippet: string }> }
        }
        const hits = searchData.query.search
        if (!hits.length) return '未找到相关内容'

        // 获取前两条的摘要
        const titles = hits.slice(0, 2).map(h => h.title)
        const extractUrl = `https://${lang}.wikipedia.org/w/api.php?` +
          `action=query&prop=extracts&exintro=true&explaintext=true` +
          `&titles=${titles.map(t => encodeURIComponent(t)).join('|')}` +
          `&format=json&utf8=1&origin=*`
        const extractResp = await fetch(extractUrl, { signal: AbortSignal.timeout(10000) })
        const extractData = await extractResp.json() as {
          query: { pages: Record<string, { title: string; extract?: string }> }
        }
        const results = Object.values(extractData.query.pages)
          .filter(p => p.extract)
          .map(p => `【${p.title}】\n${p.extract!.slice(0, 600)}`)
        return results.join('\n\n---\n\n') || '未找到摘要'
      } catch (e) {
        return `搜索失败: ${e instanceof Error ? e.message : '网络错误'}`
      }
    }

    case 'run_code': {
      const langRaw = (args.language as string ?? 'python').toLowerCase().trim()
      const langMap: Record<string, string> = { py: 'python', js: 'javascript', ts: 'typescript', 'c++': 'c++', cpp: 'c++' }
      const language = langMap[langRaw] ?? langRaw
      const code = args.code as string

      try {
        const resp = await fetch('https://emkc.org/api/v2/piston/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ language, version: '*', files: [{ content: code }] }),
          signal: AbortSignal.timeout(15000),
        })
        if (!resp.ok) return `执行失败: HTTP ${resp.status}`

        const data = await resp.json() as {
          run?: { stdout?: string; stderr?: string; code?: number }
          message?: string
        }
        if (data.message) return `沙箱错误: ${data.message}`

        const stdout = (data.run?.stdout ?? '').trim()
        const stderr = (data.run?.stderr ?? '').trim()
        const exitCode = data.run?.code ?? 0

        if (exitCode !== 0 && stderr) return `运行错误 (exit ${exitCode}):\n${stderr}`
        if (stderr) return `输出:\n${stdout}\n\n标准错误:\n${stderr}`
        return stdout || '（执行成功，无输出）'
      } catch (e) {
        return `执行失败: ${e instanceof Error ? e.message : '网络错误'}`
      }
    }

    default:
      return `未知工具: ${name}`
  }
}
