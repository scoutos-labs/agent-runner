#!/bin/bash
# Minimal wire-format adapter. Reads JSONL messages from stdin,
# extracts the last user message, echoes it back as an agent response.
input=$(cat)
user_content=$(echo "$input" | grep '"role":"user"' | tail -1 | jq -r '.content // "no input"')
jq -cn --arg content "Echo adapter received: $user_content" \
  '{"id":"msg_1","role":"agent","done":true,"content":$content}'
