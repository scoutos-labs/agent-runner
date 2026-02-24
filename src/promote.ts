import type { Message } from "./types"
import { parse_role } from "./types"

export type PromoteResult =
  | { ok: true; messages: Message[] }
  | { ok: false; error: string }

/**
 * Ensure the message stream contains a user message.
 *
 * If a user message already exists, returns the stream unchanged.
 * In a chained stream (agent A | agent B), the input only has agent
 * messages. Promotes the last complete agent message to user so
 * downstream adapters find a goal.
 *
 * This preserves all other composition patterns (resume, fan-out, tee)
 * because those already contain user messages and this fallback never
 * activates.
 */
export function ensure_user_message(messages: Message[]): PromoteResult {
  if (messages.length === 0) {
    return { ok: false, error: "no messages in input" }
  }

  const has_user = messages.some(
    (msg) => msg.role && parse_role(msg.role).type === "user",
  )
  if (has_user) {
    return { ok: true, messages }
  }

  // Chained stream — promote last complete agent message to user
  const promoted = [...messages]
  for (let i = promoted.length - 1; i >= 0; i--) {
    const parsed = parse_role(promoted[i].role)
    if (parsed.type === "agent" && promoted[i].done && typeof promoted[i].content === "string") {
      promoted[i] = { ...promoted[i], role: "user" }
      return { ok: true, messages: promoted }
    }
  }

  return { ok: false, error: "no user or agent message found in input" }
}
