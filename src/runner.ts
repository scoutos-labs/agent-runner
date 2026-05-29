import type { Message, AgentManifest } from "./types"
import { parse_role } from "./types"
import { create_encoder } from "./wire"
import { call_llm as call_openai } from "./openai-adapter"
import { call_ollama } from "./ollama-adapter"
import { run_command_adapter } from "./command-adapter"
import { resolve_adapter } from "./presets"
import { execute_process } from "./executor"
import type { AdapterResult } from "./openai-adapter"
import type { Encoder } from "./wire"

const DEFAULT_MAX_TURNS = Number(process.env.AGENT_RUNNER_MAX_TURNS ?? 20)
const HARD_MAX_TURNS = Number(process.env.AGENT_RUNNER_HARD_MAX_TURNS ?? 200)

type CallFn = (messages: Message[], manifest: AgentManifest, encoder: Encoder) => Promise<AdapterResult>

const BUILT_IN_ADAPTERS: Record<string, CallFn> = {
  openai: call_openai,
  ollama: call_ollama,
}

export function resolve_max_turns(manifest: AgentManifest): number {
  const configured = manifest.options?.runner?.max_turns
  const requested = typeof configured === "number" ? configured : DEFAULT_MAX_TURNS

  if (!Number.isFinite(requested) || requested < 1) {
    return DEFAULT_MAX_TURNS
  }

  return Math.min(Math.floor(requested), HARD_MAX_TURNS)
}

export function build_runner_system_prompt(max_turns: number): string {
  return [
    "## Runner Budget",
    `This agent-runner invocation allows at most ${max_turns} model turns.`,
    "A turn is one model response, whether it answers directly or calls tools.",
    "Manage the budget deliberately: batch safe read-only checks, avoid repetitive tool loops, and reserve enough turns to verify and summarize.",
    "If the work cannot be completed inside the remaining budget, stop before exhaustion and report the exact remaining blocker plus the next command or decision needed.",
  ].join("\n")
}

export async function run(
  input_messages: Message[],
  manifest: AgentManifest,
): Promise<number> {
  const encoder = create_encoder(process.stdout)
  const messages: Message[] = [...input_messages]

  const config = resolve_adapter(manifest.adapter ?? "openai", manifest, messages)
  const max_turns = resolve_max_turns(manifest)
  messages.unshift({ role: "system", content: build_runner_system_prompt(max_turns) })

  // Command-based adapter — self-managed tool loop
  if (config.kind === "command") {
    const result = await run_command_adapter(config, encoder, messages)
    return result.exit_code === 0 ? 0 : 1
  }

  // Built-in adapter — runner manages the tool loop
  const call_fn = BUILT_IN_ADAPTERS[config.name]
  if (!call_fn) {
    console.error(`agent-runner: unknown built-in adapter: ${config.name}`)
    return 1
  }

  let exhausted = false

  for (let turn = 0; turn < max_turns; turn++) {
    const result = await call_fn(messages, manifest, encoder)
    messages.push(...result.messages)

    const calls = result.messages.filter((msg) => {
      const parsed = parse_role(msg.role)
      return parsed.type === "process_call"
    })

    // No process calls — agent is done
    if (calls.length === 0) break

    // Execute each process call
    for (const call of calls) {
      const parsed = parse_role(call.role)
      const process_name = parsed.identity ?? "unknown"
      const result_msg = await execute_process(
        call.call_id!,
        process_name,
        call.content as Record<string, unknown>,
        encoder,
      )
      messages.push(result_msg)
    }

    if (turn === max_turns - 1) {
      exhausted = true
    }
  }

  if (exhausted) {
    console.error(`agent-runner: max turns (${max_turns}) reached, stopping`)
    return 1
  }

  return 0
}
