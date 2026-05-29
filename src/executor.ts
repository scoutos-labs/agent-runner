import type { Message } from "./types"
import type { Encoder } from "./wire"

const DEFAULT_PROCESS_TIMEOUT_MS = Number(process.env.AGENT_RUNNER_PROCESS_TIMEOUT_MS ?? 10 * 60 * 1000)

export async function execute_process(
  call_id: string,
  process_name: string,
  input: Record<string, unknown>,
  encoder: Encoder,
): Promise<Message> {
  if (process_name !== "bash") {
    console.error(`agent-runner: unknown process: ${process_name}`)
    const result_id = encoder.next_id()
    const role = `process_result:${process_name}`
    const content = `Error: unknown process "${process_name}"`
    encoder.done(result_id, role, content, { call_id, exit_code: 1 })
    return { id: result_id, role, content, done: true, call_id, exit_code: 1 }
  }

  const command = input.command as string
  const timeout_ms = typeof input.timeout_ms === "number" ? input.timeout_ms : DEFAULT_PROCESS_TIMEOUT_MS
  const proc = Bun.spawn(["sh", "-c", command], {
    stdout: "pipe",
    stderr: "pipe",
  })

  let timed_out = false
  const timeout_handle = setTimeout(() => {
    timed_out = true
    try { proc.kill("SIGTERM") } catch { /* already exited */ }
    setTimeout(() => {
      try { proc.kill("SIGKILL") } catch { /* already exited */ }
    }, 2000)
  }, timeout_ms)

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])

  await proc.exited
  clearTimeout(timeout_handle)

  const exit_code = timed_out ? 124 : proc.exitCode ?? 1
  const parts: string[] = []
  if (stdout) parts.push(stdout)
  if (stderr) parts.push(stderr)
  if (timed_out) parts.push(`Error: process timed out after ${timeout_ms / 1000}s`)
  const content = parts.join("\n")

  const result_id = encoder.next_id()
  const role = `process_result:${process_name}`
  encoder.done(result_id, role, content, { call_id, exit_code })
  return { id: result_id, role, content, done: true, call_id, exit_code }
}
