import { decode_stdin } from "./wire"
import { run } from "./runner"
import { parse_role } from "./types"
import type { AgentManifest } from "./types"

const USAGE = `Usage: agent-runner run --agent <path>

Pipe JSONL messages to stdin:
  echo '{"role":"user","content":"Hello"}' | bun run src/index.ts run --agent agents/basic.json`

function parse_args(args: string[]): { agent_path: string } | null {
  const run_idx = args.indexOf("run")
  if (run_idx === -1) return null

  const agent_idx = args.indexOf("--agent")
  if (agent_idx === -1 || agent_idx + 1 >= args.length) return null

  return { agent_path: args[agent_idx + 1] }
}

async function main() {
  const args = process.argv.slice(2)
  const parsed = parse_args(args)

  if (!parsed) {
    console.error(USAGE)
    process.exit(1)
  }

  // Check if stdin is a TTY (no piped input)
  if (Bun.stdin.stream().locked === false && process.stdin.isTTY) {
    console.error(USAGE)
    process.exit(1)
  }

  // Load manifest
  let manifest: AgentManifest
  try {
    manifest = await Bun.file(parsed.agent_path).json()
  } catch (err) {
    console.error(`agent-runner: failed to load manifest: ${parsed.agent_path}`)
    process.exit(1)
  }

  // Read input messages
  const messages = await decode_stdin()

  // Verify at least one user message exists
  const has_user = messages.some((msg) => msg.role && parse_role(msg.role).type === "user")
  if (!has_user) {
    console.error("agent-runner: no user message found in input")
    process.exit(1)
  }

  const exit_code = await run(messages, manifest)
  process.exit(exit_code)
}

main()
