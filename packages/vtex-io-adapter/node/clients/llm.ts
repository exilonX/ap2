import { ExternalClient, IOContext, InstanceOptions } from '@vtex/api'

// ─── Types ─────────────────────────────────────────────────────

export type LLMProvider = 'claude' | 'openai' | 'gemini'

export interface LLMSettings {
  provider: LLMProvider
  apiKey: string
  model?: string
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
  // Optional structured fields. Claude/OpenAI clients ignore them and use
  // text content as before. GeminiClient uses them to emit proper
  // functionCall / functionResponse parts so tool-calling stays well-formed.
  toolCalls?: LLMToolCall[]
  toolResults?: Array<{ name: string; result: string }>
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
  gemini: 'gemini-2.5-flash',
}

function getHttpStatus(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null) {
    const e = error as { response?: { status?: number }; status?: number; statusCode?: number }

    return e.response?.status ?? e.status ?? e.statusCode
  }

  return undefined
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

    // Prompt caching: system prompt + tool defs are identical across turns and
    // across the tool-loop rounds within a single turn. Marking them with
    // cache_control gives a 5-min TTL cache that costs ~10% on hits.
    // We get up to 4 cache breakpoints; we use 2 (system + last tool).
    if (systemMessage) {
      body.system = [
        {
          type: 'text',
          text: systemMessage.content,
          cache_control: { type: 'ephemeral' },
        },
      ]
    }

    if (tools && tools.length > 0) {
      const mapped = tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }))

      // Tag the LAST tool — Anthropic caches all tool defs up to and including
      // the marked one. So one breakpoint covers the entire tools array.
      const lastIdx = mapped.length - 1

      mapped[lastIdx] = {
        ...mapped[lastIdx],
        cache_control: { type: 'ephemeral' },
      } as typeof mapped[number] & { cache_control: { type: string } }

      body.tools = mapped
    }

    const response = await this.postWithRetry(body)

    // Log every call so we can verify caching is working (or not)
    const u = response.usage
    const cacheRead = u.cache_read_input_tokens ?? 0
    const cacheWrite = u.cache_creation_input_tokens ?? 0

    console.log(
      `[ACG LLM] tokens — input:${u.input_tokens} cache_read:${cacheRead} cache_write:${cacheWrite} output:${u.output_tokens}`
    )

    return this.parseClaudeResponse(response)
  }

  private async postWithRetry(body: Record<string, unknown>): Promise<ClaudeAPIResponse> {
    // Anthropic 429s on burst tool-loops. Retry with exponential backoff.
    // 5xx are also retryable (transient API issues).
    const delays = [400, 1200, 3000] // ms — total worst-case wait ~4.6s

    let lastError: unknown

    for (let attempt = 0; attempt <= delays.length; attempt++) {
      try {
        return await this.http.post<ClaudeAPIResponse>('/v1/messages', body, {
          metric: 'acg-claude-chat',
        })
      } catch (error) {
        lastError = error
        const status = getHttpStatus(error)
        const retryable = status === 429 || (status !== undefined && status >= 500 && status < 600)

        if (!retryable || attempt === delays.length) {
          throw error
        }

        console.warn(`[ACG LLM] Anthropic ${status} — retrying in ${delays[attempt]}ms (attempt ${attempt + 1}/${delays.length})`)
        await new Promise((r) => setTimeout(r, delays[attempt]))
      }
    }

    throw lastError
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

// ─── Gemini Client ──────────────────────────────────────────────

export class GeminiClient extends ExternalClient {
  private model: string
  private apiKey: string

  constructor(context: IOContext, options: InstanceOptions & { apiKey: string; model?: string }) {
    super('https://generativelanguage.googleapis.com', context, {
      ...options,
      headers: {
        ...options?.headers,
        'Content-Type': 'application/json',
      },
      timeout: 25000,
    })
    this.apiKey = options.apiKey
    this.model = options.model || DEFAULT_MODELS.gemini
  }

  public async chat(
    messages: LLMMessage[],
    tools?: LLMTool[],
    maxTokens: number = 1024
  ): Promise<LLMResponse> {
    const systemMessage = messages.find((m) => m.role === 'system')
    const conversation = messages.filter((m) => m.role !== 'system')

    // Translate our flat (role, content) messages into Gemini's typed parts.
    // Tool results we sent as user text "[Tool result for X]: ..." become
    // proper functionResponse parts so Gemini can reason about them.
    const contents = conversation.map((m) => mapMessageToGeminiContent(m))

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        maxOutputTokens: maxTokens,
        // Gemini 2.5 Flash uses "thinking" tokens by default — these count
        // against maxOutputTokens, leaving little room for actual output.
        // For commerce chat we don't need long internal reasoning; disable
        // thinking entirely so output:N tokens means N tokens of real output.
        thinkingConfig: { thinkingBudget: 0 },
      },
    }

    if (systemMessage) {
      body.systemInstruction = { parts: [{ text: systemMessage.content }] }
    }

    if (tools && tools.length > 0) {
      body.tools = [
        {
          functionDeclarations: tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: cleanSchemaForGemini(t.parameters),
          })),
        },
      ]
    }

    const response = await this.postWithRetry(body)

    const u = response.usageMetadata
    const finishReason = response.candidates?.[0]?.finishReason ?? 'NONE'
    const partsCount = response.candidates?.[0]?.content?.parts?.length ?? 0

    if (u) {
      console.log(
        `[ACG LLM] tokens — input:${u.promptTokenCount ?? 0} cached:${u.cachedContentTokenCount ?? 0} output:${u.candidatesTokenCount ?? 0} finish:${finishReason} parts:${partsCount}`
      )
    }

    // Surface unusual finish reasons so we know when Gemini blocked output
    if (finishReason !== 'STOP' && finishReason !== 'MAX_TOKENS' && finishReason !== 'NONE') {
      console.warn(`[ACG LLM] Gemini returned non-standard finishReason: ${finishReason}`)
    }

    return parseGeminiResponse(response)
  }

  private async postWithRetry(body: Record<string, unknown>): Promise<GeminiAPIResponse> {
    // Gemini hits 503 ("model overloaded") and 429 ("quota exceeded") regularly.
    // Retry with exponential backoff like we do for Anthropic.
    const path = `/v1beta/models/${this.model}:generateContent?key=${encodeURIComponent(this.apiKey)}`
    const delays = [400, 1200, 3000] // ms — total worst-case wait ~4.6s

    let lastError: unknown

    for (let attempt = 0; attempt <= delays.length; attempt++) {
      try {
        return await this.http.post<GeminiAPIResponse>(path, body, {
          metric: 'acg-gemini-chat',
        })
      } catch (error) {
        lastError = error
        const status = getHttpStatus(error)
        const retryable = status === 429 || (status !== undefined && status >= 500 && status < 600)

        if (!retryable || attempt === delays.length) {
          throw error
        }

        console.warn(`[ACG LLM] Gemini ${status} — retrying in ${delays[attempt]}ms (attempt ${attempt + 1}/${delays.length})`)
        await new Promise((r) => setTimeout(r, delays[attempt]))
      }
    }

    throw lastError
  }
}

// ─── Gemini helpers ─────────────────────────────────────────────

function mapMessageToGeminiContent(m: LLMMessage): { role: 'user' | 'model'; parts: GeminiPart[] } {
  const role = m.role === 'assistant' ? 'model' : 'user'
  const parts: GeminiPart[] = []

  // Structured tool results from chat.ts → emit only functionResponse parts.
  // The text content for these messages is just bracketed boilerplate that
  // Claude/OpenAI need; Gemini gets it cleaner via functionResponse.
  if (m.toolResults && m.toolResults.length > 0) {
    for (const tr of m.toolResults) {
      parts.push({
        functionResponse: {
          name: tr.name,
          response: { result: tr.result },
        },
      })
    }

    return { role: 'user', parts }
  }

  // Regular text content (user message, assistant text, tool error fallback)
  if (m.content) {
    parts.push({ text: m.content })
  }

  // Assistant tool calls → functionCall parts alongside any text
  if (m.toolCalls && m.toolCalls.length > 0) {
    for (const tc of m.toolCalls) {
      parts.push({
        functionCall: {
          name: tc.name,
          args: tc.arguments,
        },
      })
    }
  }

  // Gemini rejects parts:[] — give it an empty text part if we got nothing
  if (parts.length === 0) {
    parts.push({ text: '' })
  }

  return { role, parts }
}

// Gemini doesn't accept some JSON-Schema dialect features (e.g. `additionalProperties`,
// `$schema`). Strip them defensively.
function cleanSchemaForGemini(schema: Record<string, unknown>): Record<string, unknown> {
  const blocked = new Set(['additionalProperties', '$schema', '$id', '$ref', 'definitions'])
  const out: Record<string, unknown> = {}

  for (const [k, v] of Object.entries(schema)) {
    if (blocked.has(k)) continue

    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = cleanSchemaForGemini(v as Record<string, unknown>)
    } else if (Array.isArray(v)) {
      out[k] = v.map((item) =>
        item !== null && typeof item === 'object'
          ? cleanSchemaForGemini(item as Record<string, unknown>)
          : item
      )
    } else {
      out[k] = v
    }
  }

  return out
}

function parseGeminiResponse(response: GeminiAPIResponse): LLMResponse {
  const candidate = response.candidates?.[0]

  if (!candidate) {
    return { content: null, toolCalls: [], finishReason: 'stop' }
  }

  let content: string | null = null
  const toolCalls: LLMToolCall[] = []

  for (const part of candidate.content?.parts ?? []) {
    if ('text' in part && part.text) {
      content = (content || '') + part.text
    } else if ('functionCall' in part && part.functionCall) {
      toolCalls.push({
        id: `gemini_${Math.random().toString(36).slice(2, 10)}`,
        name: part.functionCall.name,
        arguments: (part.functionCall.args ?? {}) as Record<string, unknown>,
      })
    }
  }

  const finishReason: LLMResponse['finishReason'] =
    candidate.finishReason === 'MAX_TOKENS'
      ? 'length'
      : toolCalls.length > 0
        ? 'tool_use'
        : 'stop'

  return { content, toolCalls, finishReason }
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
  usage: {
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
  }
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

// ─── Gemini types ───────────────────────────────────────────────

type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args?: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } }

interface GeminiAPIResponse {
  candidates?: Array<{
    content?: { role: 'model'; parts: GeminiPart[] }
    finishReason?: 'STOP' | 'MAX_TOKENS' | 'SAFETY' | 'RECITATION' | 'OTHER'
  }>
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    totalTokenCount?: number
    cachedContentTokenCount?: number
  }
}
