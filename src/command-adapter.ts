import type { Message, CommandAdapterConfig } from "./types"
import type { Encoder } from "./wire"
import { translate_event } from "./claude-code-adapter"

export interface CommandResult {
  messages: Message[]
  exit_code: number
}

/** Serialize messages as JSONL for piping to subprocess stdin. */
function serialize_messages(messages: Message[]): string {
  return messages.map((m) => JSON.stringify(m)).join("\n") + "\n"
}

/**
 * Run a command-based adapter as a subprocess.
 * Pipes input messages to stdin (as JSONL), reads output, translates if needed.
 */
export async function run_command_adapter(
  config: CommandAdapterConfig,
  encoder: Encoder,
  input_messages?: Message[],
): Promise<CommandResult> {
  const stdin_data = input_messages ? serialize_messages(input_messages) : undefined

  const proc = Bun.spawn(config.cmd, {
    stdin: stdin_data ? new Blob([stdin_data]) : undefined,
    stdout: "pipe",
    stderr: "pipe",
  })

  const stderr_promise = new Response(proc.stderr).text()
  const result_messages: Message[] = []

  if (config.output_format === "claude-code-stream-json") {
    const tool_name_map = new Map<string, string>()
    for await (const line of read_lines(proc.stdout)) {
      try {
        const event = JSON.parse(line) as Record<string, unknown>
        const msgs = translate_event(event, encoder, tool_name_map)
        result_messages.push(...msgs)
      } catch {
        // Skip unparseable lines
      }
    }
  } else {
    // Wire format — forward each line to stdout, collect done messages
    for await (const line of read_lines(proc.stdout)) {
      process.stdout.write(line + "\n")
      try {
        const msg = JSON.parse(line) as Message
        if (msg.done) result_messages.push(msg)
      } catch {
        // Non-JSON line, already forwarded
      }
    }
  }

  const stderr = await stderr_promise
  if (stderr) console.error(`[${config.name}]`, stderr)

  await proc.exited
  const exit_code = proc.exitCode ?? 1

  return { messages: result_messages, exit_code }
}

/** Read lines from a ReadableStream, yielding each non-empty trimmed line. */
export async function* read_lines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader()
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
      if (trimmed) yield trimmed
    }
  }

  if (buffer.trim()) yield buffer.trim()
}
