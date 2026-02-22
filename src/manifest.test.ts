import { describe, expect, test } from "bun:test"
import { parse_persona, parse_frontmatter, parse_simple_yaml } from "./manifest"

describe("parse_frontmatter", () => {
  test("extracts YAML frontmatter and body", () => {
    const text = `---
name: test
description: A test persona
---
You are a helpful assistant.`

    const { frontmatter, body } = parse_frontmatter(text)
    expect(frontmatter.name).toBe("test")
    expect(frontmatter.description).toBe("A test persona")
    expect(body.trim()).toBe("You are a helpful assistant.")
  })

  test("returns empty frontmatter when no delimiters", () => {
    const text = "Just some markdown content."
    const { frontmatter, body } = parse_frontmatter(text)
    expect(frontmatter).toEqual({})
    expect(body).toBe("Just some markdown content.")
  })
})

describe("parse_simple_yaml", () => {
  test("parses simple key-value pairs", () => {
    const yaml = `name: researcher
description: Research topics thoroughly`

    const result = parse_simple_yaml(yaml)
    expect(result.name).toBe("researcher")
    expect(result.description).toBe("Research topics thoroughly")
  })

  test("strips quotes from values", () => {
    const yaml = `cmd: "claude --print --permission-mode bypassPermissions"`
    const result = parse_simple_yaml(yaml)
    expect(result.cmd).toBe("claude --print --permission-mode bypassPermissions")
  })

  test("parses nested block as object", () => {
    const yaml = `cmd:
  headless: "claude --print --permission-mode bypassPermissions"
  interactive: "claude --permission-mode bypassPermissions"`

    const result = parse_simple_yaml(yaml)
    expect(result.cmd).toEqual({
      headless: "claude --print --permission-mode bypassPermissions",
      interactive: "claude --permission-mode bypassPermissions",
    })
  })
})

describe("parse_persona", () => {
  test("maps persona fields to manifest", () => {
    const text = `---
name: dad-joke
description: A simple test persona that responds with dad jokes
cmd: "claude --print --permission-mode bypassPermissions"
---

You are the Dad Joke Bot.`

    const manifest = parse_persona(text)
    expect(manifest.name).toBe("dad-joke")
    expect(manifest.description).toBe("A simple test persona that responds with dad jokes")
    expect(manifest.adapter).toBe("claude-code")
    expect(manifest.system).toBe("You are the Dad Joke Bot.")
    expect(manifest.processes).toEqual([])
  })

  test("infers claude-code adapter from cmd with claude", () => {
    const text = `---
name: test
cmd: "claude --print"
---
System prompt.`

    const manifest = parse_persona(text)
    expect(manifest.adapter).toBe("claude-code")
  })

  test("infers adapter from nested cmd (uses headless)", () => {
    const text = `---
name: root
cmd:
  headless: "claude --print --permission-mode bypassPermissions"
  interactive: "claude --permission-mode bypassPermissions"
---
Root system prompt.`

    const manifest = parse_persona(text)
    expect(manifest.adapter).toBe("claude-code")
  })

  test("explicit adapter overrides cmd inference", () => {
    const text = `---
name: custom
cmd: "claude --print"
adapter: openai
---
Custom agent.`

    const manifest = parse_persona(text)
    expect(manifest.adapter).toBe("openai")
  })

  test("non-claude cmd becomes raw adapter string", () => {
    const text = `---
name: custom
cmd: "/usr/local/bin/my-llm --mode agent"
---
Custom agent.`

    const manifest = parse_persona(text)
    expect(manifest.adapter).toBe("/usr/local/bin/my-llm --mode agent")
  })

  test("no cmd and no adapter leaves adapter undefined", () => {
    const text = `---
name: bare
---
Just a prompt.`

    const manifest = parse_persona(text)
    expect(manifest.adapter).toBeUndefined()
  })

  test("preserves multiline system prompt", () => {
    const text = `---
name: test
---

# Instructions

You are a helpful assistant.

## Rules

1. Be concise
2. Be accurate`

    const manifest = parse_persona(text)
    expect(manifest.system).toContain("# Instructions")
    expect(manifest.system).toContain("## Rules")
    expect(manifest.system).toContain("2. Be accurate")
  })
})
