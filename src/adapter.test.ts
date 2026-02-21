import { describe, expect, test } from "bun:test"
import { translate_messages, translate_tools, get_system_prompt } from "./adapter"
import type { Message, AgentManifest } from "./types"

describe("translate_messages", () => {
  test("simple user message", () => {
    const messages: Message[] = [
      { role: "user", content: "hello" },
    ]
    const result = translate_messages(messages)
    expect(result).toEqual([{ role: "user", content: "hello" }])
  })

  test("agent message", () => {
    const messages: Message[] = [
      { role: "agent", content: "hi there" },
    ]
    const result = translate_messages(messages)
    expect(result).toEqual([{ role: "assistant", content: "hi there" }])
  })

  test("user with identity", () => {
    const messages: Message[] = [
      { role: "user:travis", content: "hey" },
    ]
    const result = translate_messages(messages)
    expect(result).toEqual([{ role: "user", content: "hey" }])
  })

  test("system messages are filtered out", () => {
    const messages: Message[] = [
      { role: "system", content: "you are helpful" },
      { role: "user", content: "hello" },
    ]
    const result = translate_messages(messages)
    expect(result).toEqual([{ role: "user", content: "hello" }])
  })

  test("process_call maps to assistant with tool_calls", () => {
    const messages: Message[] = [
      { id: "msg_1", role: "process_call:bash", call_id: "call_abc", content: { command: "ls" } },
    ]
    const result = translate_messages(messages)
    expect(result).toEqual([{
      role: "assistant",
      content: null,
      tool_calls: [{
        id: "call_abc",
        type: "function",
        function: {
          name: "bash",
          arguments: '{"command":"ls"}',
        },
      }],
    }])
  })

  test("process_result maps to tool message", () => {
    const messages: Message[] = [
      { role: "process_result:bash", call_id: "call_abc", content: "file.txt" },
    ]
    const result = translate_messages(messages)
    expect(result).toEqual([{
      role: "tool",
      tool_call_id: "call_abc",
      content: "file.txt",
    }])
  })

  test("agent text + process_call merge into one assistant message", () => {
    const messages: Message[] = [
      { role: "agent", content: "I'll run ls for you." },
      { id: "msg_1", role: "process_call:bash", call_id: "call_abc", content: { command: "ls" } },
    ]
    const result = translate_messages(messages)
    expect(result).toEqual([{
      role: "assistant",
      content: "I'll run ls for you.",
      tool_calls: [{
        id: "call_abc",
        type: "function",
        function: {
          name: "bash",
          arguments: '{"command":"ls"}',
        },
      }],
    }])
  })

  test("full conversation round-trip", () => {
    const messages: Message[] = [
      { role: "user", content: "list files" },
      { role: "agent", content: "I'll run ls for you." },
      { id: "msg_1", role: "process_call:bash", call_id: "call_abc", content: { command: "ls" } },
      { role: "process_result:bash", call_id: "call_abc", content: "file.txt\nREADME.md" },
      { role: "agent", content: "Here are your files: file.txt, README.md" },
    ]
    const result = translate_messages(messages)

    expect(result.length).toBe(4)
    expect(result[0].role).toBe("user")
    expect(result[1].role).toBe("assistant")
    expect(result[2].role).toBe("tool")
    expect(result[3].role).toBe("assistant")

    // Agent text + tool_call merged into one assistant message
    const assistant_msg = result[1] as { role: string; content: string | null; tool_calls?: unknown[] }
    expect(assistant_msg.content).toBe("I'll run ls for you.")
    expect(assistant_msg.tool_calls).toHaveLength(1)

    // Tool result is its own message
    expect(result[2]).toEqual({
      role: "tool",
      tool_call_id: "call_abc",
      content: "file.txt\nREADME.md",
    })
  })
})

describe("translate_tools", () => {
  test("maps process declarations to OpenAI tool format", () => {
    const manifest: AgentManifest = {
      name: "test",
      processes: [
        {
          name: "bash",
          description: "Execute a shell command",
          input_schema: {
            type: "object",
            properties: {
              command: { type: "string" },
            },
            required: ["command"],
          },
        },
      ],
    }
    const result = translate_tools(manifest)
    expect(result).toEqual([{
      type: "function",
      function: {
        name: "bash",
        description: "Execute a shell command",
        parameters: {
          type: "object",
          properties: {
            command: { type: "string" },
          },
          required: ["command"],
        },
      },
    }])
  })
})

describe("get_system_prompt", () => {
  test("manifest system and stream system messages concatenated", () => {
    const manifest: AgentManifest = {
      name: "test",
      system: "You are helpful.",
      processes: [],
    }
    const messages: Message[] = [
      { role: "system", content: "Extra instructions." },
      { role: "user", content: "hello" },
    ]
    const result = get_system_prompt(messages, manifest)
    expect(result).toBe("You are helpful.\n\nExtra instructions.")
  })

  test("no system content returns empty string", () => {
    const manifest: AgentManifest = {
      name: "test",
      processes: [],
    }
    const messages: Message[] = [
      { role: "user", content: "hello" },
    ]
    const result = get_system_prompt(messages, manifest)
    expect(result).toBe("")
  })

  test("only manifest system", () => {
    const manifest: AgentManifest = {
      name: "test",
      system: "Be concise.",
      processes: [],
    }
    const result = get_system_prompt([], manifest)
    expect(result).toBe("Be concise.")
  })

  test("only stream system messages", () => {
    const manifest: AgentManifest = {
      name: "test",
      processes: [],
    }
    const messages: Message[] = [
      { role: "system", content: "First rule." },
      { role: "system", content: "Second rule." },
    ]
    const result = get_system_prompt(messages, manifest)
    expect(result).toBe("First rule.\n\nSecond rule.")
  })
})
