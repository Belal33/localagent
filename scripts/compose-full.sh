#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:-dev}"
GNOME_MCP_BIN="${GNOME_MCP_BIN:-$HOME/.cargo/bin/gnome-mcp-server}"
GNOME_MCP_PORT="${GNOME_MCP_PORT:-8930}"
X11_PROXY_DISPLAY="${AGENT_X11_DISPLAY:-:99}"
HOST_DISPLAY="${DISPLAY:-:1}"

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

display_number() {
  local display="$1"
  display="${display#localhost:}"
  display="${display#unix/}"
  display="${display#unix:}"
  display="${display#:}"
  display="${display%%.*}"
  echo "$display"
}

is_port_open() {
  node -e "const net=require('net'); const s=net.connect(Number(process.argv[1]), '127.0.0.1'); s.once('connect',()=>{s.end(); process.exit(0)}); s.once('error',()=>process.exit(1)); setTimeout(()=>process.exit(1), 500);" "$1" >/dev/null 2>&1
}

start_gnome_bridge() {
  if is_port_open "$GNOME_MCP_PORT"; then
    echo "GNOME MCP bridge already listening on port $GNOME_MCP_PORT"
    return
  fi

  if [[ ! -x "$GNOME_MCP_BIN" ]]; then
    echo "GNOME MCP server not found or not executable: $GNOME_MCP_BIN" >&2
    echo "Install it with: cargo install --path <gnome-mcp-server repo>" >&2
    exit 1
  fi

  require_command npx

  echo "Starting GNOME MCP bridge on http://localhost:$GNOME_MCP_PORT/mcp"
  nohup npx -y supergateway \
    --stdio "$GNOME_MCP_BIN" \
    --outputTransport streamableHttp \
    --port "$GNOME_MCP_PORT" \
    >/tmp/localagnent-gnome-mcp.log 2>&1 &

  local pid=$!
  local pid_file=/tmp/localagnent-gnome-mcp.pid
  echo "$pid" >"$pid_file"
  pid_files+=("$pid_file")
}

start_x11_proxy() {
  require_command socat

  local proxy_num host_num proxy_socket host_socket
  proxy_num="$(display_number "$X11_PROXY_DISPLAY")"
  host_num="$(display_number "$HOST_DISPLAY")"
  proxy_socket="/tmp/.X11-unix/X$proxy_num"
  host_socket="/tmp/.X11-unix/X$host_num"

  if [[ -z "$proxy_num" || -z "$host_num" ]]; then
    echo "Unable to parse DISPLAY values: DISPLAY=$HOST_DISPLAY AGENT_X11_DISPLAY=$X11_PROXY_DISPLAY" >&2
    exit 1
  fi

  if [[ "$proxy_num" == "$host_num" ]]; then
    echo "AGENT_X11_DISPLAY equals DISPLAY ($X11_PROXY_DISPLAY); using direct display without proxy"
    return
  fi

  mkdir -p /tmp/.X11-unix

  if [[ -S "$proxy_socket" ]]; then
    rm -f "$proxy_socket"
  fi

  echo "Starting X11 proxy $X11_PROXY_DISPLAY -> $HOST_DISPLAY"
  nohup socat \
    "UNIX-LISTEN:$proxy_socket,fork,mode=777" \
    "ABSTRACT-CONNECT:$host_socket" \
    >/tmp/localagnent-x11-proxy.log 2>&1 &

  local pid=$!
  local pid_file=/tmp/localagnent-x11-proxy.pid
  echo "$pid" >"$pid_file"
  pid_files+=("$pid_file")
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
  echo "Window listing and basic X11 actions will use the Docker X11 fallback."
  echo "For full upstream GNOME Shell window control, enable unsafe mode manually:"
  echo "  Alt+F2 -> lg -> global.context.unsafe_mode = true"
}

main() {
  require_command docker
  require_command node

  case "$MODE" in
    dev|prod)
      start_gnome_bridge
      start_x11_proxy
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
      echo "Starting Docker Compose dev stack"
      AGENT_X11_DISPLAY="$X11_PROXY_DISPLAY" docker compose --profile dev up "$@"
      ;;
    prod)
      echo "Starting Docker Compose prod stack"
      AGENT_X11_DISPLAY="$X11_PROXY_DISPLAY" docker compose --profile prod up --build "$@"
      ;;
    infra)
      echo "Starting Docker Compose infrastructure stack"
      docker compose up postgres neo4j scrapling-mcp cognee "$@"
      ;;
  esac
}

main "$@"
