import { describe, expect, test } from "bun:test"
import { execute_process } from "./executor"
import { create_encoder } from "./wire"

function encoder() {
  return create_encoder({ write() {} })
}

describe("execute_process", () => {
  test("returns exit 124 when a command times out", async () => {
    const result = await execute_process(
      "call_timeout",
      "bash",
      { command: "sleep 1", timeout_ms: 10 },
      encoder(),
    )

    expect(result.exit_code).toBe(124)
    expect(result.content).toContain("process timed out")
  })
})
