#!/usr/bin/env bash
#
# run-plan.sh - Execute an implementation plan iteratively via claude
#
# Usage: scripts/run-plan.sh [OPTIONS] <PLAN_PATH>
#
# Options:
#   --max-steps N   Maximum iterations (default: 25)

set -euo pipefail

MAX_ITERATIONS=25
PLAN_PATH=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --max-steps) MAX_ITERATIONS="$2"; shift 2 ;;
        --max-steps=*) MAX_ITERATIONS="${1#*=}"; shift ;;
        -h|--help)
            echo "Usage: $0 [--max-steps N] <PLAN_PATH>"
            echo ""
            echo "Iteratively executes tasks from a markdown plan file."
            echo "Each iteration completes one unchecked task (- [ ]) and commits."
            exit 0
            ;;
        -*) echo "Unknown option: $1" >&2; exit 1 ;;
        *) PLAN_PATH="$1"; shift ;;
    esac
done

if [[ -z "$PLAN_PATH" ]]; then
    echo "Error: plan path is required" >&2
    echo "Usage: $0 [--max-steps N] <PLAN_PATH>" >&2
    exit 1
fi

if [[ ! -f "$PLAN_PATH" ]]; then
    echo "Error: plan not found at: $PLAN_PATH" >&2
    exit 1
fi

PLAN_PATH="$(cd "$(dirname "$PLAN_PATH")" && pwd)/$(basename "$PLAN_PATH")"

echo "======================================"
echo "  agent-runner — Plan Executor"
echo "======================================"
echo ""
echo "Plan: $PLAN_PATH"
echo "Max iterations: $MAX_ITERATIONS"
echo ""

all_tasks_complete() {
    local unchecked
    unchecked=$({ grep -c '^\- \[ \]' "$PLAN_PATH" 2>/dev/null; } || true)
    [[ -z "$unchecked" || "$unchecked" -eq 0 ]]
}

agent_done() {
    grep -q '^\*\*Status:\*\* Agent Complete' "$PLAN_PATH" 2>/dev/null
}

count_remaining_tasks() {
    local count
    count=$({ grep -c '^\- \[ \]' "$PLAN_PATH" 2>/dev/null; } || true)
    echo "${count:-0}"
}

build_prompt() {
    local iteration=$1
    local remaining=$2

    cat <<PROMPT_EOF
# Task: Execute ONE Step of Implementation Plan

You are a disciplined executor. Iteration $iteration of $MAX_ITERATIONS.

## Plan

Read the plan at: \`$PLAN_PATH\`

## Scope: ONE task only

1. Read the plan
2. Find the FIRST unchecked task (\`- [ ]\`)
3. Implement it
4. Check it off (\`- [x]\`)
5. Commit with format: \`type(scope): description [plan N.N]\`
6. STOP — do not start the next task

## Rules

- ONE task per iteration, no exceptions
- If blocked, note why in the commit message, check it off, STOP
- Do not skip tasks

Remaining tasks: $remaining
PROMPT_EOF
}

iteration=1
while [[ $iteration -le $MAX_ITERATIONS ]]; do
    remaining=$(count_remaining_tasks)

    if all_tasks_complete; then
        echo ""
        echo "All tasks complete! Finished in $((iteration - 1)) iterations."
        exit 0
    fi

    if agent_done; then
        echo ""
        echo "Agent work complete in $((iteration - 1)) iterations."
        echo "Remaining tasks require human action."
        exit 0
    fi

    echo ""
    echo "--- iteration $iteration/$MAX_ITERATIONS ($remaining tasks remaining) ---"
    echo ""

    prompt=$(build_prompt "$iteration" "$remaining")

    if ! claude --model sonnet --permission-mode bypassPermissions -p "$prompt"; then
        echo "Warning: Agent exited with non-zero status"
    fi

    sleep 2
    ((iteration++))
done

echo ""
echo "Max iterations reached ($MAX_ITERATIONS). $(count_remaining_tasks) tasks remaining."
echo "Run again to continue."
exit 1
