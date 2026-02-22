import { describe, expect, test } from "bun:test"
import { read_lines } from "./command-adapter"

function stream_from_chunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  })
}

describe("read_lines", () => {
  test("yields complete lines", async () => {
    const stream = stream_from_chunks(["hello\nworld\nfoo\n"])
    const lines: string[] = []
    for await (const line of read_lines(stream)) {
      lines.push(line)
    }
    expect(lines).toEqual(["hello", "world", "foo"])
  })

  test("handles partial lines across chunks", async () => {
    const stream = stream_from_chunks(["hel", "lo\nwor", "ld\n"])
    const lines: string[] = []
    for await (const line of read_lines(stream)) {
      lines.push(line)
    }
    expect(lines).toEqual(["hello", "world"])
  })

  test("yields trailing content without newline", async () => {
    const stream = stream_from_chunks(["line1\nline2"])
    const lines: string[] = []
    for await (const line of read_lines(stream)) {
      lines.push(line)
    }
    expect(lines).toEqual(["line1", "line2"])
  })

  test("skips blank lines", async () => {
    const stream = stream_from_chunks(["a\n\n\nb\n"])
    const lines: string[] = []
    for await (const line of read_lines(stream)) {
      lines.push(line)
    }
    expect(lines).toEqual(["a", "b"])
  })

  test("handles single chunk with no newline", async () => {
    const stream = stream_from_chunks(["only-line"])
    const lines: string[] = []
    for await (const line of read_lines(stream)) {
      lines.push(line)
    }
    expect(lines).toEqual(["only-line"])
  })

  test("handles empty stream", async () => {
    const stream = stream_from_chunks([])
    const lines: string[] = []
    for await (const line of read_lines(stream)) {
      lines.push(line)
    }
    expect(lines).toEqual([])
  })
})
