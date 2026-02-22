import { describe, expect, test } from "bun:test"
import { create_encoder, parse_input } from "./wire"
import type { Writer } from "./wire"

function mock_writer(): Writer & { lines: string[] } {
  const lines: string[] = []
  return {
    lines,
    write(chunk: string) {
      lines.push(chunk)
    },
  }
}

describe("parse_input", () => {
  test("bare text becomes a user message", () => {
    const result = parse_input("What is 2+2?")
    expect(result).toEqual([{ role: "user", content: "What is 2+2?" }])
  })

  test("multi-line bare text becomes one user message", () => {
    const result = parse_input("Line one\nLine two\nLine three")
    expect(result).toEqual([{ role: "user", content: "Line one\nLine two\nLine three" }])
  })

  test("JSONL input is parsed as messages", () => {
    const input = '{"role":"user","content":"hello"}\n{"role":"system","content":"be helpful"}'
    const result = parse_input(input)
    expect(result).toEqual([
      { role: "user", content: "hello" },
      { role: "system", content: "be helpful" },
    ])
  })

  test("empty input returns empty array", () => {
    expect(parse_input("")).toEqual([])
    expect(parse_input("  \n  ")).toEqual([])
  })

  test("JSON without role field is treated as bare text", () => {
    const result = parse_input('{"key": "value"}')
    expect(result).toEqual([{ role: "user", content: '{"key": "value"}' }])
  })

  test("JSONL with blank lines is handled", () => {
    const input = '\n{"role":"user","content":"hello"}\n\n{"role":"agent","content":"hi"}\n'
    const result = parse_input(input)
    expect(result).toEqual([
      { role: "user", content: "hello" },
      { role: "agent", content: "hi" },
    ])
  })
})

describe("create_encoder", () => {
  describe("next_id", () => {
    test("returns incrementing ids", () => {
      const writer = mock_writer()
      const encoder = create_encoder(writer)
      expect(encoder.next_id()).toBe("msg_1")
      expect(encoder.next_id()).toBe("msg_2")
      expect(encoder.next_id()).toBe("msg_3")
    })
  })

  describe("delta", () => {
    test("emits valid JSON with id, role, and delta fields", () => {
      const writer = mock_writer()
      const encoder = create_encoder(writer)
      encoder.delta("msg_1", "agent", "hello ")

      expect(writer.lines).toHaveLength(1)
      const parsed = JSON.parse(writer.lines[0])
      expect(parsed).toEqual({ id: "msg_1", role: "agent", delta: "hello " })
    })

    test("does not include done field", () => {
      const writer = mock_writer()
      const encoder = create_encoder(writer)
      encoder.delta("msg_1", "agent", "text")

      const parsed = JSON.parse(writer.lines[0])
      expect(parsed.done).toBeUndefined()
    })

    test("each line ends with newline", () => {
      const writer = mock_writer()
      const encoder = create_encoder(writer)
      encoder.delta("msg_1", "agent", "text")

      expect(writer.lines[0].endsWith("\n")).toBe(true)
    })
  })

  describe("done", () => {
    test("emits valid JSON with id, role, done, and content fields", () => {
      const writer = mock_writer()
      const encoder = create_encoder(writer)
      encoder.done("msg_1", "agent", "final answer")

      expect(writer.lines).toHaveLength(1)
      const parsed = JSON.parse(writer.lines[0])
      expect(parsed).toEqual({
        id: "msg_1",
        role: "agent",
        done: true,
        content: "final answer",
      })
    })

    test("merges extra fields", () => {
      const writer = mock_writer()
      const encoder = create_encoder(writer)
      encoder.done("msg_2", "process_result:bash", "output text", {
        call_id: "p_1",
        exit_code: 0,
      })

      const parsed = JSON.parse(writer.lines[0])
      expect(parsed).toEqual({
        id: "msg_2",
        role: "process_result:bash",
        done: true,
        content: "output text",
        call_id: "p_1",
        exit_code: 0,
      })
    })

    test("content can be an object", () => {
      const writer = mock_writer()
      const encoder = create_encoder(writer)
      const content = { command: "ls -la" }
      encoder.done("msg_1", "process_call:bash", content)

      const parsed = JSON.parse(writer.lines[0])
      expect(parsed.content).toEqual({ command: "ls -la" })
    })

    test("each line ends with newline", () => {
      const writer = mock_writer()
      const encoder = create_encoder(writer)
      encoder.done("msg_1", "agent", "done")

      expect(writer.lines[0].endsWith("\n")).toBe(true)
    })
  })

  describe("every emitted line is valid JSON", () => {
    test("mixed delta and done calls all produce parseable JSON", () => {
      const writer = mock_writer()
      const encoder = create_encoder(writer)

      encoder.delta("msg_1", "agent", "chunk1")
      encoder.delta("msg_1", "agent", "chunk2")
      encoder.done("msg_1", "agent", "chunk1chunk2")
      encoder.done("msg_2", "process_call:bash", { command: "echo hi" })
      encoder.done("msg_3", "process_result:bash", "hi\n", {
        call_id: "msg_2",
        exit_code: 0,
      })

      for (const line of writer.lines) {
        expect(() => JSON.parse(line)).not.toThrow()
      }
    })
  })
})
