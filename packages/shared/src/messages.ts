export type AgentMessageType =
  | 'assistant'
  | 'user'
  | 'result'
  | 'system'
  | 'stream_event'
  | 'tool_progress'
  | 'tool_use_summary'
  | 'auth_status'
  | 'rate_limit_event'

export type SystemSubtype =
  | 'init'
  | 'status'
  | 'session_state_changed'
  | 'compact_boundary'
  | 'api_retry'
  | 'task_started'
  | 'task_progress'
  | 'task_notification'
  | 'hook_started'
  | 'hook_progress'
  | 'hook_response'
  | 'files_persisted'
  | 'elicitation_complete'
  | 'local_command_output'

export type ResultSubtype =
  | 'success'
  | 'error_during_execution'
  | 'error_max_turns'
  | 'error_max_budget_usd'
  | 'error_max_structured_output_retries'

export type ContentBlockType =
  | 'text'
  | 'thinking'
  | 'redacted_thinking'
  | 'tool_use'
  | 'tool_result'
  | 'server_tool_use'
  | 'web_search_tool_result'
  | 'code_execution_tool_result'
  | 'image'

export interface AgentMessage {
  type: AgentMessageType
  subtype?: string
  session_id?: string
  uuid?: string
  _partial?: boolean  // Marks partial assistant messages (mid-stream state from SDK)
  [key: string]: unknown
}
