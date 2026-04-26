#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:-dev}"
HOST_WORKSPACE_DIR="${AGENT_WORKSPACE:-$ROOT_DIR/workspace}"
FALLBACK_WORKSPACE_DIR="${LOCALAGNENT_WORKSPACE_FALLBACK:-$HOME/.local/share/localagnent/workspace}"

if [[ "$#" -gt 0 ]]; then
  shift
fi

pid_files=()

cleanup() {
  for pid_file in "${pid_files[@]}"; do
    if [[ -f "$pid_file" ]]; then
      local pid
      pid="$(cat "$pid_file")"
      if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
        kill "$pid" 2>/dev/null || true
      fi
      rm -f "$pid_file"
    fi
  done
}

trap cleanup EXIT INT TERM

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    echo "Install it, then rerun this command." >&2
    exit 1
  fi
}

ensure_workspace_dir() {
  if mkdir -p "$HOST_WORKSPACE_DIR" 2>/dev/null && [[ -w "$HOST_WORKSPACE_DIR" ]]; then
    return
  fi

  echo "Workspace is not writable: $HOST_WORKSPACE_DIR" >&2
  echo "Using writable fallback workspace: $FALLBACK_WORKSPACE_DIR" >&2
  HOST_WORKSPACE_DIR="$FALLBACK_WORKSPACE_DIR"

  if ! mkdir -p "$HOST_WORKSPACE_DIR"; then
    echo "Failed to create fallback workspace: $HOST_WORKSPACE_DIR" >&2
    exit 1
  fi
}

check_unsafe_mode() {
  if ! command -v gdbus >/dev/null 2>&1; then
    echo "GNOME unsafe-mode check skipped: gdbus is not installed"
    return
  fi

  local output
  output="$(gdbus call \
    --session \
    --dest org.gnome.Shell \
    --object-path /org/gnome/Shell \
    --method org.gnome.Shell.Eval \
    'global.context.unsafe_mode' 2>/dev/null || true)"

  if [[ "$output" == *"true"* ]]; then
    echo "GNOME Shell unsafe mode: enabled"
    return
  fi

  echo "GNOME Shell unsafe mode: disabled"
  echo "Window listing and basic X11 actions will use the host X11 fallback when available."
  echo "For full upstream GNOME Shell window control, enable unsafe mode manually:"
  echo "  Alt+F2 -> lg -> global.context.unsafe_mode = true"
}

main() {
  require_command docker
  ensure_workspace_dir

  case "$MODE" in
    dev|prod)
      check_unsafe_mode
      ;;
    infra)
      ;;
    *)
      echo "Unknown mode: $MODE" >&2
      echo "Usage: $0 [dev|prod|infra] [docker compose up args...]" >&2
      exit 1
      ;;
  esac

  cd "$ROOT_DIR"

  case "$MODE" in
    dev)
      echo "Starting Docker Compose infra + sandbox stack"
      AGENT_WORKSPACE="$HOST_WORKSPACE_DIR" docker compose up agent_app postgres neo4j scrapling-mcp cognee "$@"
      ;;
    prod)
      echo "Starting Docker Compose infra + sandbox stack"
      AGENT_WORKSPACE="$HOST_WORKSPACE_DIR" docker compose up --build agent_app postgres neo4j scrapling-mcp cognee "$@"
      ;;
    infra)
      echo "Starting Docker Compose infrastructure stack"
      AGENT_WORKSPACE="$HOST_WORKSPACE_DIR" docker compose up agent_app postgres neo4j scrapling-mcp cognee "$@"
      ;;
  esac
}

main "$@"
