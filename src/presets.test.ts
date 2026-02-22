import { describe, expect, test } from "bun:test"
import { resolve_adapter, parse_command_string } from "./presets"
import type { AgentManifest, Message } from "./types"

const base_manifest: AgentManifest = { name: "test", processes: [] }
const base_messages: Message[] = [{ role: "user", content: "hello" }]

describe("resolve_adapter", () => {
  test("resolves 'openai' preset to built_in", () => {
    const config = resolve_adapter("openai", base_manifest, base_messages)
    expect(config.kind).toBe("built_in")
    expect(config.name).toBe("openai")
  })

  test("resolves 'claude-code' preset to command with correct args", () => {
    const manifest: AgentManifest = {
      ...base_manifest,
      system: "Be helpful.",
      options: { "claude-code": { model: "claude-sonnet-4-5-20250929" } },
    }
    const config = resolve_adapter("claude-code", manifest, base_messages)
    expect(config.kind).toBe("command")
    expect(config.name).toBe("claude-code")

    if (config.kind === "command") {
      expect(config.output_format).toBe("claude-code-stream-json")
      expect(config.cmd[0]).toBe("claude")
      expect(config.cmd).toContain("-p")
      expect(config.cmd).toContain("hello")
      expect(config.cmd).toContain("--output-format")
      expect(config.cmd).toContain("stream-json")
      expect(config.cmd).toContain("--model")
      expect(config.cmd).toContain("claude-sonnet-4-5-20250929")
      expect(config.cmd).toContain("--append-system-prompt")
      expect(config.cmd).toContain("Be helpful.")
    }
  })

  test("claude-code preset uses default permission_mode", () => {
    const config = resolve_adapter("claude-code", base_manifest, base_messages)
    if (config.kind === "command") {
      expect(config.cmd).toContain("--permission-mode")
      expect(config.cmd).toContain("bypassPermissions")
    }
  })

  test("claude-code preset respects max_turns option", () => {
    const manifest: AgentManifest = {
      ...base_manifest,
      options: { "claude-code": { max_turns: 5 } },
    }
    const config = resolve_adapter("claude-code", manifest, base_messages)
    if (config.kind === "command") {
      expect(config.cmd).toContain("--max-turns")
      expect(config.cmd).toContain("5")
    }
  })

  test("claude-code preset omits system prompt when empty", () => {
    const config = resolve_adapter("claude-code", base_manifest, base_messages)
    if (config.kind === "command") {
      expect(config.cmd).not.toContain("--append-system-prompt")
    }
  })

  test("resolves raw command string with spaces", () => {
    const config = resolve_adapter("my-adapter --verbose", base_manifest, base_messages)
    expect(config.kind).toBe("command")
    expect(config.name).toBe("custom")

    if (config.kind === "command") {
      expect(config.cmd).toEqual(["my-adapter", "--verbose"])
      expect(config.output_format).toBe("wire")
    }
  })

  test("resolves absolute path as command", () => {
    const config = resolve_adapter("/usr/local/bin/my-adapter", base_manifest, base_messages)
    expect(config.kind).toBe("command")

    if (config.kind === "command") {
      expect(config.cmd).toEqual(["/usr/local/bin/my-adapter"])
      expect(config.output_format).toBe("wire")
    }
  })

  test("resolves relative path as command", () => {
    const config = resolve_adapter("./adapters/custom.sh", base_manifest, base_messages)
    expect(config.kind).toBe("command")

    if (config.kind === "command") {
      expect(config.cmd).toEqual(["./adapters/custom.sh"])
    }
  })

  test("resolves home-relative path as command", () => {
    const config = resolve_adapter("~/bin/my-adapter", base_manifest, base_messages)
    expect(config.kind).toBe("command")

    if (config.kind === "command") {
      expect(config.cmd).toEqual(["~/bin/my-adapter"])
    }
  })

  test("throws for unknown non-command string", () => {
    expect(() => resolve_adapter("foobar", base_manifest, base_messages))
      .toThrow('Unknown adapter: "foobar"')
  })
})

describe("parse_command_string", () => {
  test("splits on whitespace", () => {
    expect(parse_command_string("claude -p hello")).toEqual(["claude", "-p", "hello"])
  })

  test("handles multiple spaces", () => {
    expect(parse_command_string("a   b   c")).toEqual(["a", "b", "c"])
  })

  test("trims leading and trailing whitespace", () => {
    expect(parse_command_string("  cmd --flag  ")).toEqual(["cmd", "--flag"])
  })
})
