// Embedding API 可以与聊天 API 分开配置
// 推荐使用 SiliconFlow（免费 embedding 模型）
// EMBED_API_KEY 未设置时回退到 AI_API_KEY
const BASE_URL = process.env.EMBED_BASE_URL || process.env.AI_BASE_URL || 'https://api.siliconflow.cn/v1'
const EMBED_MODEL = process.env.EMBED_MODEL || 'BAAI/bge-m3'

export async function getEmbedding(text: string): Promise<number[]> {
  const apiKey = process.env.EMBED_API_KEY || process.env.AI_API_KEY
  if (!apiKey) throw new Error('请配置 EMBED_API_KEY 或 AI_API_KEY')

  const res = await fetch(`${BASE_URL}/embeddings`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: EMBED_MODEL,
      input: text,
      encoding_format: 'float',
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Embedding API 错误 ${res.status}: ${err}`)
  }

  const data = await res.json()
  return data.data[0].embedding as number[]
}
