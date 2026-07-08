import { Index } from '@upstash/vector'
import type { Chunk, Document } from './types'

// 每次调用创建新实例，避免模块缓存导致的冷启动问题
function getIndex() {
  const url = process.env.UPSTASH_VECTOR_REST_URL
  const token = process.env.UPSTASH_VECTOR_REST_TOKEN
  if (!url || !token) {
    throw new Error(
      '请配置 UPSTASH_VECTOR_REST_URL 和 UPSTASH_VECTOR_REST_TOKEN 环境变量'
    )
  }
  return new Index({ url, token })
}

interface ChunkMeta extends Record<string, unknown> {
  docId: string
  docTitle: string
  content: string
  createdAt: number
}

interface RangePage {
  nextCursor: number
  vectors: Array<{ id: string; metadata?: unknown }>
}

// 扫描所有向量（支持分页）
async function scanAll(index: Index): Promise<Array<{ id: string; metadata?: ChunkMeta }>> {
  const all: Array<{ id: string; metadata?: ChunkMeta }> = []
  let cursor = 0

  while (true) {
    // cast needed: Upstash SDK uses conditional types that confuse inference here
    const result = (await index.range({
      cursor,
      limit: 1000,
      includeMetadata: true,
    })) as unknown as RangePage

    for (const v of result.vectors) {
      all.push({ id: v.id, metadata: v.metadata as ChunkMeta | undefined })
    }
    if (!result.nextCursor || result.nextCursor === 0) break
    cursor = result.nextCursor
  }

  return all
}

export async function saveDocument(doc: Document): Promise<void> {
  const index = getIndex()

  const vectors = doc.chunks.map(chunk => ({
    id: chunk.id,
    vector: chunk.embedding,
    metadata: {
      docId: doc.id,
      docTitle: doc.title,
      content: chunk.content,
      createdAt: doc.createdAt,
    } as ChunkMeta,
  }))

  // Upstash 建议每批不超过 100 条
  for (let i = 0; i < vectors.length; i += 100) {
    await index.upsert(vectors.slice(i, i + 100))
  }
}

export async function getDocuments(): Promise<
  Array<{ id: string; title: string; chunkCount: number; createdAt: number }>
> {
  const index = getIndex()
  const all = await scanAll(index)

  const docMap = new Map<
    string,
    { id: string; title: string; chunkCount: number; createdAt: number }
  >()

  for (const v of all) {
    const m = v.metadata
    if (!m?.docId) continue
    if (!docMap.has(m.docId)) {
      docMap.set(m.docId, {
        id: m.docId,
        title: m.docTitle,
        createdAt: m.createdAt,
        chunkCount: 0,
      })
    }
    docMap.get(m.docId)!.chunkCount++
  }

  return Array.from(docMap.values()).sort((a, b) => b.createdAt - a.createdAt)
}

export async function deleteDocument(id: string): Promise<void> {
  const index = getIndex()
  const all = await scanAll(index)
  const ids = all.filter(v => v.metadata?.docId === id).map(v => v.id)
  if (ids.length > 0) await index.delete(ids)
}

export async function semanticSearch(
  queryEmbedding: number[],
  topK = 6,
  minScore = 0.5
): Promise<Array<Chunk & { score: number }>> {
  const index = getIndex()

  const results = await index.query({
    vector: queryEmbedding,
    topK,
    includeMetadata: true,
  })

  return results
    .filter(r => r.score >= minScore && r.metadata)
    .map(r => {
      const m = r.metadata as ChunkMeta
      return {
        id: r.id as string,
        docId: m.docId,
        docTitle: m.docTitle,
        content: m.content,
        embedding: [],
        score: r.score,
      }
    })
}
