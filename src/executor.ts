import type { Message } from "./types"
import type { Encoder } from "./wire"

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
  const proc = Bun.spawn(["sh", "-c", command], {
    stdout: "pipe",
    stderr: "pipe",
  })

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])

  await proc.exited

  const exit_code = proc.exitCode ?? 1
  const parts: string[] = []
  if (stdout) parts.push(stdout)
  if (stderr) parts.push(stderr)
  const content = parts.join("\n")

  const result_id = encoder.next_id()
  const role = `process_result:${process_name}`
  encoder.done(result_id, role, content, { call_id, exit_code })
  return { id: result_id, role, content, done: true, call_id, exit_code }
}
