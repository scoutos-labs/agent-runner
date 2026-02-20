#!/usr/bin/env bash
#
# run-plan.sh - Execute implementation plan iteratively via claude
#
# Usage: scripts/run-plan.sh [OPTIONS] [PLAN_PATH]
#
# Options:
#   --max-steps N   Maximum iterations (default: 25)

set -euo pipefail

# Defaults
MAX_ITERATIONS=25
PLAN_PATH=""

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --max-steps)
            MAX_ITERATIONS="$2"
            shift 2
            ;;
        --max-steps=*)
            MAX_ITERATIONS="${1#*=}"
            shift
            ;;
        -h|--help)
            echo "Usage: $0 [OPTIONS] [PLAN_PATH]"
            echo ""
            echo "Options:"
            echo "  --max-steps N   Maximum steps/iterations (default: 25)"
            echo "  -h, --help      Show this help message"
            exit 0
            ;;
        -*)
            echo "Unknown option: $1"
            exit 1
            ;;
        *)
            PLAN_PATH="$1"
            shift
            ;;
    esac
done

PLAN_PATH="${PLAN_PATH:-$HOME/Documents/PROJECTS/agent-runner/docs/2026-02-20--bun-runner-plan.md}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Ensure we're in the right directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [[ ! -f "$REPO_ROOT/package.json" ]] && [[ ! -d "$REPO_ROOT/src" ]]; then
    # Might be running before bootstrap — that's ok for task 0.1
    echo -e "${YELLOW}Note: Project not yet bootstrapped — first task will set it up${NC}"
fi

cd "$REPO_ROOT"

if [[ ! -f "$PLAN_PATH" ]]; then
    echo -e "${RED}Error: Plan not found at: $PLAN_PATH${NC}"
    exit 1
fi

echo -e "${BLUE}======================================${NC}"
echo -e "${BLUE}  Agent Runner — Plan Executor${NC}"
echo -e "${BLUE}======================================${NC}"
echo ""
echo -e "Plan: ${YELLOW}$PLAN_PATH${NC}"
echo -e "Max iterations: ${YELLOW}$MAX_ITERATIONS${NC}"
echo -e "Working directory: ${YELLOW}$REPO_ROOT${NC}"
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

You are a disciplined executor. This is iteration $iteration of $MAX_ITERATIONS.

## Context

You are building the Agent Runner — a Bun reference implementation of the Agent Runner spec.

**Important files:**
- Implementation plan: \`$PLAN_PATH\`
- Agent Runner spec: \`$HOME/Documents/PROJECTS/agent-runner/SPEC.md\`
- PRD: \`$HOME/Documents/PROJECTS/agent-runner/docs/prd-bun-runner.md\`
- Code directory: \`$REPO_ROOT\`

## Scope: ONE task only

You will complete exactly ONE unchecked task from the plan, then commit and STOP.

Do NOT look ahead. Do NOT do "while I'm here" extras. Do NOT combine tasks. ONE task, ONE commit, done.

## Steps

1. Read the plan at \`$PLAN_PATH\`
2. Read recent commits: \`git log --oneline -10\`
3. Find the FIRST unchecked task (\`- [ ]\`) — that is your ONLY job this iteration
4. Read the spec and PRD if needed for context on the current task
5. Do that task. Nothing more.
6. Check it off (\`- [x]\`) in the plan
7. Commit with format: \`type(scope): description [plan N.N]\`
8. STOP. Do not start the next task.

## Commit Guidelines

- Do NOT add Co-Authored-By or AI attribution to commits
- ALWAYS commit, even if blocked. Examples:
  - \`feat(wire): implement JSONL encoder [plan 1.2]\`
  - \`feat(executor): bash process executor [plan 2.1]\`
  - \`wip(adapter): blocked on streaming API shape [plan 3.2]\`

## Rules

- **ONE task per iteration. No exceptions.**
- If a task is blocked, note why in the commit message, check it off anyway, then STOP
- Do not skip tasks unless blocked
- If the next unchecked task requires human action, change the plan's \`**Status:**\` field to \`Agent Complete\`, commit, and STOP

## Current State

Remaining uncompleted tasks: $remaining
PROMPT_EOF
}

# Main loop
iteration=1
while [[ $iteration -le $MAX_ITERATIONS ]]; do
    remaining=$(count_remaining_tasks)

    if all_tasks_complete; then
        echo ""
        echo -e "${GREEN}======================================${NC}"
        echo -e "${GREEN}  SUCCESS! All tasks complete!${NC}"
        echo -e "${GREEN}======================================${NC}"
        echo ""
        echo -e "Completed in ${YELLOW}$((iteration - 1))${NC} iterations."
        exit 0
    fi

    if agent_done; then
        echo ""
        echo -e "${GREEN}======================================${NC}"
        echo -e "${GREEN}  Agent work complete!${NC}"
        echo -e "${GREEN}======================================${NC}"
        echo ""
        echo -e "Agent finished in ${YELLOW}$((iteration - 1))${NC} iterations."
        echo -e "Remaining tasks require ${YELLOW}human action${NC}."
        exit 0
    fi

    echo ""
    echo -e "${BLUE}...iteration $iteration/$MAX_ITERATIONS${NC} (${remaining} tasks remaining)"
    echo ""

    prompt=$(build_prompt "$iteration" "$remaining")

    if ! claude --permission-mode bypassPermissions -p "$prompt"; then
        echo -e "${YELLOW}Warning: Agent exited with non-zero status${NC}"
    fi

    sleep 2

    ((iteration++))
done

echo ""
echo -e "${RED}======================================${NC}"
echo -e "${RED}  Max iterations reached ($MAX_ITERATIONS)${NC}"
echo -e "${RED}======================================${NC}"
echo ""
remaining=$(count_remaining_tasks)
echo -e "Tasks remaining: ${YELLOW}$remaining${NC}"
echo ""
echo "To continue, run the script again."
exit 1
