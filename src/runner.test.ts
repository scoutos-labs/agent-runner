import { describe, expect, test } from "bun:test"
import { build_runner_system_prompt, resolve_max_turns } from "./runner"
import type { AgentManifest } from "./types"

function manifest(max_turns?: unknown): AgentManifest {
  return {
    name: "test",
    processes: [],
    options: max_turns === undefined ? undefined : { runner: { max_turns } },
  } as AgentManifest
}

describe("resolve_max_turns", () => {
  test("uses the default when not configured", () => {
    expect(resolve_max_turns(manifest())).toBe(20)
  })

  test("uses manifest runner max_turns", () => {
    expect(resolve_max_turns(manifest(80))).toBe(80)
  })

  test("floors fractional values", () => {
    expect(resolve_max_turns(manifest(10.8))).toBe(10)
  })

  test("falls back for invalid values", () => {
    expect(resolve_max_turns(manifest(0))).toBe(20)
    expect(resolve_max_turns(manifest("many"))).toBe(20)
  })

  test("caps at hard maximum", () => {
    expect(resolve_max_turns(manifest(999))).toBe(200)
  })
})

describe("build_runner_system_prompt", () => {
  test("tells the model its turn budget", () => {
    const prompt = build_runner_system_prompt(80)

    expect(prompt).toContain("80 model turns")
    expect(prompt).toContain("batch safe read-only checks")
    expect(prompt).toContain("stop before exhaustion")
  })
})
