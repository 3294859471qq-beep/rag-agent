'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Send,
  Upload,
  Trash2,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Loader2,
  Bot,
  User,
  FileText,
  Calculator,
  Clock,
  Search,
  X,
  Plus,
  Users,
  Zap,
} from 'lucide-react'
import type { Message, ToolCallRecord, PlanTask } from '@/lib/types'
import type { AgentEvent } from '@/lib/types'

type Mode = 'single' | 'multi'

// ─── Document types ───────────────────────────────────────────────────────────
interface DocMeta {
  id: string
  title: string
  chunkCount: number
  createdAt: number
}

// ─── Tool call step display ───────────────────────────────────────────────────
function ToolStep({ tc }: { tc: ToolCallRecord }) {
  const [open, setOpen] = useState(false)

  const icon =
    tc.tool === 'search_knowledge' ? (
      <Search size={13} />
    ) : tc.tool === 'calculate' ? (
      <Calculator size={13} />
    ) : (
      <Clock size={13} />
    )

  const label =
    tc.tool === 'search_knowledge'
      ? `搜索: "${(tc.input as { query?: string }).query ?? ''}"`
      : tc.tool === 'calculate'
        ? `计算: ${(tc.input as { expression?: string }).expression ?? ''}`
        : '获取当前时间'

  return (
    <div className="mt-1 rounded-lg border border-blue-100 bg-blue-50 text-xs overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-blue-700 hover:bg-blue-100 transition-colors"
      >
        <span className="text-blue-500">{icon}</span>
        <span className="flex-1 text-left font-medium truncate">{label}</span>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>
      {open && (
        <div className="px-3 pb-2 border-t border-blue-100">
          <p className="mt-1 text-gray-500 font-medium">结果:</p>
          <pre className="mt-1 whitespace-pre-wrap text-gray-700 leading-relaxed max-h-48 overflow-y-auto">
            {tc.output}
          </pre>
        </div>
      )}
    </div>
  )
}

// ─── Multi-agent workflow panel ───────────────────────────────────────────────
function MultiAgentWorkflow({ msg }: { msg: Message }) {
  const [expanded, setExpanded] = useState(true)

  const phases = ['planner', 'executor', 'checker'] as const
  const phaseLabels = { planner: '规划', executor: '执行', checker: '审查' }
  const currentIdx = phases.indexOf(
    (msg.agentPhase ?? 'planner') as typeof phases[number]
  )
  const isDone = msg.agentPhase === 'done'

  const hasContent = (msg.plan && msg.plan.length > 0) || (msg.toolCalls && msg.toolCalls.length > 0)

  return (
    <div className="mb-2 rounded-lg border border-violet-100 bg-violet-50 text-xs overflow-hidden w-full">
      <button
        onClick={() => setExpanded(v => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-violet-700 hover:bg-violet-100 transition-colors"
      >
        <Users size={13} className="text-violet-500 flex-shrink-0" />
        <span className="font-medium flex-1 text-left">多Agent工作流</span>
        <div className="flex items-center gap-1">
          {phases.map((p, i) => {
            const done = isDone || currentIdx > i
            const active = !isDone && currentIdx === i
            return (
              <span
                key={p}
                className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
                  active
                    ? 'bg-violet-500 text-white'
                    : done
                      ? 'bg-violet-200 text-violet-700'
                      : 'bg-white text-violet-300 border border-violet-200'
                }`}
              >
                {phaseLabels[p]}
              </span>
            )
          })}
        </div>
        {hasContent && (
          expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />
        )}
      </button>

      {expanded && hasContent && (
        <div className="border-t border-violet-100 px-3 py-2 space-y-1.5">
          {msg.plan?.map(task => (
            <PlanTaskRow key={task.id} task={task} />
          ))}
          {msg.toolCalls?.map((tc, i) => (
            <ToolStep key={i} tc={tc} />
          ))}
        </div>
      )}
    </div>
  )
}

function PlanTaskRow({ task }: { task: PlanTask }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="rounded border border-violet-100 bg-white overflow-hidden">
      <button
        onClick={() => task.done && setOpen(v => !v)}
        className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left ${
          task.done ? 'hover:bg-violet-50 cursor-pointer' : 'cursor-default'
        }`}
      >
        <span
          className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 text-[9px] font-bold ${
            task.done ? 'bg-emerald-400 text-white' : 'bg-violet-100 text-violet-300'
          }`}
        >
          {task.done ? '✓' : ''}
        </span>
        <span className={`flex-1 text-xs ${task.done ? 'text-gray-500' : 'text-violet-700'}`}>
          {task.description}
        </span>
        {task.done && task.result && (
          open ? <ChevronDown size={11} className="text-violet-400" /> : <ChevronRight size={11} className="text-violet-400" />
        )}
      </button>
      {open && task.result && (
        <div className="px-3 pb-2 border-t border-violet-50">
          <pre className="mt-1 text-[11px] text-gray-600 whitespace-pre-wrap leading-relaxed max-h-32 overflow-y-auto">
            {task.result}
          </pre>
        </div>
      )}
    </div>
  )
}

// ─── Chat message bubble ──────────────────────────────────────────────────────
function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === 'user'
  const isMulti = msg.agentPhase !== undefined

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <div
        className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-white text-sm
          ${isUser ? 'bg-indigo-500' : isMulti ? 'bg-violet-600' : 'bg-emerald-600'}`}
      >
        {isUser ? <User size={16} /> : isMulti ? <Users size={15} /> : <Bot size={16} />}
      </div>

      <div className={`max-w-[80%] ${isUser ? 'items-end' : 'items-start'} flex flex-col`}>
        {/* Multi-agent workflow panel */}
        {!isUser && isMulti && <MultiAgentWorkflow msg={msg} />}

        {/* Single-agent tool calls */}
        {!isUser && !isMulti && msg.toolCalls && msg.toolCalls.length > 0 && (
          <div className="w-full mb-2 space-y-1">
            {msg.toolCalls.map((tc, i) => (
              <ToolStep key={i} tc={tc} />
            ))}
          </div>
        )}

        {/* Content */}
        {msg.content && (
          <div
            className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap
              ${isUser
                ? 'bg-indigo-500 text-white rounded-tr-sm'
                : 'bg-white border border-gray-100 shadow-sm text-gray-800 rounded-tl-sm'
              }`}
          >
            {msg.content}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Document panel ───────────────────────────────────────────────────────────
function DocumentPanel({ onClose }: { onClose: () => void }) {
  const [docs, setDocs] = useState<DocMeta[]>([])
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const fetchDocs = useCallback(async () => {
    const res = await fetch('/api/documents')
    if (res.ok) setDocs(await res.json())
  }, [])

  useEffect(() => { fetchDocs() }, [fetchDocs])

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setTitle(file.name.replace(/\.[^.]+$/, ''))
    const reader = new FileReader()
    reader.onload = ev => setContent(ev.target?.result as string)
    reader.readAsText(file, 'utf-8')
  }

  const handleUpload = async () => {
    if (!title.trim() || !content.trim()) {
      setError('标题和内容不能为空')
      return
    }
    setError('')
    setUploading(true)
    try {
      const res = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), content }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error || '上传失败')
      }
      setTitle('')
      setContent('')
      if (fileRef.current) fileRef.current.value = ''
      await fetchDocs()
    } catch (e) {
      setError(e instanceof Error ? e.message : '上传失败')
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = async (id: string) => {
    await fetch('/api/documents', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    await fetchDocs()
  }

  return (
    <div className="h-full flex flex-col bg-white border-r border-gray-200">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div className="flex items-center gap-2 font-semibold text-gray-800">
          <BookOpen size={16} className="text-indigo-500" />
          知识库
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 text-gray-400">
          <X size={16} />
        </button>
      </div>

      <div className="p-4 border-b border-gray-100 space-y-2">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">添加文档</p>
        <input
          ref={fileRef}
          type="file"
          accept=".txt,.md,.csv"
          onChange={handleFile}
          className="hidden"
        />
        <button
          onClick={() => fileRef.current?.click()}
          className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-gray-200 rounded-lg py-2.5 text-sm text-gray-500 hover:border-indigo-300 hover:text-indigo-500 transition-colors"
        >
          <Upload size={14} />
          选择 .txt / .md 文件
        </button>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="文档标题"
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
        />
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          placeholder="或直接粘贴文档内容..."
          rows={4}
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300"
        />
        {error && <p className="text-xs text-red-500">{error}</p>}
        <button
          onClick={handleUpload}
          disabled={uploading}
          className="w-full flex items-center justify-center gap-2 bg-indigo-500 text-white rounded-lg py-2 text-sm font-medium hover:bg-indigo-600 disabled:opacity-50 transition-colors"
        >
          {uploading ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              向量化中...
            </>
          ) : (
            <>
              <Plus size={14} />
              上传并向量化
            </>
          )}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {docs.length === 0 ? (
          <p className="text-sm text-gray-400 text-center mt-4">暂无文档</p>
        ) : (
          docs.map(doc => (
            <div
              key={doc.id}
              className="flex items-start gap-2 p-3 rounded-lg border border-gray-100 hover:bg-gray-50"
            >
              <FileText size={14} className="text-indigo-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">{doc.title}</p>
                <p className="text-xs text-gray-400 mt-0.5">{doc.chunkCount} 个片段</p>
              </div>
              <button
                onClick={() => handleDelete(doc.id)}
                className="flex-shrink-0 p-1 rounded hover:bg-red-50 text-gray-300 hover:text-red-400 transition-colors"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function Home() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [showDocs, setShowDocs] = useState(false)
  const [mode, setMode] = useState<Mode>('single')
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = async () => {
    const text = input.trim()
    if (!text || loading) return

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    }

    const assistantId = crypto.randomUUID()
    const assistantMsg: Message = {
      id: assistantId,
      role: 'assistant',
      content: '',
      toolCalls: [],
      timestamp: Date.now(),
      // pre-seed agentPhase for multi mode so the avatar shows correctly
      ...(mode === 'multi' ? { agentPhase: 'planner' as const, plan: [] } : {}),
    }

    setMessages(prev => [...prev, userMsg, assistantMsg])
    setInput('')
    setLoading(true)

    const history = [...messages, userMsg].map(m => ({
      role: m.role,
      content: m.content,
    }))

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history, mode }),
      })

      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const raw = line.slice(6).trim()
          if (!raw) continue

          let event: AgentEvent
          try { event = JSON.parse(raw) } catch { continue }

          setMessages(prev =>
            prev.map(m => {
              if (m.id !== assistantId) return m

              if (event.type === 'text') {
                return { ...m, content: m.content + event.content }
              }
              if (event.type === 'tool_start') {
                const pending: ToolCallRecord = { tool: event.tool, input: event.input, output: '...' }
                return { ...m, toolCalls: [...(m.toolCalls ?? []), pending] }
              }
              if (event.type === 'tool_end') {
                const tcs = (m.toolCalls ?? []).map(tc =>
                  tc.tool === event.tool && tc.output === '...'
                    ? { ...tc, output: event.output }
                    : tc
                )
                return { ...m, toolCalls: tcs }
              }
              if (event.type === 'agent_start') {
                return { ...m, agentPhase: event.agent }
              }
              if (event.type === 'plan') {
                return {
                  ...m,
                  plan: event.tasks.map(t => ({ ...t, done: false })),
                }
              }
              if (event.type === 'task_result') {
                return {
                  ...m,
                  plan: (m.plan ?? []).map(t =>
                    t.id === event.taskId ? { ...t, done: true, result: event.result } : t
                  ),
                }
              }
              if (event.type === 'done') {
                return { ...m, agentPhase: 'done' }
              }
              return m
            })
          )
        }
      }
    } catch (err) {
      setMessages(prev =>
        prev.map(m =>
          m.id === assistantId
            ? { ...m, content: `错误: ${err instanceof Error ? err.message : '请求失败'}` }
            : m
        )
      )
    } finally {
      setLoading(false)
      textareaRef.current?.focus()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {showDocs && (
        <div className="w-80 flex-shrink-0">
          <DocumentPanel onClose={() => setShowDocs(false)} />
        </div>
      )}

      <div className="flex flex-col flex-1 min-w-0">
        {/* Header */}
        <header className="flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-100 shadow-sm">
          <button
            onClick={() => setShowDocs(v => !v)}
            className={`p-2 rounded-lg transition-colors ${showDocs ? 'bg-indigo-50 text-indigo-600' : 'hover:bg-gray-100 text-gray-500'}`}
            title="知识库"
          >
            <BookOpen size={18} />
          </button>
          <div className="flex items-center gap-2">
            <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${mode === 'multi' ? 'bg-violet-600' : 'bg-indigo-500'}`}>
              {mode === 'multi' ? <Users size={14} className="text-white" /> : <Bot size={15} className="text-white" />}
            </div>
            <div>
              <h1 className="font-semibold text-gray-800 text-sm leading-none">RAG Agent</h1>
              <p className="text-xs text-gray-400 mt-0.5">
                {mode === 'multi' ? '规划 · 执行 · 审查 · 三Agent协同' : '向量检索 · Tool Use · 流式输出'}
              </p>
            </div>
          </div>

          {/* Mode toggle */}
          <div className="ml-4 flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5">
            <button
              onClick={() => setMode('single')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs transition-all ${
                mode === 'single'
                  ? 'bg-white text-indigo-600 shadow-sm font-medium'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Zap size={12} />
              单Agent
            </button>
            <button
              onClick={() => setMode('multi')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs transition-all ${
                mode === 'multi'
                  ? 'bg-white text-violet-600 shadow-sm font-medium'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Users size={12} />
              多Agent
            </button>
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1 text-xs bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              在线
            </span>
          </div>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-6 space-y-5">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center text-gray-400 select-none">
              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-4 ${mode === 'multi' ? 'bg-violet-50' : 'bg-indigo-50'}`}>
                {mode === 'multi'
                  ? <Users size={28} className="text-violet-400" />
                  : <Bot size={28} className="text-indigo-400" />
                }
              </div>
              {mode === 'multi' ? (
                <>
                  <p className="text-base font-medium text-gray-600">多Agent协同模式</p>
                  <p className="text-sm mt-1 max-w-xs">
                    三个专业Agent协同工作：规划Agent拆解任务，执行Agent调用工具，审查Agent生成最终回答。
                  </p>
                  <div className="mt-6 flex items-center gap-2 text-xs">
                    {[
                      { color: 'bg-violet-100 text-violet-700', label: '规划Agent', desc: '拆解任务' },
                      { color: 'bg-blue-100 text-blue-700', label: '执行Agent', desc: '调用工具' },
                      { color: 'bg-emerald-100 text-emerald-700', label: '审查Agent', desc: '整合输出' },
                    ].map((a, i) => (
                      <div key={i} className={`${a.color} rounded-lg px-3 py-2 text-center`}>
                        <p className="font-medium">{a.label}</p>
                        <p className="text-[11px] opacity-70 mt-0.5">{a.desc}</p>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <p className="text-base font-medium text-gray-600">你好，我是 RAG Agent</p>
                  <p className="text-sm mt-1 max-w-xs">
                    你可以上传文档到知识库，然后向我提问。我会自动搜索相关内容并给出准确回答。
                  </p>
                  <div className="mt-6 grid grid-cols-2 gap-2 text-xs max-w-sm">
                    {[
                      { icon: <Search size={12} />, text: '语义搜索知识库' },
                      { icon: <Calculator size={12} />, text: '精确数学计算' },
                      { icon: <Clock size={12} />, text: '查询当前时间' },
                      { icon: <Bot size={12} />, text: '自主 Tool Use' },
                    ].map((item, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-1.5 bg-gray-50 rounded-lg px-3 py-2 text-gray-500"
                      >
                        <span className="text-indigo-400">{item.icon}</span>
                        {item.text}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {messages.map(msg => (
            <MessageBubble key={msg.id} msg={msg} />
          ))}

          {loading && messages[messages.length - 1]?.role === 'user' && (
            <div className="flex gap-3">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${mode === 'multi' ? 'bg-violet-600' : 'bg-emerald-600'}`}>
                {mode === 'multi' ? <Users size={15} className="text-white" /> : <Bot size={16} className="text-white" />}
              </div>
              <div className="bg-white border border-gray-100 shadow-sm rounded-2xl rounded-tl-sm px-4 py-3">
                <Loader2 size={16} className="animate-spin text-gray-400" />
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="px-4 py-3 bg-white border-t border-gray-100">
          <div className="flex gap-2 items-end max-w-4xl mx-auto">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                mode === 'multi'
                  ? '输入问题... 三个Agent将协同回答 (Enter 发送)'
                  : '输入问题... (Enter 发送，Shift+Enter 换行)'
              }
              rows={1}
              className="flex-1 resize-none border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 max-h-36 overflow-y-auto"
              style={{ fieldSizing: 'content' } as React.CSSProperties}
              disabled={loading}
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim() || loading}
              className={`flex-shrink-0 w-10 h-10 flex items-center justify-center text-white rounded-xl disabled:opacity-40 disabled:cursor-not-allowed transition-colors ${
                mode === 'multi' ? 'bg-violet-600 hover:bg-violet-700' : 'bg-indigo-500 hover:bg-indigo-600'
              }`}
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>
          <p className="text-center text-xs text-gray-300 mt-1.5">
            {mode === 'multi'
              ? 'DeepSeek-V3 · 规划Agent + 执行Agent + 审查Agent'
              : 'DeepSeek-V3 · BAAI/bge-m3 向量检索 · SiliconFlow'}
          </p>
        </div>
      </div>
    </div>
  )
}
