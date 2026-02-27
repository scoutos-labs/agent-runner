# agent-runner

A lightweight, model-agnostic agent runtime. One unified wire format, multiple backends. Any LLM that can call tools can be an agent.

```bash
echo "hello" | agent @example           # Claude Code (Sonnet)
echo "hello" | agent @example-max       # Claude Code (Opus)
echo "hello" | agent @basic             # OpenAI (gpt-4o)
echo "hello" | agent @drafter           # Ollama (local)
```

Agents emit the same JSONL wire format on stdout — which means you can pipe them into each other:

```bash
agent @researcher < topic.md | agent @writer | agent @reviewer
```

## Quick Start

```bash
git clone https://github.com/scoutos-labs/agent-runner.git
cd agent-runner
bun install
```

Create an agent manifest and run it:

```bash
echo "List the files in this directory" | bun run src/index.ts run --agent agents/basic.json
```

Or use the `agent` CLI (symlink `bin/agent` to your PATH):

```bash
ln -s "$(pwd)/bin/agent" ~/.local/bin/agent
echo "hello" | agent @basic
```

## Architecture

```
stdin (text or JSONL) → wire.ts (parse)
                          ↓
                     manifest.ts (load agent config)
                          ↓
                     runner.ts (tool loop — max 20 turns)
                          ↓
              ┌───────────┼───────────┐
         openai-adapter  ollama-adapter  command-adapter
         (API streaming)  (local LLM)    (subprocess)
              └───────────┼───────────┘
                          ↓
                     executor.ts (runs bash processes)
                          ↓
                     wire.ts (encode) → stdout (JSONL)
```

### Wire Format

Five role types, JSONL on stdout:

| Role | Purpose |
|------|---------|
| `system` | System prompts |
| `user` | Human/upstream input |
| `agent` | LLM responses |
| `process_call:<name>` | Tool invocation |
| `process_result:<name>` | Tool result |

Each message: `{ id, role, content, done }`. Streaming uses `delta` for partial text. `call_id` links process calls to results.

### Adapters

Two categories:

- **Built-in** (OpenAI, Ollama) — runner manages the tool loop. Calls the API, executes process calls, feeds results back.
- **Command** (Claude Code, custom scripts) — subprocess manages its own tool loop. Runner translates the output into wire format.

### Agent Manifests

JSON files that configure an agent:

```json
{
  "name": "my-agent",
  "description": "What this agent does",
  "adapter": "claude",
  "system": "You are a helpful assistant.",
  "processes": [
    {
      "name": "bash",
      "description": "Execute a shell command",
      "input_schema": {
        "type": "object",
        "properties": {
          "command": { "type": "string" }
        },
        "required": ["command"]
      }
    }
  ],
  "options": {
    "claude": { "model": "sonnet" }
  }
}
```

Also supports [dot-agents](https://github.com/dot-agents/dot-agents) `PERSONA.md` files — YAML frontmatter for config, markdown body for system prompt.

### Composition

Auto-detection on input: if stdin is valid JSONL with `role` fields, it's treated as a message stream. Otherwise it's wrapped as a single user message.

When piping `agent A | agent B`, the runner promotes the last agent message to `user` role so downstream adapters find a goal. This makes Unix-style composition just work.

### Tiered Agents

Same agent identity at different capability levels:

```bash
echo "quick question" | agent @example-lite    # Haiku — fast, cheap
echo "build this"     | agent @example          # Sonnet — default
echo "design this"    | agent @example-max      # Opus — deep reasoning
```

## Agent Resolution

The `agent` CLI resolves `@name` in order:

1. `AGENT_PATH` directories (colon-separated)
2. Built-in `agents/` directory

```bash
# Use custom agent manifests alongside built-ins
export AGENT_PATH="./my-agents:~/.config/agents"
echo "hello" | agent @my-custom-agent
```

## Scripts

- `scripts/session.sh` — Quick launcher: `session.sh "your goal here"`
- `scripts/run-plan.sh` — Iterative plan executor: reads a markdown plan with `- [ ]` checkboxes, completes one task per iteration, commits each step

## Requirements

- [Bun](https://bun.sh) runtime
- At least one of: `OPENAI_API_KEY`, `claude` CLI, or [Ollama](https://ollama.ai) running locally

## Tests

```bash
bun test              # Unit tests (no API keys needed)
bun test specs/       # Smoke specs (requires API access)
```

## Related

- [session-studio](https://github.com/scoutos-labs/session-studio) — Web interface for visualizing agent-runner sessions

## License

MIT
