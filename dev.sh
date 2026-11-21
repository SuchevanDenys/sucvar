#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# SUCVAR — run the whole stack (.NET API + Next.js) from one terminal.
#
#   ./dev.sh             # dotnet watch (hot reload) + next dev
#   ./dev.sh --no-watch  # plain `dotnet run` instead of `dotnet watch`
#   pnpm dev             # same thing, from the repo root
#
# Ctrl+C once stops both process trees and frees ports 5080 / 3000.
# Works with the macOS system bash 3.2 (no `wait -n`, no associative arrays).
# ════════════════════════════════════════════════════════════════════════════
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

API_PROJECT="backend/src/Sucvar.Api"
API_PORT=5080   # launchSettings.json "http" profile binds 0.0.0.0:5080 (localhost + LAN for the iPhone bridge).
                # Not 5000: macOS AirPlay Receiver (ControlCenter) listens there.
WEB_PORT=3000   # Cors:AllowedOrigins in appsettings*.json allows only this origin
WATCH=1

for arg in "$@"; do
  case "$arg" in
    --no-watch) WATCH=0 ;;
    -h|--help) sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done

if [ -t 1 ]; then
  C_API=$'\033[35m'; C_WEB=$'\033[36m'; C_DEV=$'\033[1;33m'; C_ERR=$'\033[1;31m'; C_OFF=$'\033[0m'
else
  C_API=''; C_WEB=''; C_DEV=''; C_ERR=''; C_OFF=''
fi
log()  { printf '%s[DEV]%s %s\n' "$C_DEV" "$C_OFF" "$*"; }
warn() { printf '%s[DEV] WARNING:%s %s\n' "$C_ERR" "$C_OFF" "$*" >&2; }
die()  { printf '%s[DEV] ERROR:%s %s\n' "$C_ERR" "$C_OFF" "$*" >&2; exit 1; }

# ── Preflight ───────────────────────────────────────────────────────────────
command -v dotnet >/dev/null 2>&1 || die "'dotnet' not found. Install the .NET 10 SDK: https://dotnet.microsoft.com/download"
command -v pnpm   >/dev/null 2>&1 || die "'pnpm' not found. Install it: corepack enable  (or: npm i -g pnpm)"
command -v lsof   >/dev/null 2>&1 || die "'lsof' not found (needed to check/free ports)."

[ -f frontend/.env.local ] || warn "frontend/.env.local is missing — copy frontend/.env.example and fill in the Supabase keys. NEXT_PUBLIC_API_URL falls back to http://localhost:$API_PORT."
[ -f "$API_PROJECT/appsettings.Development.json" ] || warn "$API_PROJECT/appsettings.Development.json is missing — dev CORS/logging overrides won't apply (CORS still defaults to http://localhost:$WEB_PORT)."
[ -f backend/.env ] || warn "backend/.env is missing — copy backend/.env.example; the API needs Supabase/Stripe/AI secrets from it."

if [ -f frontend/.env.local ]; then
  api_url="$(grep -E '^NEXT_PUBLIC_API_URL=' frontend/.env.local | tail -n1 | cut -d= -f2- | tr -d '"'\'' ')"
  if [ -n "$api_url" ] && [ "${api_url%/}" != "http://localhost:$API_PORT" ]; then
    warn "frontend/.env.local has NEXT_PUBLIC_API_URL=$api_url but the API listens on http://localhost:$API_PORT."
  fi
fi

port_pids() { lsof -nP -t -iTCP:"$1" -sTCP:LISTEN 2>/dev/null; }
for port in "$API_PORT" "$WEB_PORT"; do
  pids="$(port_pids "$port" | tr '\n' ' ')"
  if [ -n "$pids" ]; then
    pids="${pids% }"
    die "Port ${port} is already in use by PID(s) ${pids}. Stop it first (e.g. kill ${pids}) and re-run."
  fi
done

if [ ! -d frontend/node_modules ]; then
  log "frontend/node_modules missing — running pnpm install…"
  pnpm --dir frontend install || die "pnpm install failed."
fi

# ── Process management ──────────────────────────────────────────────────────
# Job control puts each background job in its own process group (PGID = job PID),
# so one `kill -- -PGID` reaches dotnet watch → the API child, and pnpm → next → its workers.
# It also keeps the terminal's Ctrl+C away from the children: only this script's trap handles it.
set -m

PIDS=()
STOPPING=0

prefix() { # $1 = label, $2 = color
  awk -v p="$2[$1]$C_OFF " '{ print p $0; fflush() }'
}

start() { # $1 = label, $2 = color, rest = command
  local label="$1" color="$2"; shift 2
  # stdin from /dev/null: a background process group that reads the TTY would be stopped by SIGTTIN.
  ( "$@" </dev/null 2>&1 | prefix "$label" "$color" ) &
  PIDS+=("$!")
}

kill_groups() { # $1 = signal
  local pid
  for pid in ${PIDS[@]+"${PIDS[@]}"}; do
    kill "-$1" -- "-$pid" 2>/dev/null || kill "-$1" "$pid" 2>/dev/null || true
  done
}

any_alive() {
  local pid
  for pid in ${PIDS[@]+"${PIDS[@]}"}; do
    kill -0 -- "-$pid" 2>/dev/null && return 0
  done
  return 1
}

cleanup() {
  local code=$?
  [ "$STOPPING" = 1 ] && return
  STOPPING=1
  trap '' INT TERM   # a second Ctrl+C must not abort the shutdown halfway
  echo
  log "Stopping API and WEB…"
  kill_groups TERM
  # The servers themselves exit within ~0.3s of SIGTERM. The `dotnet watch` supervisor and its
  # MSBuild node can take 10s+ to unwind, so: wait (max 8s) for both ports to be released,
  # allow a short grace period, then SIGKILL whatever tooling is still left in the groups.
  local i
  for i in $(seq 1 32); do
    any_alive || break
    [ -z "$(port_pids "$API_PORT")$(port_pids "$WEB_PORT")" ] && break
    sleep 0.25
  done
  for i in 1 2 3 4 5 6; do
    any_alive || break
    sleep 0.25
  done
  if [ -n "$(port_pids "$API_PORT")$(port_pids "$WEB_PORT")" ]; then
    warn "A server ignored SIGTERM for 8s — sending SIGKILL."
  fi
  kill_groups KILL
  # Last resort: anything still bound to our ports (e.g. a grandchild that called setsid).
  local port pids
  for port in "$API_PORT" "$WEB_PORT"; do
    pids="$(port_pids "$port")"
    [ -n "$pids" ] && kill -9 $pids 2>/dev/null
  done
  wait 2>/dev/null
  log "Stopped. Ports $API_PORT and $WEB_PORT are free."
  exit "$code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# ── Launch ──────────────────────────────────────────────────────────────────
export DOTNET_WATCH_SUPPRESS_LAUNCH_BROWSER=1
export DOTNET_WATCH_RESTART_ON_RUDE_EDIT=1   # never block on the interactive "restart?" prompt
export DOTNET_CLI_TELEMETRY_OPTOUT="${DOTNET_CLI_TELEMETRY_OPTOUT:-1}"

if [ "$WATCH" = 1 ]; then
  start API "$C_API" dotnet watch run --project "$API_PROJECT" --launch-profile http --non-interactive
else
  start API "$C_API" dotnet run --project "$API_PROJECT" --launch-profile http
fi
start WEB "$C_WEB" pnpm --dir frontend dev --port "$WEB_PORT"
# Job control off again: foreground commands below (sleep, kill) stay in this script's group,
# so the terminal's Ctrl+C reaches this shell and fires the INT trap.
set +m

log "API → http://localhost:$API_PORT  (health: /health, docs: /scalar)"
log "API (LAN / iPhone RoomPlan) → http://$(scutil --get LocalHostName 2>/dev/null || hostname -s).local:$API_PORT"
log "WEB → http://localhost:$WEB_PORT"
log "Press Ctrl+C to stop both."

# Bash 3.2 has no `wait -n`: poll, and shut everything down as soon as either side exits.
while :; do
  for pid in "${PIDS[@]}"; do
    if ! kill -0 "$pid" 2>/dev/null; then
      warn "A process exited — shutting down the rest."
      exit 1
    fi
  done
  sleep 1
done
