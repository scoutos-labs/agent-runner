import type { Message, AgentManifest } from "./types"
import { parse_role } from "./types"
import { create_encoder } from "./wire"
import { call_llm } from "./adapter"
import { execute_process } from "./executor"

const MAX_TURNS = 20

export async function run(
  input_messages: Message[],
  manifest: AgentManifest,
): Promise<number> {
  const encoder = create_encoder(process.stdout)
  const messages: Message[] = [...input_messages]
  let exhausted = false

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const result = await call_llm(messages, manifest, encoder)
    messages.push(...result.messages)

    // Find process_call messages in the returned batch
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

    // Mark exhausted if this is the last iteration
    if (turn === MAX_TURNS - 1) {
      exhausted = true
    }
  }

  if (exhausted) {
    console.error(`agent-runner: max turns (${MAX_TURNS}) reached, stopping`)
    return 1
  }

  return 0
}
