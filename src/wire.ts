import type { Message } from "./types"

export interface Writer {
  write(chunk: string): void
}

export interface Encoder {
  next_id(): string
  delta(id: string, role: string, text: string): void
  done(id: string, role: string, content: string | Record<string, unknown>, extra?: Record<string, unknown>): void
}

/**
 * Parse raw input text — auto-detects JSONL vs bare text.
 *
 * If the first non-blank line is valid JSON with a `role` field,
 * the entire input is parsed as JSONL messages. Otherwise the full
 * text is wrapped as a single user message.
 */
export function parse_input(text: string): Message[] {
  if (!text.trim()) return []

  const first_line = text.split("\n").find((l) => l.trim())
  if (!first_line) return []

  let is_jsonl = false
  try {
    const parsed = JSON.parse(first_line.trim())
    is_jsonl = parsed && typeof parsed === "object" && "role" in parsed
  } catch {
    is_jsonl = false
  }

  if (!is_jsonl) {
    return [{ role: "user", content: text.trim() }]
  }

  const messages: Message[] = []
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      messages.push(JSON.parse(trimmed) as Message)
    } catch {
      console.error(`agent-runner: skipping invalid JSON line: ${trimmed}`)
    }
  }
  return messages
}

export async function decode_stdin(): Promise<Message[]> {
  const text = await Bun.stdin.text()
  return parse_input(text)
}

export function create_encoder(writer: Writer): Encoder {
  let counter = 0

  return {
    next_id(): string {
      counter++
      return `msg_${counter}`
    },

    delta(id: string, role: string, text: string): void {
      writer.write(JSON.stringify({ id, role, delta: text }) + "\n")
    },

    done(id: string, role: string, content: string | Record<string, unknown>, extra?: Record<string, unknown>): void {
      const line: Record<string, unknown> = { id, role, done: true, content }
      if (extra) {
        Object.assign(line, extra)
      }
      writer.write(JSON.stringify(line) + "\n")
    },
  }
}
