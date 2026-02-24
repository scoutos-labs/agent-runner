import { decode_stdin } from "./wire"
import { run } from "./runner"
import { load_manifest } from "./manifest"
import { ensure_user_message } from "./promote"

const USAGE = `Usage: agent-runner run --agent <path>

Pipe input to stdin (bare text or JSONL, .json or .md manifest):
  echo "Hello" | bun run src/index.ts run --agent agents/basic.json
  echo "Hello" | bun run src/index.ts run --agent path/to/PERSONA.md`

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

  // Load manifest (JSON or PERSONA.md)
  let manifest
  try {
    manifest = await load_manifest(parsed.agent_path)
  } catch (err) {
    console.error(`agent-runner: failed to load manifest: ${parsed.agent_path}`)
    process.exit(1)
  }

  // Read input messages, ensure a user message exists (promotes in chains)
  const messages = await decode_stdin()
  const result = ensure_user_message(messages)

  if (!result.ok) {
    console.error(`agent-runner: ${result.error}`)
    process.exit(1)
  }

  const exit_code = await run(result.messages, manifest)
  process.exit(exit_code)
}

main()
