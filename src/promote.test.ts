import { describe, it, expect } from "bun:test"
import { ensure_user_message } from "./promote"
import type { Message } from "./types"

describe("ensure_user_message", () => {
  it("returns messages unchanged when user message exists", () => {
    const messages: Message[] = [
      { role: "user", content: "hello" },
    ]
    const result = ensure_user_message(messages)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.messages).toBe(messages) // same reference, not copied
      expect(result.messages[0].role).toBe("user")
    }
  })

  it("returns messages unchanged when user message exists alongside agent messages", () => {
    const messages: Message[] = [
      { role: "system", content: "you are helpful" },
      { role: "user", content: "do the thing" },
      { role: "agent", content: "done", done: true },
    ]
    const result = ensure_user_message(messages)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.messages).toBe(messages)
    }
  })

  it("promotes last complete agent message in a chained stream", () => {
    const messages: Message[] = [
      { id: "msg_1", role: "agent", content: "first response", done: true },
      { id: "msg_2", role: "process_call:bash", content: { command: "ls" }, done: true },
      { id: "msg_3", role: "process_result:bash", content: "file1 file2", done: true },
      { id: "msg_4", role: "agent", content: "final answer", done: true },
    ]
    const result = ensure_user_message(messages)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.messages[3].role).toBe("user")
      expect(result.messages[3].content).toBe("final answer")
      // earlier messages untouched
      expect(result.messages[0].role).toBe("agent")
      expect(result.messages[1].role).toBe("process_call:bash")
    }
  })

  it("skips delta messages (no done flag) when promoting", () => {
    const messages: Message[] = [
      { id: "msg_1", role: "agent", delta: "partial..." },
      { id: "msg_1", role: "agent", content: "full response", done: true },
      { id: "msg_2", role: "agent", delta: "another partial..." },
    ]
    const result = ensure_user_message(messages)
    expect(result.ok).toBe(true)
    if (result.ok) {
      // promotes msg_1 done line, not the trailing delta
      expect(result.messages[1].role).toBe("user")
      expect(result.messages[1].content).toBe("full response")
    }
  })

  it("errors on empty input", () => {
    const result = ensure_user_message([])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe("no messages in input")
    }
  })

  it("errors when only system messages exist", () => {
    const messages: Message[] = [
      { role: "system", content: "you are helpful" },
    ]
    const result = ensure_user_message(messages)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe("no user or agent message found in input")
    }
  })

  it("errors when agent messages have no done flag", () => {
    const messages: Message[] = [
      { id: "msg_1", role: "agent", delta: "partial only" },
    ]
    const result = ensure_user_message(messages)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe("no user or agent message found in input")
    }
  })

  it("does not mutate the original messages array", () => {
    const messages: Message[] = [
      { id: "msg_1", role: "agent", content: "answer", done: true },
    ]
    const result = ensure_user_message(messages)
    expect(result.ok).toBe(true)
    // original unchanged
    expect(messages[0].role).toBe("agent")
  })
})
