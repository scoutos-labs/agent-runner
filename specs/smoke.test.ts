import { describe, expect, test } from "bun:test"

const has_openai_key = !!process.env.OPENAI_API_KEY
const openai_test = has_openai_key ? test : test.skip

// Claude Code adapter just needs the `claude` CLI available
let has_claude_cli = false
try {
  const proc = Bun.spawnSync(["which", "claude"])
  has_claude_cli = proc.exitCode === 0
} catch {
  has_claude_cli = false
}
const claude_test = has_claude_cli ? test : test.skip

interface ParsedLine {
  id?: string
  role?: string
  delta?: string
  done?: boolean
  content?: string | Record<string, unknown>
  call_id?: string
  exit_code?: number
}

async function run_agent(
  input: string,
  agent_path = "agents/basic.json",
): Promise<{ lines: ParsedLine[]; exit_code: number }> {
  const proc = Bun.spawn(["bun", "run", "src/index.ts", "run", "--agent", agent_path], {
    cwd: import.meta.dir + "/..",
    stdin: new Blob([input]),
    stdout: "pipe",
    stderr: "pipe",
  })

  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const exit_code = await proc.exited

  if (stderr) {
    console.error("[smoke stderr]", stderr)
  }

  const lines: ParsedLine[] = []
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      lines.push(JSON.parse(trimmed) as ParsedLine)
    } catch {
      throw new Error(`Invalid JSON in output: ${trimmed}`)
    }
  }

  return { lines, exit_code }
}

describe("end-to-end smoke specs (openai)", () => {
  openai_test(
    "single tool call (UC-1)",
    async () => {
      const { lines, exit_code } = await run_agent(
        '{"role":"user","content":"List the files in the current directory using ls"}',
      )

      expect(lines.length).toBeGreaterThan(0)

      const done_lines = lines.filter((l) => l.done === true)

      const process_calls = done_lines.filter((l) => l.role?.startsWith("process_call:bash"))
      expect(process_calls.length).toBeGreaterThanOrEqual(1)

      const process_results = done_lines.filter((l) => l.role?.startsWith("process_result:bash"))
      expect(process_results.length).toBeGreaterThanOrEqual(1)
      expect(process_results.some((l) => l.exit_code === 0)).toBe(true)

      const agent_dones = done_lines.filter((l) => l.role === "agent")
      expect(agent_dones.length).toBeGreaterThanOrEqual(1)

      expect(exit_code).toBe(0)
    },
    { timeout: 30_000 },
  )

  openai_test(
    "process failure (UC-4)",
    async () => {
      const { lines, exit_code } = await run_agent(
        '{"role":"user","content":"Read the file /nonexistent/path/that/does/not/exist.txt using cat"}',
      )

      expect(lines.length).toBeGreaterThan(0)

      const done_lines = lines.filter((l) => l.done === true)

      const process_results = done_lines.filter((l) => l.role?.startsWith("process_result"))
      expect(process_results.length).toBeGreaterThanOrEqual(1)
      expect(process_results.some((l) => l.exit_code !== undefined && l.exit_code > 0)).toBe(true)

      const agent_dones = done_lines.filter((l) => l.role === "agent")
      expect(agent_dones.length).toBeGreaterThanOrEqual(1)
    },
    { timeout: 30_000 },
  )

  openai_test(
    "wire format consistency",
    async () => {
      const { lines } = await run_agent(
        '{"role":"user","content":"List the files in the current directory using ls"}',
      )

      const done_lines = lines.filter((l) => l.done === true)
      const delta_lines = lines.filter((l) => l.delta !== undefined)

      const delta_ids = new Set(delta_lines.map((l) => l.id))
      const done_ids = new Set(done_lines.map((l) => l.id))

      for (const id of delta_ids) {
        expect(done_ids.has(id)).toBe(true)
      }

      const call_dones = done_lines.filter((l) => l.role?.startsWith("process_call:"))
      const result_dones = done_lines.filter((l) => l.role?.startsWith("process_result:"))

      for (const call of call_dones) {
        const matching_result = result_dones.find((r) => r.call_id === call.call_id)
        expect(matching_result).toBeDefined()
      }
    },
    { timeout: 30_000 },
  )
})

describe("end-to-end smoke specs (wire-format adapter)", () => {
  test(
    "custom shell script adapter receives messages and emits wire JSONL",
    async () => {
      const { lines, exit_code } = await run_agent(
        '{"role":"user","content":"test input"}',
        "agents/wire-echo.json",
      )

      expect(lines.length).toBeGreaterThan(0)

      const done_lines = lines.filter((l) => l.done === true)
      expect(done_lines.length).toBe(1)
      expect(done_lines[0].role).toBe("agent")
      expect(typeof done_lines[0].content).toBe("string")
      expect((done_lines[0].content as string)).toContain("test input")
      expect(exit_code).toBe(0)
    },
    { timeout: 10_000 },
  )
})

describe("end-to-end smoke specs (claude-code)", () => {
  claude_test(
    "simple text response",
    async () => {
      const { lines, exit_code } = await run_agent(
        '{"role":"user","content":"Reply with exactly: hello from agent-runner"}',
        "agents/basic-claude.json",
      )

      expect(lines.length).toBeGreaterThan(0)

      const done_lines = lines.filter((l) => l.done === true)

      // At least one agent done line with the response
      const agent_dones = done_lines.filter((l) => l.role === "agent")
      expect(agent_dones.length).toBeGreaterThanOrEqual(1)

      // Every line is valid JSON (enforced by run_agent parser)
      // Exit code is 0
      expect(exit_code).toBe(0)
    },
    { timeout: 60_000 },
  )

  claude_test(
    "tool use produces process_call and process_result in wire output",
    async () => {
      const { lines, exit_code } = await run_agent(
        '{"role":"user","content":"Run this exact bash command and show me the output: echo hello-from-agent-runner"}',
        "agents/basic-claude.json",
      )

      expect(lines.length).toBeGreaterThan(0)

      const done_lines = lines.filter((l) => l.done === true)

      // Should see process_call and process_result for the tool use
      const process_calls = done_lines.filter((l) => l.role?.startsWith("process_call:"))
      expect(process_calls.length).toBeGreaterThanOrEqual(1)

      const process_results = done_lines.filter((l) => l.role?.startsWith("process_result:"))
      expect(process_results.length).toBeGreaterThanOrEqual(1)

      // At least one agent done line (final response)
      const agent_dones = done_lines.filter((l) => l.role === "agent")
      expect(agent_dones.length).toBeGreaterThanOrEqual(1)

      // Every process_call has a matching process_result
      for (const call of process_calls) {
        const matching = process_results.find((r) => r.call_id === call.call_id)
        expect(matching).toBeDefined()
      }

      expect(exit_code).toBe(0)
    },
    { timeout: 60_000 },
  )

  claude_test(
    "wire format — all lines are valid JSONL",
    async () => {
      const { lines } = await run_agent(
        '{"role":"user","content":"What is 2+2? Reply with just the number."}',
        "agents/basic-claude.json",
      )

      // run_agent already validates JSON parsing — if we get here, all lines parsed
      expect(lines.length).toBeGreaterThan(0)

      // Every done line has an id and role
      const done_lines = lines.filter((l) => l.done === true)
      for (const line of done_lines) {
        expect(line.id).toBeDefined()
        expect(line.role).toBeDefined()
      }
    },
    { timeout: 60_000 },
  )
})

// --- Ollama adapter ---

let has_ollama = false
try {
  const resp = await fetch("http://localhost:11434/api/tags")
  has_ollama = resp.ok
} catch {
  has_ollama = false
}
const ollama_test = has_ollama ? test : test.skip

describe("end-to-end smoke specs (ollama)", () => {
  ollama_test(
    "simple text response (drafter)",
    async () => {
      const { lines, exit_code } = await run_agent(
        '{"role":"user","content":"What is 2+2? Reply with just the number, no thinking."}',
        "agents/drafter.json",
      )

      expect(lines.length).toBeGreaterThan(0)

      const done_lines = lines.filter((l) => l.done === true)
      const agent_dones = done_lines.filter((l) => l.role === "agent")
      expect(agent_dones.length).toBeGreaterThanOrEqual(1)

      expect(exit_code).toBe(0)
    },
    { timeout: 120_000 },
  )

  ollama_test(
    "tool calling (drafter)",
    async () => {
      const { lines, exit_code } = await run_agent(
        '{"role":"user","content":"List the files in the current directory using ls"}',
        "agents/drafter.json",
      )

      expect(lines.length).toBeGreaterThan(0)

      const done_lines = lines.filter((l) => l.done === true)

      const process_calls = done_lines.filter((l) => l.role?.startsWith("process_call:bash"))
      expect(process_calls.length).toBeGreaterThanOrEqual(1)

      const process_results = done_lines.filter((l) => l.role?.startsWith("process_result:bash"))
      expect(process_results.length).toBeGreaterThanOrEqual(1)
      expect(process_results.some((l) => l.exit_code === 0)).toBe(true)

      const agent_dones = done_lines.filter((l) => l.role === "agent")
      expect(agent_dones.length).toBeGreaterThanOrEqual(1)

      expect(exit_code).toBe(0)
    },
    { timeout: 120_000 },
  )

  ollama_test(
    "classification with think:false (classifier)",
    async () => {
      const { lines, exit_code } = await run_agent(
        '{"role":"user","content":"Categories: question, request, greeting. Classify: Hello there"}',
        "agents/classifier.json",
      )

      expect(lines.length).toBeGreaterThan(0)

      const done_lines = lines.filter((l) => l.done === true)
      const agent_dones = done_lines.filter((l) => l.role === "agent")
      expect(agent_dones.length).toBe(1)
      // Content should be short (single word classification)
      expect((agent_dones[0].content as string).length).toBeLessThan(50)

      expect(exit_code).toBe(0)
    },
    { timeout: 30_000 },
  )
})
