import { describe, expect, test } from "bun:test"
import { parse_role, format_role } from "./types"

describe("parse_role", () => {
  test("bare role without identity", () => {
    expect(parse_role("system")).toEqual({ type: "system" })
  })

  test("user with identity", () => {
    expect(parse_role("user:travis")).toEqual({ type: "user", identity: "travis" })
  })

  test("agent with identity", () => {
    expect(parse_role("agent:researcher")).toEqual({ type: "agent", identity: "researcher" })
  })

  test("process_call with identity", () => {
    expect(parse_role("process_call:bash")).toEqual({ type: "process_call", identity: "bash" })
  })

  test("process_result with identity", () => {
    expect(parse_role("process_result:bash")).toEqual({ type: "process_result", identity: "bash" })
  })

  test("identity with colons splits on first colon only", () => {
    expect(parse_role("agent:deploy:v2")).toEqual({ type: "agent", identity: "deploy:v2" })
  })
})

describe("format_role", () => {
  test("formats role with identity", () => {
    expect(format_role({ type: "process_call", identity: "bash" })).toBe("process_call:bash")
  })

  test("formats role without identity", () => {
    expect(format_role({ type: "user" })).toBe("user")
  })

  test("round-trip through parse and format", () => {
    expect(format_role(parse_role("process_call:bash"))).toBe("process_call:bash")
  })
})
