import type { Message, AgentManifest } from "./types"
import { parse_role } from "./types"
import type { Encoder } from "./wire"

/** Extract the last user message from the stream as the prompt. */
export function build_prompt(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const parsed = parse_role(messages[i].role)
    if (parsed.type === "user" && typeof messages[i].content === "string") {
      return messages[i].content as string
    }
  }
  return ""
}

/** Combine manifest system prompt and stream system messages. */
export function build_system_prompt(messages: Message[], manifest: AgentManifest): string {
  const parts: string[] = []
  if (manifest.system) parts.push(manifest.system)
  for (const msg of messages) {
    if (parse_role(msg.role).type === "system" && typeof msg.content === "string") {
      parts.push(msg.content)
    }
  }
  return parts.join("\n\n")
}

/**
 * Translate a single Claude Code stream-json event into agent-runner
 * wire format messages. Returns an empty array for events we skip
 * (system init, result metadata).
 */
export function translate_event(
  event: Record<string, unknown>,
  encoder: Encoder,
  tool_name_map: Map<string, string>,
): Message[] {
  const messages: Message[] = []
  const event_type = event.type as string

  if (event_type === "assistant") {
    const msg = event.message as Record<string, unknown> | undefined
    const content_blocks = msg?.content as Array<Record<string, unknown>> | undefined
    if (!content_blocks) return messages

    for (const block of content_blocks) {
      if (block.type === "text" && typeof block.text === "string") {
        const id = encoder.next_id()
        encoder.done(id, "agent", block.text)
        messages.push({ id, role: "agent", content: block.text, done: true })
      } else if (block.type === "tool_use") {
        const tool_use_id = block.id as string
        const tool_name = (block.name as string).toLowerCase()
        const input = block.input as Record<string, unknown>

        tool_name_map.set(tool_use_id, tool_name)

        const id = encoder.next_id()
        const role = `process_call:${tool_name}`
        encoder.done(id, role, input, { call_id: tool_use_id })
        messages.push({ id, role, content: input, done: true, call_id: tool_use_id })
      }
    }
  } else if (event_type === "user") {
    const msg = event.message as Record<string, unknown> | undefined
    const content_blocks = msg?.content as Array<Record<string, unknown>> | undefined
    if (!content_blocks) return messages

    for (const block of content_blocks) {
      if (block.type === "tool_result") {
        const tool_use_id = block.tool_use_id as string
        const tool_name = tool_name_map.get(tool_use_id) ?? "unknown"
        const content = typeof block.content === "string"
          ? block.content
          : JSON.stringify(block.content)
        const is_error = block.is_error as boolean | undefined
        const exit_code = is_error ? 1 : 0

        const id = encoder.next_id()
        const role = `process_result:${tool_name}`
        encoder.done(id, role, content, { call_id: tool_use_id, exit_code })
        messages.push({ id, role, content, done: true, call_id: tool_use_id, exit_code })
      }
    }
  }

  // system and result events produce no wire output
  return messages
}
