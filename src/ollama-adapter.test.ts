import { describe, expect, test } from "bun:test"
import { translate_messages, translate_tools } from "./ollama-adapter"
import type { Message, AgentManifest } from "./types"

describe("translate_messages", () => {
  test("simple user message", () => {
    const messages: Message[] = [{ role: "user", content: "hello" }]
    const result = translate_messages(messages)
    expect(result).toEqual([{ role: "user", content: "hello" }])
  })

  test("agent message becomes assistant", () => {
    const messages: Message[] = [{ role: "agent", content: "hi there" }]
    const result = translate_messages(messages)
    expect(result).toEqual([{ role: "assistant", content: "hi there" }])
  })

  test("system messages are filtered out", () => {
    const messages: Message[] = [
      { role: "system", content: "instructions" },
      { role: "user", content: "hello" },
    ]
    const result = translate_messages(messages)
    expect(result).toEqual([{ role: "user", content: "hello" }])
  })

  test("process_call maps to assistant with tool_calls (arguments as object)", () => {
    const messages: Message[] = [
      { role: "process_call:bash", call_id: "call_abc", content: { command: "ls" } },
    ]
    const result = translate_messages(messages)
    expect(result).toEqual([{
      role: "assistant",
      content: "",
      tool_calls: [{
        function: {
          name: "bash",
          arguments: { command: "ls" },
        },
      }],
    }])
  })

  test("process_result maps to tool message without tool_call_id", () => {
    const messages: Message[] = [
      { role: "process_result:bash", call_id: "call_abc", content: "file.txt" },
    ]
    const result = translate_messages(messages)
    expect(result).toEqual([{ role: "tool", content: "file.txt" }])
  })

  test("agent text + process_call merge into one assistant message", () => {
    const messages: Message[] = [
      { role: "agent", content: "Let me check." },
      { role: "process_call:bash", call_id: "call_abc", content: { command: "ls" } },
    ]
    const result = translate_messages(messages)
    expect(result).toHaveLength(1)
    expect(result[0].role).toBe("assistant")
    expect(result[0].content).toBe("Let me check.")
    expect(result[0].tool_calls).toHaveLength(1)
    expect(result[0].tool_calls![0].function.arguments).toEqual({ command: "ls" })
  })

  test("full tool-use conversation round-trip", () => {
    const messages: Message[] = [
      { role: "user", content: "list files" },
      { role: "agent", content: "Running ls." },
      { role: "process_call:bash", call_id: "call_abc", content: { command: "ls" } },
      { role: "process_result:bash", call_id: "call_abc", content: "file.txt\nREADME.md" },
      { role: "agent", content: "Here are your files." },
    ]
    const result = translate_messages(messages)

    expect(result).toHaveLength(4)
    expect(result[0]).toEqual({ role: "user", content: "list files" })
    // assistant with merged text + tool_call
    expect(result[1].role).toBe("assistant")
    expect(result[1].content).toBe("Running ls.")
    expect(result[1].tool_calls).toHaveLength(1)
    // tool result — no tool_call_id
    expect(result[2]).toEqual({ role: "tool", content: "file.txt\nREADME.md" })
    // final assistant
    expect(result[3]).toEqual({ role: "assistant", content: "Here are your files." })
  })
})

describe("translate_tools", () => {
  test("maps process declarations to tool format", () => {
    const manifest: AgentManifest = {
      name: "test",
      processes: [{
        name: "bash",
        description: "Execute a command",
        input_schema: {
          type: "object",
          properties: { command: { type: "string" } },
          required: ["command"],
        },
      }],
    }
    const result = translate_tools(manifest)
    expect(result).toEqual([{
      type: "function",
      function: {
        name: "bash",
        description: "Execute a command",
        parameters: {
          type: "object",
          properties: { command: { type: "string" } },
          required: ["command"],
        },
      },
    }])
  })
})
