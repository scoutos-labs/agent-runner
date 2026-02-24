import { describe, expect, test } from "bun:test"
import { build_prompt, build_system_prompt, translate_event } from "./claude-adapter"
import type { Message, AgentManifest } from "./types"
import { create_encoder } from "./wire"

function create_mock_writer() {
  const lines: string[] = []
  return {
    writer: { write(chunk: string) { lines.push(chunk) } },
    lines,
  }
}

describe("build_prompt", () => {
  test("extracts last user message", () => {
    const messages: Message[] = [
      { role: "user", content: "first" },
      { role: "agent", content: "response" },
      { role: "user", content: "second" },
    ]
    expect(build_prompt(messages)).toBe("second")
  })

  test("returns empty string when no user messages", () => {
    const messages: Message[] = [
      { role: "system", content: "instructions" },
    ]
    expect(build_prompt(messages)).toBe("")
  })

  test("handles user with identity", () => {
    const messages: Message[] = [
      { role: "user:travis", content: "hello" },
    ]
    expect(build_prompt(messages)).toBe("hello")
  })
})

describe("build_system_prompt", () => {
  test("combines manifest system and stream system messages", () => {
    const manifest: AgentManifest = { name: "test", system: "Manifest system.", processes: [] }
    const messages: Message[] = [
      { role: "system", content: "Stream system." },
    ]
    expect(build_system_prompt(messages, manifest)).toBe("Manifest system.\n\nStream system.")
  })

  test("returns empty when no system content", () => {
    const manifest: AgentManifest = { name: "test", processes: [] }
    expect(build_system_prompt([], manifest)).toBe("")
  })

  test("only manifest system", () => {
    const manifest: AgentManifest = { name: "test", system: "Be concise.", processes: [] }
    expect(build_system_prompt([], manifest)).toBe("Be concise.")
  })
})

describe("translate_event", () => {
  test("translates assistant text to agent done line", () => {
    const { writer, lines } = create_mock_writer()
    const encoder = create_encoder(writer)
    const tool_map = new Map<string, string>()

    const event = {
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Hello world" }],
      },
    }

    const msgs = translate_event(event, encoder, tool_map)
    expect(msgs).toHaveLength(1)
    expect(msgs[0].role).toBe("agent")
    expect(msgs[0].content).toBe("Hello world")
    expect(msgs[0].done).toBe(true)

    const parsed = JSON.parse(lines[0])
    expect(parsed.role).toBe("agent")
    expect(parsed.content).toBe("Hello world")
    expect(parsed.done).toBe(true)
  })

  test("translates assistant tool_use to process_call", () => {
    const { writer } = create_mock_writer()
    const encoder = create_encoder(writer)
    const tool_map = new Map<string, string>()

    const event = {
      type: "assistant",
      message: {
        role: "assistant",
        content: [{
          type: "tool_use",
          id: "toolu_abc123",
          name: "Bash",
          input: { command: "ls" },
        }],
      },
    }

    const msgs = translate_event(event, encoder, tool_map)
    expect(msgs).toHaveLength(1)
    expect(msgs[0].role).toBe("process_call:bash")
    expect(msgs[0].content).toEqual({ command: "ls" })
    expect(msgs[0].call_id).toBe("toolu_abc123")

    // Tool name tracked for result mapping
    expect(tool_map.get("toolu_abc123")).toBe("bash")
  })

  test("translates user tool_result to process_result", () => {
    const { writer } = create_mock_writer()
    const encoder = create_encoder(writer)
    const tool_map = new Map<string, string>()
    tool_map.set("toolu_abc123", "bash")

    const event = {
      type: "user",
      message: {
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: "toolu_abc123",
          content: "file.txt",
          is_error: false,
        }],
      },
    }

    const msgs = translate_event(event, encoder, tool_map)
    expect(msgs).toHaveLength(1)
    expect(msgs[0].role).toBe("process_result:bash")
    expect(msgs[0].content).toBe("file.txt")
    expect(msgs[0].call_id).toBe("toolu_abc123")
    expect(msgs[0].exit_code).toBe(0)
  })

  test("marks error tool results with exit_code 1", () => {
    const { writer } = create_mock_writer()
    const encoder = create_encoder(writer)
    const tool_map = new Map<string, string>()
    tool_map.set("toolu_abc123", "bash")

    const event = {
      type: "user",
      message: {
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: "toolu_abc123",
          content: "command not found",
          is_error: true,
        }],
      },
    }

    const msgs = translate_event(event, encoder, tool_map)
    expect(msgs[0].exit_code).toBe(1)
  })

  test("skips system and result events", () => {
    const { writer } = create_mock_writer()
    const encoder = create_encoder(writer)
    const tool_map = new Map<string, string>()

    expect(translate_event({ type: "system" }, encoder, tool_map)).toHaveLength(0)
    expect(translate_event({ type: "result", result: "done" }, encoder, tool_map)).toHaveLength(0)
  })

  test("handles assistant with both text and tool_use", () => {
    const { writer } = create_mock_writer()
    const encoder = create_encoder(writer)
    const tool_map = new Map<string, string>()

    const event = {
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Let me check that." },
          { type: "tool_use", id: "toolu_abc", name: "Bash", input: { command: "ls" } },
        ],
      },
    }

    const msgs = translate_event(event, encoder, tool_map)
    expect(msgs).toHaveLength(2)
    expect(msgs[0].role).toBe("agent")
    expect(msgs[0].content).toBe("Let me check that.")
    expect(msgs[1].role).toBe("process_call:bash")
  })

  test("handles missing message gracefully", () => {
    const { writer } = create_mock_writer()
    const encoder = create_encoder(writer)
    const tool_map = new Map<string, string>()

    const event = { type: "assistant" }
    expect(translate_event(event, encoder, tool_map)).toHaveLength(0)
  })
})
