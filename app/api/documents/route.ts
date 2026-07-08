import { NextRequest, NextResponse } from 'next/server'
import { getEmbedding } from '@/lib/embeddings'
import { saveDocument, getDocuments, deleteDocument } from '@/lib/vector-store'
import type { Chunk, Document } from '@/lib/types'

export const runtime = 'nodejs'
export const maxDuration = 60

const CHUNK_SIZE = 400
const CHUNK_OVERLAP = 60

function splitText(text: string): string[] {
  const chunks: string[] = []
  const paragraphs = text
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(p => p.length > 0)

  for (const para of paragraphs) {
    if (para.length <= CHUNK_SIZE) {
      chunks.push(para)
    } else {
      let start = 0
      while (start < para.length) {
        const end = Math.min(start + CHUNK_SIZE, para.length)
        const chunk = para.slice(start, end).trim()
        if (chunk.length > 20) chunks.push(chunk)
        start += CHUNK_SIZE - CHUNK_OVERLAP
      }
    }
  }

  return chunks
}

export async function GET() {
  const docs = await getDocuments()
  return NextResponse.json(docs)
}

export async function POST(req: NextRequest) {
  const { title, content } = await req.json()

  if (!title?.trim() || !content?.trim()) {
    return NextResponse.json({ error: '标题和内容不能为空' }, { status: 400 })
  }

  const textChunks = splitText(content)
  if (textChunks.length === 0) {
    return NextResponse.json({ error: '文档内容解析失败' }, { status: 400 })
  }

  const docId = crypto.randomUUID()
  const chunks: Chunk[] = []

  for (const text of textChunks) {
    const embedding = await getEmbedding(text)
    chunks.push({
      id: crypto.randomUUID(),
      docId,
      docTitle: title,
      content: text,
      embedding,
    })
  }

  const doc: Document = {
    id: docId,
    title: title.trim(),
    content,
    chunks,
    createdAt: Date.now(),
  }

  await saveDocument(doc)

  return NextResponse.json({
    id: doc.id,
    title: doc.title,
    chunkCount: doc.chunks.length,
  })
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: 'id 不能为空' }, { status: 400 })
  await deleteDocument(id)
  return NextResponse.json({ success: true })
}
