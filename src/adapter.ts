import type { Message, AgentManifest, ProcessDeclaration } from "./types"
import { parse_role } from "./types"

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
