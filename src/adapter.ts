import Anthropic from "@anthropic-ai/sdk"
import type { Message, AgentManifest, ProcessDeclaration } from "./types"
import { parse_role } from "./types"
import type { Encoder } from "./wire"

// --- Anthropic API types (subset) ---

interface AnthropicTextBlock {
  type: "text"
  text: string
}

interface AnthropicToolUseBlock {
  type: "tool_use"
  id: string
  name: string
  input: Record<string, unknown>
}

interface AnthropicToolResultBlock {
  type: "tool_result"
  tool_use_id: string
  content: string
}

type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock | AnthropicToolResultBlock

interface AnthropicMessage {
  role: "user" | "assistant"
  content: string | AnthropicContentBlock[]
}

interface AnthropicTool {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

// --- Translation functions ---

/**
 * Translate spec messages to Anthropic API format.
 * Filters out system messages. Merges adjacent same-role messages.
 */
export function translate_messages(messages: Message[]): AnthropicMessage[] {
  const translated: AnthropicMessage[] = []

  for (const msg of messages) {
    const parsed = parse_role(msg.role)

    // Skip system messages — handled by get_system_prompt
    if (parsed.type === "system") continue

    let anthropic_role: "user" | "assistant"
    let content_blocks: AnthropicContentBlock[]

    if (parsed.type === "user") {
      anthropic_role = "user"
      content_blocks = [{ type: "text", text: msg.content as string }]
    } else if (parsed.type === "agent") {
      anthropic_role = "assistant"
      content_blocks = [{ type: "text", text: msg.content as string }]
    } else if (parsed.type === "process_call") {
      anthropic_role = "assistant"
      content_blocks = [{
        type: "tool_use",
        id: msg.id!,
        name: parsed.identity!,
        input: msg.content as Record<string, unknown>,
      }]
    } else if (parsed.type === "process_result") {
      anthropic_role = "user"
      content_blocks = [{
        type: "tool_result",
        tool_use_id: msg.call_id!,
        content: msg.content as string,
      }]
    } else {
      continue
    }

    // Merge with previous message if same Anthropic role
    const prev = translated[translated.length - 1]
    if (prev && prev.role === anthropic_role) {
      // Normalize previous content to blocks array if it's a string
      if (typeof prev.content === "string") {
        prev.content = [{ type: "text", text: prev.content }]
      }
      prev.content.push(...content_blocks)
    } else {
      translated.push({ role: anthropic_role, content: content_blocks })
    }
  }

  // Simplify single text block messages back to plain strings
  for (const msg of translated) {
    if (
      Array.isArray(msg.content) &&
      msg.content.length === 1 &&
      msg.content[0].type === "text"
    ) {
      msg.content = (msg.content[0] as AnthropicTextBlock).text
    }
  }

  return translated
}

/**
 * Translate process declarations to Anthropic tool format.
 */
export function translate_tools(manifest: AgentManifest): AnthropicTool[] {
  return manifest.processes.map((proc: ProcessDeclaration) => ({
    name: proc.name,
    description: proc.description,
    input_schema: proc.input_schema,
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
  const client = new Anthropic()
  const translated = translate_messages(input_messages)
  const system = get_system_prompt(input_messages, manifest)
  const tools = translate_tools(manifest)
  const model = manifest.model ?? "claude-sonnet-4-5-20250514"

  const stream = client.messages.stream({
    model,
    max_tokens: 4096,
    system: system || undefined,
    messages: translated,
    tools,
  })

  const result_messages: Message[] = []

  // Track state per content block by index
  const block_ids: Map<number, string> = new Map()
  const block_texts: Map<number, string> = new Map()
  const block_json_bufs: Map<number, string> = new Map()
  const block_tool_names: Map<number, string> = new Map()
  const block_tool_ids: Map<number, string> = new Map()

  for await (const event of stream) {
    if (event.type === "content_block_start") {
      const idx = event.index
      const block = event.content_block

      if (block.type === "text") {
        const id = encoder.next_id()
        block_ids.set(idx, id)
        block_texts.set(idx, "")
      } else if (block.type === "tool_use") {
        const id = encoder.next_id()
        block_ids.set(idx, id)
        block_json_bufs.set(idx, "")
        block_tool_names.set(idx, block.name)
        block_tool_ids.set(idx, block.id)
      }
    } else if (event.type === "content_block_delta") {
      const idx = event.index

      if (event.delta.type === "text_delta") {
        const id = block_ids.get(idx)!
        const text = event.delta.text
        block_texts.set(idx, (block_texts.get(idx) ?? "") + text)
        encoder.delta(id, "agent", text)
      } else if (event.delta.type === "input_json_delta") {
        block_json_bufs.set(
          idx,
          (block_json_bufs.get(idx) ?? "") + event.delta.partial_json,
        )
      }
    } else if (event.type === "content_block_stop") {
      const idx = event.index
      const id = block_ids.get(idx)

      if (id && block_texts.has(idx)) {
        // Text block complete
        const full_text = block_texts.get(idx)!
        encoder.done(id, "agent", full_text)
        result_messages.push({
          id,
          role: "agent",
          content: full_text,
          done: true,
        })
      } else if (id && block_json_bufs.has(idx)) {
        // Tool use block complete
        const tool_name = block_tool_names.get(idx)!
        const tool_id = block_tool_ids.get(idx)!
        const json_buf = block_json_bufs.get(idx)!
        const input = json_buf ? JSON.parse(json_buf) : {}
        const role = `process_call:${tool_name}`
        encoder.done(id, role, input, { call_id: tool_id })
        result_messages.push({
          id,
          role,
          content: input,
          done: true,
          call_id: tool_id,
        })
      }

      // Clean up maps for this index
      block_ids.delete(idx)
      block_texts.delete(idx)
      block_json_bufs.delete(idx)
      block_tool_names.delete(idx)
      block_tool_ids.delete(idx)
    }
  }

  const final_message = await stream.finalMessage()

  return {
    messages: result_messages,
    stop_reason: final_message.stop_reason,
  }
}
