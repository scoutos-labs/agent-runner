#!/usr/bin/env zsh
set -euo pipefail

AGENT_DIR="$HOME/Code/agent-runner"
IDENTITY_DIR="$HOME/Code/dottie-weaver/identity"

# --- Pre: sync identity ---
git -C "$IDENTITY_DIR" pull --quiet 2>/dev/null || true

# --- Accept goal from argument or stdin ---
if [[ $# -gt 0 ]]; then
  goal="$*"
elif [[ ! -t 0 ]]; then
  goal=$(cat)
else
  echo "Usage: session.sh <goal>" >&2
  echo "   or: echo 'goal' | session.sh" >&2
  exit 1
fi

# --- Run ---
echo "$goal" | bun run "$AGENT_DIR/src/index.ts" run --agent "$AGENT_DIR/agents/dottie.json"
