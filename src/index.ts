import { decode_stdin } from "./wire"
import { run } from "./runner"
import { parse_role } from "./types"
import { load_manifest } from "./manifest"

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

  // Read input messages
  const messages = await decode_stdin()

  // Verify at least one user message exists.
  // In a chained stream (agent A | agent B), the input only has agent
  // messages. Promote the last complete agent message to user so
  // downstream adapters find a goal. This preserves all other
  // composition patterns (resume, fan-out, tee) because those already
  // contain user messages and this fallback never activates.
  const has_user = messages.some((msg) => msg.role && parse_role(msg.role).type === "user")
  if (!has_user) {
    let promoted = false
    for (let i = messages.length - 1; i >= 0; i--) {
      const parsed = parse_role(messages[i].role)
      if (parsed.type === "agent" && messages[i].done && typeof messages[i].content === "string") {
        messages[i] = { ...messages[i], role: "user" }
        promoted = true
        break
      }
    }
    if (!promoted) {
      console.error("agent-runner: no user or agent message found in input")
      process.exit(1)
    }
  }

  const exit_code = await run(messages, manifest)
  process.exit(exit_code)
}

main()
