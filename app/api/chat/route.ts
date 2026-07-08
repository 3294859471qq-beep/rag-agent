import { NextRequest } from 'next/server'
import { runAgent } from '@/lib/agent'
import { runMultiAgent } from '@/lib/multi-agent'
import { runVisionAgent } from '@/lib/vision'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const { messages, mode } = await req.json()

  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response(JSON.stringify({ error: '消息列表不能为空' }), { status: 400 })
  }

  // If the latest user message contains an image, route to vision model
  const lastMsg = messages[messages.length - 1]
  const hasImage = lastMsg?.role === 'user' && !!lastMsg?.image
  const stream = hasImage
    ? runVisionAgent(messages)
    : mode === 'multi' ? runMultiAgent(messages) : runAgent(messages)

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
