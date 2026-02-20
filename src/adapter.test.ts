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

  test("process_call maps to assistant with tool_use content block", () => {
    const messages: Message[] = [
      { id: "msg_1", role: "process_call:bash", content: { command: "ls" } },
    ]
    const result = translate_messages(messages)
    expect(result).toEqual([{
      role: "assistant",
      content: [{
        type: "tool_use",
        id: "msg_1",
        name: "bash",
        input: { command: "ls" },
      }],
    }])
  })

  test("process_result maps to user with tool_result content block", () => {
    const messages: Message[] = [
      { role: "process_result:bash", call_id: "msg_1", content: "file.txt" },
    ]
    const result = translate_messages(messages)
    expect(result).toEqual([{
      role: "user",
      content: [{
        type: "tool_result",
        tool_use_id: "msg_1",
        content: "file.txt",
      }],
    }])
  })

  test("adjacent same-role messages are merged", () => {
    const messages: Message[] = [
      { role: "user", content: "hello" },
      { role: "process_result:bash", call_id: "msg_1", content: "output" },
    ]
    const result = translate_messages(messages)
    expect(result).toEqual([{
      role: "user",
      content: [
        { type: "text", text: "hello" },
        { type: "tool_result", tool_use_id: "msg_1", content: "output" },
      ],
    }])
  })

  test("full conversation round-trip produces alternating roles", () => {
    const messages: Message[] = [
      { role: "user", content: "list files" },
      { role: "agent", content: "I'll run ls for you." },
      { id: "msg_1", role: "process_call:bash", content: { command: "ls" } },
      { role: "process_result:bash", call_id: "msg_1", content: "file.txt\nREADME.md" },
      { role: "agent", content: "Here are your files: file.txt, README.md" },
    ]
    const result = translate_messages(messages)

    // Should be alternating user/assistant
    expect(result.length).toBe(4)
    expect(result[0].role).toBe("user")
    expect(result[1].role).toBe("assistant")
    expect(result[2].role).toBe("user")
    expect(result[3].role).toBe("assistant")

    // Second assistant message merges agent text + tool_use
    expect(result[1].content).toEqual([
      { type: "text", text: "I'll run ls for you." },
      { type: "tool_use", id: "msg_1", name: "bash", input: { command: "ls" } },
    ])

    // process_result becomes user with tool_result
    expect(result[2].content).toEqual([{
      type: "tool_result",
      tool_use_id: "msg_1",
      content: "file.txt\nREADME.md",
    }])
  })
})

describe("translate_tools", () => {
  test("maps process declarations to Anthropic tool format", () => {
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
      name: "bash",
      description: "Execute a shell command",
      input_schema: {
        type: "object",
        properties: {
          command: { type: "string" },
        },
        required: ["command"],
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
