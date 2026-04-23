import { ExternalClient, IOContext, InstanceOptions } from '@vtex/api'

// ─── Types ─────────────────────────────────────────────────────

export type LLMProvider = 'claude' | 'openai'

export interface LLMSettings {
  provider: LLMProvider
  apiKey: string
  model?: string
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LLMTool {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface LLMToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface LLMResponse {
  content: string | null
  toolCalls: LLMToolCall[]
  finishReason: 'stop' | 'tool_use' | 'end_turn' | 'length'
}

// ─── Default models per provider ────────────────────────────────

const DEFAULT_MODELS: Record<LLMProvider, string> = {
  claude: 'claude-haiku-4-5-20251001',
  openai: 'gpt-4o-mini',
}

// ─── Claude Client ──────────────────────────────────────────────

export class ClaudeClient extends ExternalClient {
  private model: string

  constructor(context: IOContext, options: InstanceOptions & { apiKey: string; model?: string }) {
    super('https://api.anthropic.com', context, {
      ...options,
      headers: {
        ...options?.headers,
        'Content-Type': 'application/json',
        'x-api-key': options.apiKey,
        'anthropic-version': '2023-06-01',
      },
      timeout: 25000,
    })
    this.model = options.model || DEFAULT_MODELS.claude
  }

  public async chat(
    messages: LLMMessage[],
    tools?: LLMTool[],
    maxTokens: number = 1024
  ): Promise<LLMResponse> {
    const systemMessage = messages.find((m) => m.role === 'system')
    const conversationMessages = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content }))

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: maxTokens,
      messages: conversationMessages,
    }

    if (systemMessage) {
      body.system = systemMessage.content
    }

    if (tools && tools.length > 0) {
      body.tools = tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }))
    }

    const response = await this.http.post<ClaudeAPIResponse>(
      '/v1/messages',
      body,
      { metric: 'acg-claude-chat' }
    )

    return this.parseClaudeResponse(response)
  }

  private parseClaudeResponse(response: ClaudeAPIResponse): LLMResponse {
    let content: string | null = null
    const toolCalls: LLMToolCall[] = []

    for (const block of response.content) {
      if (block.type === 'text') {
        content = (content || '') + block.text
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input as Record<string, unknown>,
        })
      }
    }

    const finishReason = response.stop_reason === 'tool_use' ? 'tool_use' : 'stop'

    return { content, toolCalls, finishReason }
  }
}

// ─── OpenAI Client ──────────────────────────────────────────────

export class OpenAIClient extends ExternalClient {
  private model: string

  constructor(context: IOContext, options: InstanceOptions & { apiKey: string; model?: string }) {
    super('https://api.openai.com', context, {
      ...options,
      headers: {
        ...options?.headers,
        'Content-Type': 'application/json',
        Authorization: `Bearer ${options.apiKey}`,
      },
      timeout: 25000,
    })
    this.model = options.model || DEFAULT_MODELS.openai
  }

  public async chat(
    messages: LLMMessage[],
    tools?: LLMTool[],
    maxTokens: number = 1024
  ): Promise<LLMResponse> {
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: maxTokens,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    }

    if (tools && tools.length > 0) {
      body.tools = tools.map((t) => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }))
    }

    const response = await this.http.post<OpenAIAPIResponse>(
      '/v1/chat/completions',
      body,
      { metric: 'acg-openai-chat' }
    )

    return this.parseOpenAIResponse(response)
  }

  private parseOpenAIResponse(response: OpenAIAPIResponse): LLMResponse {
    const choice = response.choices[0]
    const message = choice.message
    const toolCalls: LLMToolCall[] = []

    if (message.tool_calls) {
      for (const tc of message.tool_calls) {
        toolCalls.push({
          id: tc.id,
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments),
        })
      }
    }

    const finishReason = choice.finish_reason === 'tool_calls' ? 'tool_use' : 'stop'

    return {
      content: message.content,
      toolCalls,
      finishReason,
    }
  }
}

// ─── API Response Types ─────────────────────────────────────────

interface ClaudeAPIResponse {
  id: string
  type: 'message'
  role: 'assistant'
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: unknown }
  >
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence'
  usage: { input_tokens: number; output_tokens: number }
}

interface OpenAIAPIResponse {
  id: string
  choices: Array<{
    index: number
    message: {
      role: 'assistant'
      content: string | null
      tool_calls?: Array<{
        id: string
        type: 'function'
        function: {
          name: string
          arguments: string
        }
      }>
    }
    finish_reason: 'stop' | 'tool_calls' | 'length'
  }>
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
}
