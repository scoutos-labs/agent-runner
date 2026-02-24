import OpenAI from "openai"
import type { Message, AgentManifest, ProcessDeclaration } from "./types"
import { parse_role } from "./types"
import type { Encoder } from "./wire"

// --- OpenAI API types (subset) ---

interface OpenAITextMessage {
  role: "system" | "user" | "assistant"
  content: string | null
  tool_calls?: OpenAIToolCall[]
}

interface OpenAIToolMessage {
  role: "tool"
  tool_call_id: string
  content: string
}

interface OpenAIToolCall {
  id: string
  type: "function"
  function: {
    name: string
    arguments: string
  }
}

type OpenAIMessage = OpenAITextMessage | OpenAIToolMessage

interface OpenAITool {
  type: "function"
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

// --- Translation functions ---

/**
 * Translate spec messages to OpenAI API format.
 * Filters out system messages (handled by get_system_prompt).
 * Merges adjacent agent text + process_call into a single assistant message.
 */
export function translate_messages(messages: Message[]): OpenAIMessage[] {
  const translated: OpenAIMessage[] = []

  for (const msg of messages) {
    const parsed = parse_role(msg.role)

    // Skip system messages — handled by get_system_prompt
    if (parsed.type === "system") continue

    if (parsed.type === "user") {
      translated.push({ role: "user", content: msg.content as string })
    } else if (parsed.type === "agent") {
      translated.push({ role: "assistant", content: msg.content as string })
    } else if (parsed.type === "process_call") {
      const tool_call: OpenAIToolCall = {
        id: msg.call_id!,
        type: "function",
        function: {
          name: parsed.identity!,
          arguments: JSON.stringify(msg.content),
        },
      }

      // Merge with previous assistant message if there is one
      const prev = translated[translated.length - 1]
      if (prev && prev.role === "assistant" && !("tool_call_id" in prev)) {
        const text_msg = prev as OpenAITextMessage
        if (!text_msg.tool_calls) {
          text_msg.tool_calls = []
        }
        text_msg.tool_calls.push(tool_call)
      } else {
        translated.push({
          role: "assistant",
          content: null,
          tool_calls: [tool_call],
        })
      }
    } else if (parsed.type === "process_result") {
      translated.push({
        role: "tool",
        tool_call_id: msg.call_id!,
        content: msg.content as string,
      })
    }
  }

  return translated
}

/**
 * Translate process declarations to OpenAI tool format.
 */
export function translate_tools(manifest: AgentManifest): OpenAITool[] {
  return manifest.processes.map((proc: ProcessDeclaration) => ({
    type: "function" as const,
    function: {
      name: proc.name,
      description: proc.description,
      parameters: proc.input_schema,
    },
  }))
}

/**
 * Extract system prompt from manifest and input messages.
 * Manifest system field comes first, then any system role messages.
 */
export function get_system_prompt(messages: Message[], manifest: AgentManifest): string {
  const parts: string[] = []

  if (manifest.system) {
    parts.push(manifest.system)
  }

  for (const msg of messages) {
    const parsed = parse_role(msg.role)
    if (parsed.type === "system" && typeof msg.content === "string") {
      parts.push(msg.content)
    }
  }

  return parts.join("\n\n")
}

// --- Streaming API call ---

export interface AdapterResult {
  messages: Message[]
  stop_reason: string | null
}

export async function call_llm(
  input_messages: Message[],
  manifest: AgentManifest,
  encoder: Encoder,
): Promise<AdapterResult> {
  const opts = manifest.options?.openai ?? {}
  const client = new OpenAI()
  const translated = translate_messages(input_messages)
  const system = get_system_prompt(input_messages, manifest)
  const tools = translate_tools(manifest)
  const model = (opts.model as string) ?? "gpt-4o"
  const max_tokens = (opts.max_tokens as number) ?? 4096
  const temperature = opts.temperature as number | undefined

  // Prepend system message if present
  const api_messages: OpenAIMessage[] = system
    ? [{ role: "system" as const, content: system }, ...translated]
    : translated

  const stream = await client.chat.completions.create({
    model,
    messages: api_messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    tools: tools as OpenAI.Chat.Completions.ChatCompletionTool[],
    max_tokens,
    ...(temperature !== undefined && { temperature }),
    stream: true,
  })

  const result_messages: Message[] = []

  // Track current text message
  let text_id: string | null = null
  let text_buf = ""

  // Track tool calls by index
  const tool_ids: Map<number, string> = new Map()       // index → tool_call.id
  const tool_names: Map<number, string> = new Map()      // index → function name
  const tool_arg_bufs: Map<number, string> = new Map()   // index → accumulated arguments JSON

  let finish_reason: string | null = null

  for await (const chunk of stream) {
    const choice = chunk.choices[0]
    if (!choice) continue

    const delta = choice.delta

    // Text content
    if (delta?.content) {
      if (!text_id) {
        text_id = encoder.next_id()
      }
      text_buf += delta.content
      encoder.delta(text_id, "agent", delta.content)
    }

    // Tool calls
    if (delta?.tool_calls) {
      // If we had text before tool calls, finalize it
      if (text_id && text_buf) {
        encoder.done(text_id, "agent", text_buf)
        result_messages.push({
          id: text_id,
          role: "agent",
          content: text_buf,
          done: true,
        })
        text_id = null
        text_buf = ""
      }

      for (const tc of delta.tool_calls) {
        const idx = tc.index

        // First chunk for this tool call — has id and name
        if (tc.id) {
          tool_ids.set(idx, tc.id)
        }
        if (tc.function?.name) {
          tool_names.set(idx, tc.function.name)
        }
        if (tc.function?.arguments) {
          tool_arg_bufs.set(idx, (tool_arg_bufs.get(idx) ?? "") + tc.function.arguments)
        }
      }
    }

    if (choice.finish_reason) {
      finish_reason = choice.finish_reason
    }
  }

  // Finalize any remaining text
  if (text_id && text_buf) {
    encoder.done(text_id, "agent", text_buf)
    result_messages.push({
      id: text_id,
      role: "agent",
      content: text_buf,
      done: true,
    })
  }

  // Finalize tool calls
  for (const [idx, call_id] of tool_ids.entries()) {
    const tool_name = tool_names.get(idx) ?? "unknown"
    const arg_buf = tool_arg_bufs.get(idx) ?? "{}"
    const input = JSON.parse(arg_buf)
    const msg_id = encoder.next_id()
    const role = `process_call:${tool_name}`

    encoder.done(msg_id, role, input, { call_id })
    result_messages.push({
      id: msg_id,
      role,
      content: input,
      done: true,
      call_id,
    })
  }

  return {
    messages: result_messages,
    stop_reason: finish_reason,
  }
}
