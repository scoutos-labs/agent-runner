import type { AgentManifest, Message, AdapterConfig, CommandAdapterConfig } from "./types"
import { build_prompt, build_system_prompt } from "./claude-adapter"

type PresetBuilder = (manifest: AgentManifest, messages: Message[]) => AdapterConfig

const PRESETS: Record<string, PresetBuilder> = {
  openai: (): AdapterConfig => ({
    kind: "built_in",
    name: "openai",
  }),

  ollama: (): AdapterConfig => ({
    kind: "built_in",
    name: "ollama",
  }),

  claude: (manifest, messages): CommandAdapterConfig => {
    const opts = manifest.options?.["claude"] ?? {}
    const prompt = build_prompt(messages)
    const system = build_system_prompt(messages, manifest)
    const model = opts.model as string | undefined
    const max_turns = opts.max_turns as number | undefined
    const permission_mode = (opts.permission_mode as string) ?? "bypassPermissions"

    const cmd: string[] = [
      "claude", "-p", prompt,
      "--output-format", "stream-json",
      "--verbose",
      "--permission-mode", permission_mode,
    ]

    if (system) cmd.push("--append-system-prompt", system)
    if (model) cmd.push("--model", model)
    if (max_turns !== undefined) cmd.push("--max-turns", String(max_turns))

    return {
      kind: "command",
      name: "claude",
      cmd,
      output_format: "claude-stream-json",
    }
  },
}

/**
 * Resolve an adapter string to a concrete config.
 *
 * Resolution order:
 * 1. Known preset name → build from preset
 * 2. Looks like a command string → raw command (wire format assumed)
 * 3. Otherwise → error
 */
export function resolve_adapter(
  adapter: string,
  manifest: AgentManifest,
  messages: Message[],
): AdapterConfig {
  const preset = PRESETS[adapter]
  if (preset) return preset(manifest, messages)

  if (is_command_string(adapter)) {
    return {
      kind: "command",
      name: "custom",
      cmd: parse_command_string(adapter),
      output_format: "wire",
    }
  }

  throw new Error(`Unknown adapter: "${adapter}". Not a known preset or valid command string.`)
}

function is_command_string(s: string): boolean {
  return s.includes(" ") || s.startsWith("/") || s.startsWith("./") || s.startsWith("~")
}

export function parse_command_string(s: string): string[] {
  return s.split(/\s+/).filter(Boolean)
}
