import type { Message, AgentManifest } from "./types"
import { parse_role } from "./types"
import type { Encoder } from "./wire"
import { get_system_prompt } from "./openai-adapter"
import type { AdapterResult } from "./openai-adapter"

// --- Ollama API types ---

interface OllamaToolCall {
  id?: string
  function: {
    name: string
    arguments: Record<string, unknown>
  }
}

interface OllamaMessage {
  role: "system" | "user" | "assistant" | "tool"
  content: string
  tool_calls?: OllamaToolCall[]
}

interface OllamaStreamChunk {
  model: string
  message: {
    role: string
    content: string
    tool_calls?: OllamaToolCall[]
  }
  done: boolean
  done_reason?: string
}

interface OllamaTool {
  type: "function"
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

// --- Message translation (Ollama-native format) ---

/**
 * Translate wire-format messages to Ollama's native chat format.
 *
 * Key differences from OpenAI:
 * - tool_call arguments are objects, not JSON strings
 * - tool result messages use role "tool" with no tool_call_id
 */
export function translate_messages(messages: Message[]): OllamaMessage[] {
  const translated: OllamaMessage[] = []

  for (const msg of messages) {
    const parsed = parse_role(msg.role)

    if (parsed.type === "system") continue

    if (parsed.type === "user") {
      translated.push({ role: "user", content: msg.content as string })
    } else if (parsed.type === "agent") {
      translated.push({ role: "assistant", content: msg.content as string })
    } else if (parsed.type === "process_call") {
      const tool_call: OllamaToolCall = {
        function: {
          name: parsed.identity!,
          arguments: msg.content as Record<string, unknown>,
        },
      }

      // Merge with previous assistant message if there is one
      const prev = translated[translated.length - 1]
      if (prev && prev.role === "assistant") {
        if (!prev.tool_calls) prev.tool_calls = []
        prev.tool_calls.push(tool_call)
      } else {
        translated.push({
          role: "assistant",
          content: "",
          tool_calls: [tool_call],
        })
      }
    } else if (parsed.type === "process_result") {
      translated.push({
        role: "tool",
        content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
      })
    }
  }

  return translated
}

/** Translate process declarations to Ollama tool format (same as OpenAI). */
export function translate_tools(manifest: AgentManifest): OllamaTool[] {
  return manifest.processes.map((proc) => ({
    type: "function" as const,
    function: {
      name: proc.name,
      description: proc.description,
      parameters: proc.input_schema,
    },
  }))
}

// --- Streaming ---

/** Read NDJSON lines from a streaming response body. */
async function* read_ndjson(body: ReadableStream<Uint8Array>): AsyncGenerator<OllamaStreamChunk> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        yield JSON.parse(trimmed) as OllamaStreamChunk
      } catch {
        // skip unparseable lines
      }
    }
  }

  if (buffer.trim()) {
    try {
      yield JSON.parse(buffer.trim()) as OllamaStreamChunk
    } catch {
      // skip
    }
  }
}

// --- Adapter ---

export async function call_ollama(
  input_messages: Message[],
  manifest: AgentManifest,
  encoder: Encoder,
): Promise<AdapterResult> {
  const opts = manifest.options?.ollama ?? {}
  const model = (opts.model as string) ?? "qwen3.5:35b-a3b"
  const base_url = (opts.base_url as string) ?? "http://localhost:11434"
  const think = (opts.think as boolean) ?? true
  const num_predict = (opts.num_predict as number) ?? 2048

  const translated = translate_messages(input_messages)
  const system = get_system_prompt(input_messages, manifest)
  const tools = translate_tools(manifest)

  const api_messages: OllamaMessage[] = system
    ? [{ role: "system" as const, content: system }, ...translated]
    : translated

  const body: Record<string, unknown> = {
    model,
    messages: api_messages,
    stream: true,
    think,
    options: { num_predict },
  }

  if (tools.length > 0) {
    body.tools = tools
  }

  const response = await fetch(`${base_url}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const error_text = await response.text()
    throw new Error(`Ollama API error (${response.status}): ${error_text}`)
  }

  if (!response.body) {
    throw new Error("Ollama API returned no response body")
  }

  const result_messages: Message[] = []
  let text_id: string | null = null
  let text_buf = ""

  for await (const chunk of read_ndjson(response.body)) {
    const msg = chunk.message

    // Tool calls — emitted on the final chunk
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      // Finalize any pending text first
      if (text_id && text_buf) {
        encoder.done(text_id, "agent", text_buf)
        result_messages.push({ id: text_id, role: "agent", content: text_buf, done: true })
        text_id = null
        text_buf = ""
      }

      for (const tc of msg.tool_calls) {
        const call_id = tc.id ?? `call_${encoder.next_id()}`
        const tool_name = tc.function.name
        const input = tc.function.arguments
        const msg_id = encoder.next_id()
        const role = `process_call:${tool_name}`

        encoder.done(msg_id, role, input, { call_id })
        result_messages.push({ id: msg_id, role, content: input, done: true, call_id })
      }
      continue
    }

    // Text content
    if (msg.content && !chunk.done) {
      if (!text_id) {
        text_id = encoder.next_id()
      }
      text_buf += msg.content
      encoder.delta(text_id, "agent", msg.content)
    }

    // Final chunk — finalize text
    if (chunk.done && text_id && text_buf) {
      encoder.done(text_id, "agent", text_buf)
      result_messages.push({ id: text_id, role: "agent", content: text_buf, done: true })
      text_id = null
      text_buf = ""
    }
  }

  // Safety: finalize any remaining text
  if (text_id && text_buf) {
    encoder.done(text_id, "agent", text_buf)
    result_messages.push({ id: text_id, role: "agent", content: text_buf, done: true })
  }

  return {
    messages: result_messages,
    stop_reason: "stop",
  }
}
