export interface Chunk {
  id: string
  docId: string
  docTitle: string
  content: string
  embedding: number[]
}

export interface Document {
  id: string
  title: string
  content: string
  chunks: Chunk[]
  createdAt: number
}

export interface ToolCallRecord {
  tool: string
  input: Record<string, unknown>
  output: string
}

export interface PlanTask {
  id: string
  description: string
  done: boolean
  result?: string
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolCalls?: ToolCallRecord[]
  timestamp: number
  // multi-agent fields
  agentPhase?: 'planner' | 'executor' | 'checker' | 'done'
  plan?: PlanTask[]
}

export type AgentEvent =
  | { type: 'tool_start'; tool: string; input: Record<string, unknown> }
  | { type: 'tool_end'; tool: string; output: string }
  | { type: 'text'; content: string }
  | { type: 'done' }
  | { type: 'error'; content: string }
  | { type: 'agent_start'; agent: 'planner' | 'executor' | 'checker'; description: string }
  | { type: 'plan'; tasks: Array<{ id: string; description: string }> }
  | { type: 'task_start'; taskId: string; description: string }
  | { type: 'task_result'; taskId: string; result: string }
