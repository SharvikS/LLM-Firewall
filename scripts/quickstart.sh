#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_ENV="$ROOT/.env"
GATEWAY_ENV="$ROOT/gateway/.env"

log() {
  printf '%s\n' "$*"
}

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

env_value() {
  local file="$1"
  local key="$2"
  [ -f "$file" ] || return 0
  awk -v key="$key" '
    index($0, key "=") == 1 {
      sub("^[^=]*=", "")
      print
      exit
    }
  ' "$file"
}

set_env() {
  local file="$1"
  local key="$2"
  local value="$3"
  local escaped

  touch "$file"
  escaped="$(printf '%s' "$value" | sed -e 's/[\/&|]/\\&/g')"
  if grep -q "^${key}=" "$file"; then
    sed -i.bak "s|^${key}=.*|${key}=${escaped}|" "$file"
    rm -f "${file}.bak"
  else
    printf '\n%s=%s\n' "$key" "$value" >> "$file"
  fi
}

random_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
  fi
}

ensure_prereqs() {
  command -v docker >/dev/null 2>&1 || die "Docker is not installed. Install Docker Desktop, start it, then rerun ./scripts/quickstart.sh."
  docker info >/dev/null 2>&1 || die "Docker is installed but not running. Start Docker Desktop, then rerun ./scripts/quickstart.sh."
  docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required. Update Docker Desktop, then rerun ./scripts/quickstart.sh."
}

ensure_env_files() {
  if [ ! -f "$ROOT_ENV" ]; then
    cp "$ROOT/.env.example" "$ROOT_ENV"
    log "Created .env from .env.example"
  fi

  if [ ! -f "$GATEWAY_ENV" ]; then
    cp "$ROOT/gateway/.env.example" "$GATEWAY_ENV"
    log "Created gateway/.env from gateway/.env.example"
  fi
}

ensure_admin_token() {
  local token
  token="$(env_value "$ROOT_ENV" ADMIN_TOKEN)"

  if [ -z "$token" ] || [ "$token" = "your-admin-token-here" ]; then
    token="$(random_secret)"
    set_env "$ROOT_ENV" ADMIN_TOKEN "$token"
    log "Generated ADMIN_TOKEN in .env"
  fi

  set_env "$GATEWAY_ENV" ADMIN_TOKEN "$token"
}

prompt_provider_key() {
  local current
  local provider_key
  current="$(env_value "$GATEWAY_ENV" GROQ_API_KEY)"

  if [ -n "$current" ] && [ "$current" != "your-groq-api-key-here" ]; then
    log "Provider API key already exists in gateway/.env"
    return
  fi

  if [ -t 0 ]; then
    printf '\nPaste a Groq API key for live model calls, or press Enter to skip: '
    read -r provider_key
    if [ -n "$provider_key" ]; then
      set_env "$GATEWAY_ENV" GROQ_API_KEY "$provider_key"
      log "Saved provider API key in gateway/.env"
      return
    fi
  fi

  log "No provider API key set. The dashboard will run, but live upstream model calls can fail until gateway/.env is updated."
}

wait_for_url() {
  local label="$1"
  local url="$2"
  local seconds="$3"
  local elapsed=0

  if ! command -v curl >/dev/null 2>&1; then
    log "curl not found; skipping wait for $label"
    return
  fi

  printf 'Waiting for %s' "$label"
  until curl -fsS "$url" >/dev/null 2>&1; do
    elapsed=$((elapsed + 3))
    if [ "$elapsed" -ge "$seconds" ]; then
      printf '\n'
      log "$label did not respond yet. Docker may still be pulling models or building images."
      return
    fi
    printf '.'
    sleep 3
  done
  printf ' ready\n'
}

main() {
  cd "$ROOT"

  log "TITAN Gateway quickstart"
  log "Repository: $ROOT"

  ensure_prereqs
  ensure_env_files
  ensure_admin_token
  prompt_provider_key

  log ""
  log "Starting the full Docker stack..."
  docker compose up -d --build

  log ""
  wait_for_url "gateway" "http://localhost:8080/health" 240
  wait_for_url "dashboard login" "http://localhost:3000/login" 180

  log ""
  log "TITAN is ready to open:"
  log "  Dashboard:        http://localhost:3000"
  log "  Gateway:          http://localhost:8080"
  log "  API docs:         http://localhost:8080/docs"
  log "  Grafana:          http://localhost:3001"
  log ""
  log "Dashboard login:"
  log "  admin@titan.local / admin@123"
  log ""
  log "Smoke test:"
  log "  ./scripts/smoke.sh"
  log ""
  log "Stop everything:"
  log "  docker compose down"
}

main "$@"
