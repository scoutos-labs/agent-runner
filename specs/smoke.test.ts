import { describe, expect, test } from "bun:test"

const has_api_key = !!process.env.ANTHROPIC_API_KEY
const api_test = has_api_key ? test : test.skip

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

describe("end-to-end smoke specs", () => {
  api_test(
    "single tool call (UC-1)",
    async () => {
      const { lines, exit_code } = await run_agent(
        '{"role":"user","content":"List the files in the current directory using ls"}',
      )

      // Every line is valid JSON (enforced by run_agent parser)
      expect(lines.length).toBeGreaterThan(0)

      // Find done lines only
      const done_lines = lines.filter((l) => l.done === true)

      // At least one process_call:bash done line
      const process_calls = done_lines.filter((l) => l.role?.startsWith("process_call:bash"))
      expect(process_calls.length).toBeGreaterThanOrEqual(1)

      // At least one process_result:bash done line with exit_code: 0
      const process_results = done_lines.filter((l) => l.role?.startsWith("process_result:bash"))
      expect(process_results.length).toBeGreaterThanOrEqual(1)
      expect(process_results.some((l) => l.exit_code === 0)).toBe(true)

      // At least one agent done line (the final response)
      const agent_dones = done_lines.filter((l) => l.role === "agent")
      expect(agent_dones.length).toBeGreaterThanOrEqual(1)

      // Exit code is 0
      expect(exit_code).toBe(0)
    },
    { timeout: 30_000 },
  )

  api_test(
    "process failure (UC-4)",
    async () => {
      const { lines, exit_code } = await run_agent(
        '{"role":"user","content":"Read the file /nonexistent/path/that/does/not/exist.txt using cat"}',
      )

      // Every line is valid JSON (enforced by run_agent parser)
      expect(lines.length).toBeGreaterThan(0)

      const done_lines = lines.filter((l) => l.done === true)

      // process_result has exit_code > 0
      const process_results = done_lines.filter((l) => l.role?.startsWith("process_result"))
      expect(process_results.length).toBeGreaterThanOrEqual(1)
      expect(process_results.some((l) => l.exit_code !== undefined && l.exit_code > 0)).toBe(true)

      // Agent still produces a final response (handles the error)
      const agent_dones = done_lines.filter((l) => l.role === "agent")
      expect(agent_dones.length).toBeGreaterThanOrEqual(1)
    },
    { timeout: 30_000 },
  )

  api_test(
    "wire format consistency",
    async () => {
      const { lines } = await run_agent(
        '{"role":"user","content":"List the files in the current directory using ls"}',
      )

      const done_lines = lines.filter((l) => l.done === true)
      const delta_lines = lines.filter((l) => l.delta !== undefined)

      // For every id that has delta lines, a done line with the same id must exist
      const delta_ids = new Set(delta_lines.map((l) => l.id))
      const done_ids = new Set(done_lines.map((l) => l.id))

      for (const id of delta_ids) {
        expect(done_ids.has(id)).toBe(true)
      }

      // Every process_call done line has a matching process_result with call_id pointing back
      const call_dones = done_lines.filter((l) => l.role?.startsWith("process_call:"))
      const result_dones = done_lines.filter((l) => l.role?.startsWith("process_result:"))

      for (const call of call_dones) {
        const matching_result = result_dones.find((r) => r.call_id === call.id)
        expect(matching_result).toBeDefined()
      }
    },
    { timeout: 30_000 },
  )
})
