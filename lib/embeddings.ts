const BASE_URL = process.env.EMBED_BASE_URL || process.env.AI_BASE_URL || 'https://api.siliconflow.cn/v1'
const EMBED_MODEL = process.env.EMBED_MODEL || 'BAAI/bge-m3'

async function callEmbedAPI(input: string | string[]): Promise<number[][]> {
  const apiKey = process.env.EMBED_API_KEY || process.env.AI_API_KEY
  if (!apiKey) throw new Error('请配置 EMBED_API_KEY 或 AI_API_KEY')

  const res = await fetch(`${BASE_URL}/embeddings`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: EMBED_MODEL, input, encoding_format: 'float' }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Embedding API 错误 ${res.status}: ${err}`)
  }

  const data = await res.json()
  const items = data.data as Array<{ index: number; embedding: number[] }>
  items.sort((a, b) => a.index - b.index)
  return items.map(i => i.embedding)
}

export async function getEmbedding(text: string): Promise<number[]> {
  const results = await callEmbedAPI(text)
  return results[0]
}

// 批量 embedding，每批最多 32 条，并发 4 批
export async function getEmbeddingBatch(texts: string[]): Promise<number[][]> {
  const BATCH = 32
  const CONCURRENCY = 4
  const batches: string[][] = []
  for (let i = 0; i < texts.length; i += BATCH) {
    batches.push(texts.slice(i, i + BATCH))
  }

  const results: number[][][] = new Array(batches.length)
  for (let i = 0; i < batches.length; i += CONCURRENCY) {
    const slice = batches.slice(i, i + CONCURRENCY)
    const embeddings = await Promise.all(slice.map(b => callEmbedAPI(b)))
    for (let j = 0; j < embeddings.length; j++) {
      results[i + j] = embeddings[j]
    }
  }

  return results.flat()
}
