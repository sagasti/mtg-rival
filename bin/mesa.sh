#!/usr/bin/env bash
# Lobby de la mesa web: cuentas, mazos guardados por usuario y partida contra el piloto. Uso: bin/mesa.sh [--tunnel]
#   MESA_PORT (8787) · MESA_INVITE (código para crear cuenta; si falta se genera y se imprime) · admin: bin/mesa-admin.mjs
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -f "$HOME/.claude/secrets/op-llm-proxy.env" ]]; then set -a; source "$HOME/.claude/secrets/op-llm-proxy.env"; set +a; fi
if [[ "${1:-}" == "--tunnel" ]]; then
  cloudflared tunnel --url "http://localhost:${MESA_PORT:-8787}" 2>&1 | grep --line-buffered -o "https://[a-z0-9-]*\.trycloudflare\.com" &
fi
exec node "$root/bin/mesa.mjs"
