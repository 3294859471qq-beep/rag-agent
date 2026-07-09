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
  Terminal,
  GraduationCap,
  ImagePlus,
  Globe,
} from 'lucide-react'
import katex from 'katex'
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

// ─── Study progress types & data ──────────────────────────────────────────────
type ChapterStatus = 'not_started' | 'in_progress' | 'mastered'
type StudyProgress = Record<string, ChapterStatus>

const CHAPTERS = [
  { num: 1,  title: '拓扑空间简介',               vol: '上册' },
  { num: 2,  title: '流形和张量场',                vol: '上册' },
  { num: 3,  title: '黎曼（内禀）曲率张量',        vol: '上册' },
  { num: 4,  title: '李导数、Killing场和超曲面',   vol: '上册' },
  { num: 5,  title: '微分形式及其积分',             vol: '上册' },
  { num: 6,  title: '狭义相对论',                   vol: '上册' },
  { num: 7,  title: '广义相对论基础',               vol: '中册' },
  { num: 8,  title: '爱因斯坦方程的求解',           vol: '中册' },
  { num: 9,  title: '施瓦西时空',                   vol: '中册' },
  { num: 10, title: '宇宙论',                        vol: '中册' },
  { num: 11, title: '时空的整体因果结构',           vol: '中册' },
  { num: 12, title: '渐近平直时空',                 vol: '中册' },
  { num: 13, title: 'Kerr-Newman 黑洞',             vol: '下册' },
  { num: 14, title: '参考系再认识',                 vol: '下册' },
  { num: 15, title: '广义相对论的拉氏和哈氏形式', vol: '下册' },
  { num: 16, title: '孤立视界、动力学视界和黑洞力学', vol: '下册' },
] as const

const PROGRESS_KEY = 'study-progress-liang-canbin'

function loadProgress(): StudyProgress {
  if (typeof window === 'undefined') return {}
  try { return JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? '{}') } catch { return {} }
}
function saveProgress(p: StudyProgress) {
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(p))
}

// ─── LaTeX math renderer ─────────────────────────────────────────────────────
type Segment = { type: 'text' | 'block' | 'inline'; content: string }

function parseMath(text: string): Segment[] {
  const segs: Segment[] = []
  // Match \[...\] | $$...$$ (block) or \(...\) | $...$ (inline), in that priority order
  const re = /(\\\[[\s\S]+?\\\]|\$\$[\s\S]+?\$\$|\\\([\s\S]+?\\\)|\$[^$\n]{1,300}?\$)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) segs.push({ type: 'text', content: text.slice(last, m.index) })
    const tok = m[0]
    if (tok.startsWith('\\[') || tok.startsWith('$$')) {
      segs.push({ type: 'block', content: tok.slice(2, -2) })
    } else if (tok.startsWith('\\(')) {
      segs.push({ type: 'inline', content: tok.slice(2, -2) })
    } else {
      segs.push({ type: 'inline', content: tok.slice(1, -1) })
    }
    last = m.index + tok.length
  }
  if (last < text.length) segs.push({ type: 'text', content: text.slice(last) })
  return segs
}

function renderKatex(math: string, display: boolean): string {
  try {
    return katex.renderToString(math, { displayMode: display, throwOnError: false, output: 'html' })
  } catch {
    return display ? `$$${math}$$` : `$${math}$`
  }
}

function MathContent({ content }: { content: string }) {
  const segs = parseMath(content)
  return (
    <>
      {segs.map((seg, i) => {
        if (seg.type === 'text') return <span key={i} className="whitespace-pre-wrap">{seg.content}</span>
        return (
          <span
            key={i}
            className={seg.type === 'block' ? 'block my-2 overflow-x-auto' : 'inline'}
            dangerouslySetInnerHTML={{ __html: renderKatex(seg.content, seg.type === 'block') }}
          />
        )
      })}
    </>
  )
}

// ─── Tool call step display ───────────────────────────────────────────────────
function ToolStep({ tc }: { tc: ToolCallRecord }) {
  const [open, setOpen] = useState(false)

  const icon =
    tc.tool === 'search_knowledge' ? <Search size={13} /> :
    tc.tool === 'calculate'        ? <Calculator size={13} /> :
    tc.tool === 'run_code'         ? <Terminal size={13} /> :
    tc.tool === 'web_search'       ? <Globe size={13} /> :
    <Clock size={13} />

  const label =
    tc.tool === 'search_knowledge' ? `搜索知识库: "${(tc.input as { query?: string }).query ?? ''}"` :
    tc.tool === 'calculate'        ? `计算: ${(tc.input as { expression?: string }).expression ?? ''}` :
    tc.tool === 'run_code'         ? `运行 ${(tc.input as { language?: string }).language ?? 'code'}` :
    tc.tool === 'web_search'       ? `联网搜索: "${(tc.input as { query?: string }).query ?? ''}"` :
    '获取当前时间'

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

  const phases = ['planner', 'researcher', 'writer', 'checker'] as const
  const phaseLabels = { planner: '规划', researcher: '研究', writer: '写作', checker: '审核' }
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

        {/* Image (user messages) */}
        {msg.image && (
          <img
            src={msg.image}
            alt="上传的图片"
            className="max-w-xs max-h-64 rounded-xl mb-1 object-contain border border-indigo-200"
          />
        )}

        {/* Content */}
        {msg.content && (
          <div
            className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed
              ${isUser
                ? 'bg-indigo-500 text-white rounded-tr-sm whitespace-pre-wrap'
                : 'bg-white border border-gray-100 shadow-sm text-gray-800 rounded-tl-sm'
              }`}
          >
            {isUser ? msg.content : <MathContent content={msg.content} />}
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

// ─── Progress panel ───────────────────────────────────────────────────────────
function ProgressPanel({ onClose }: { onClose: () => void }) {
  const [progress, setProgress] = useState<StudyProgress>({})
  const [docs, setDocs] = useState<DocMeta[]>([])

  useEffect(() => {
    setProgress(loadProgress())
    fetch('/api/documents').then(r => r.json()).then(setDocs).catch(() => {})
  }, [])

  const toggle = (num: number) => {
    setProgress(prev => {
      const cur = prev[num] ?? 'not_started'
      const next: ChapterStatus =
        cur === 'not_started' ? 'in_progress' :
        cur === 'in_progress' ? 'mastered' : 'not_started'
      const updated = { ...prev, [num]: next }
      saveProgress(updated)
      return updated
    })
  }

  const inKB = (num: number) =>
    docs.some(d => d.title.includes(`第${num}章`))

  const mastered  = CHAPTERS.filter(c => progress[c.num] === 'mastered').length
  const studying  = CHAPTERS.filter(c => progress[c.num] === 'in_progress').length
  const pct       = Math.round((mastered / CHAPTERS.length) * 100)
  const vols      = ['上册', '中册', '下册'] as const

  return (
    <div className="h-full flex flex-col bg-white border-r border-gray-200">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div className="flex items-center gap-2 font-semibold text-gray-800">
          <GraduationCap size={16} className="text-amber-500" />
          学习进度
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 text-gray-400">
          <X size={16} />
        </button>
      </div>

      {/* Overview */}
      <div className="px-4 py-3 border-b border-gray-100">
        <div className="flex justify-between text-xs text-gray-500 mb-1.5">
          <span>{mastered} / {CHAPTERS.length} 章已掌握</span>
          <span className="font-medium text-amber-600">{pct}%</span>
        </div>
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full bg-amber-400 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
        <div className="flex gap-3 mt-2 text-[11px] text-gray-400">
          {[
            { color: 'bg-amber-400', label: `${mastered} 已掌握` },
            { color: 'bg-blue-400',  label: `${studying} 学习中` },
            { color: 'bg-gray-200',  label: `${CHAPTERS.length - mastered - studying} 未开始` },
          ].map(s => (
            <span key={s.label} className="flex items-center gap-1">
              <span className={`w-2 h-2 rounded-full ${s.color}`} />
              {s.label}
            </span>
          ))}
        </div>
      </div>

      {/* Chapter list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {vols.map(vol => (
          <div key={vol}>
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5 px-1">
              梁灿彬 · {vol}
            </p>
            <div className="space-y-0.5">
              {CHAPTERS.filter(c => c.vol === vol).map(c => {
                const status = progress[c.num] ?? 'not_started'
                return (
                  <button
                    key={c.num}
                    onClick={() => toggle(c.num)}
                    title="点击切换：未开始 → 学习中 → 已掌握"
                    className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors ${
                      status === 'mastered'    ? 'bg-amber-50 hover:bg-amber-100' :
                      status === 'in_progress' ? 'bg-blue-50  hover:bg-blue-100'  :
                      'hover:bg-gray-50'
                    }`}
                  >
                    {/* Status dot */}
                    <span className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                      status === 'mastered'    ? 'bg-amber-400 text-white' :
                      status === 'in_progress' ? 'bg-blue-400  text-white' :
                      'bg-gray-100 text-gray-400'
                    }`}>
                      {status === 'mastered' ? '✓' : status === 'in_progress' ? '→' : c.num}
                    </span>

                    {/* Title */}
                    <span className={`flex-1 text-xs leading-snug ${
                      status === 'mastered'    ? 'text-gray-400 line-through' :
                      status === 'in_progress' ? 'text-blue-700 font-medium'  :
                      'text-gray-600'
                    }`}>
                      第{c.num}章 {c.title}
                    </span>

                    {/* KB badge */}
                    {inKB(c.num) && (
                      <span className="flex-shrink-0 text-[9px] bg-emerald-100 text-emerald-600 px-1.5 py-0.5 rounded-full font-medium">
                        已入库
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="px-4 py-2 border-t border-gray-100 text-[11px] text-gray-400 text-center">
        点击章节切换状态 · 绿色标签表示已上传知识库
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
  const [showProgress, setShowProgress] = useState(false)
  const [mode, setMode] = useState<Mode>('single')
  const [pendingImage, setPendingImage] = useState<string | null>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)

  const toggleDocs = () => { setShowDocs(v => !v); setShowProgress(false) }
  const toggleProgress = () => { setShowProgress(v => !v); setShowDocs(false) }

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    // Compress: resize to max 1024px, JPEG 85%
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const MAX = 1024
      const scale = Math.min(MAX / img.width, MAX / img.height, 1)
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      setPendingImage(canvas.toDataURL('image/jpeg', 0.85))
    }
    img.src = url
    if (imageInputRef.current) imageInputRef.current.value = ''
  }
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = async () => {
    const text = input.trim()
    if (!text || loading) return

    const image = pendingImage ?? undefined
    setPendingImage(null)

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      image,
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
      ...(m.image ? { image: m.image } : {}),
    }))

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history, mode, image }),
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
      {(showDocs || showProgress) && (
        <div className="w-80 flex-shrink-0">
          {showDocs     && <DocumentPanel onClose={toggleDocs} />}
          {showProgress && <ProgressPanel onClose={toggleProgress} />}
        </div>
      )}

      <div className="flex flex-col flex-1 min-w-0">
        {/* Header */}
        <header className="flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-100 shadow-sm">
          <button
            onClick={toggleDocs}
            className={`p-2 rounded-lg transition-colors ${showDocs ? 'bg-indigo-50 text-indigo-600' : 'hover:bg-gray-100 text-gray-500'}`}
            title="知识库"
          >
            <BookOpen size={18} />
          </button>
          <button
            onClick={toggleProgress}
            className={`p-2 rounded-lg transition-colors ${showProgress ? 'bg-amber-50 text-amber-600' : 'hover:bg-gray-100 text-gray-500'}`}
            title="学习进度"
          >
            <GraduationCap size={18} />
          </button>
          <div className="flex items-center gap-2">
            <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${mode === 'multi' ? 'bg-violet-600' : 'bg-indigo-500'}`}>
              {mode === 'multi' ? <Users size={14} className="text-white" /> : <Bot size={15} className="text-white" />}
            </div>
            <div>
              <h1 className="font-semibold text-gray-800 text-sm leading-none">RAG Agent</h1>
              <p className="text-xs text-gray-400 mt-0.5">
                {mode === 'multi' ? '规划 · 研究 · 写作 · 审核 · 四Agent协同' : '向量检索 · Tool Use · 流式输出'}
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
                    四个专业Agent各司其职：规划→研究→写作→审核，每个Agent只做自己份内的事。
                  </p>
                  <div className="mt-6 flex items-center gap-2 text-xs">
                    {[
                      { color: 'bg-violet-100 text-violet-700', label: '规划Agent', desc: '分析 · 规划' },
                      { color: 'bg-blue-100 text-blue-700', label: '研究Agent', desc: '搜索 · 计算' },
                      { color: 'bg-amber-100 text-amber-700', label: '写作Agent', desc: '组织 · 撰写' },
                      { color: 'bg-emerald-100 text-emerald-700', label: '审核Agent', desc: '核查 · 输出' },
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
          {/* Pending image preview */}
          {pendingImage && (
            <div className="relative inline-block mb-2 ml-1">
              <img src={pendingImage} alt="待发送" className="h-20 rounded-lg border border-indigo-200 object-contain" />
              <button
                onClick={() => setPendingImage(null)}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-gray-700 text-white rounded-full flex items-center justify-center hover:bg-red-500 transition-colors"
              >
                <X size={10} />
              </button>
            </div>
          )}

          <div className="flex gap-2 items-end max-w-4xl mx-auto">
            {/* Hidden image file input */}
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleImageSelect}
            />
            {/* Image upload button */}
            <button
              onClick={() => imageInputRef.current?.click()}
              disabled={loading}
              className={`flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-xl border transition-colors disabled:opacity-40 ${
                pendingImage
                  ? 'border-indigo-400 bg-indigo-50 text-indigo-600'
                  : 'border-gray-200 text-gray-400 hover:border-indigo-300 hover:text-indigo-500'
              }`}
              title="上传图片（教材截图、公式照片等）"
            >
              <ImagePlus size={16} />
            </button>
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
              ? 'DeepSeek-V3 · 规划 → 研究 → 写作 → 审核'
              : 'DeepSeek-V3 · BAAI/bge-m3 向量检索 · SiliconFlow'}
          </p>
        </div>
      </div>
    </div>
  )
}
