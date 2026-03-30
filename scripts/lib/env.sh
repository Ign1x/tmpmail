#!/usr/bin/env bash

env_read() {
  local key="$1"
  local env_file="$2"
  local line
  local value

  if [ ! -f "$env_file" ]; then
    return 1
  fi

  line="$(grep -E "^${key}=" "$env_file" | tail -n 1 || true)"
  if [ -z "$line" ]; then
    return 1
  fi

  value="${line#*=}"

  if [[ "$value" =~ ^\"(.*)\"$ ]]; then
    value="${BASH_REMATCH[1]}"
  elif [[ "$value" =~ ^\'(.*)\'$ ]]; then
    value="${BASH_REMATCH[1]}"
  fi

  printf '%s' "$value"
}
