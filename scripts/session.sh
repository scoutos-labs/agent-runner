#!/usr/bin/env zsh
set -euo pipefail

# session.sh - Quick launcher for agent sessions
#
# Usage:
#   session.sh <goal>
#   echo "goal" | session.sh

if [[ $# -gt 0 ]]; then
  goal="$*"
elif [[ ! -t 0 ]]; then
  goal=$(cat)
else
  echo "Usage: session.sh <goal>" >&2
  echo "   or: echo 'goal' | session.sh" >&2
  exit 1
fi

echo "$goal" | agent @example
