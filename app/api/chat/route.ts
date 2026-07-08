import { NextRequest } from 'next/server'
import { runAgent } from '@/lib/agent'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const { messages } = await req.json()

  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response(JSON.stringify({ error: '消息列表不能为空' }), { status: 400 })
  }

  const stream = runAgent(messages)

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
