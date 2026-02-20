import type { Message } from "./types"

export interface Writer {
  write(chunk: string): void
}

export interface Encoder {
  next_id(): string
  delta(id: string, role: string, text: string): void
  done(id: string, role: string, content: string | Record<string, unknown>, extra?: Record<string, unknown>): void
}

export async function decode_stdin(): Promise<Message[]> {
  const text = await Bun.stdin.text()
  if (!text.trim()) return []

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
