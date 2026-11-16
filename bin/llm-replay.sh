#!/usr/bin/env bash
# Repite decisiones GRABADAS de un run contra el modelo vivo, con las secciones y políticas del árbol actual.
# Sirve para ver en segundos si el modelo le hace caso a una sección nueva, sin esperar los 50 min de un duelo
# (que además puede no volver a pasar por la misma posición). Una decisión contestada por una política sale con 0 llamadas.
# Uso:
#   bin/llm-replay.sh config/pilot-math.yaml runs/<run>/rendered-prompts.jsonl --ids <requestId,...> [--seat glm] [--as <seat del config>] [--n 3] [--prompt 1]
#   --seat  seat cuyas decisiones grabadas se repiten (default glm)      --as  seat del config que las contesta ahora (default el mismo)
#   --n     repeticiones por decisión                                    --prompt 1  imprime el prompt tal como sale hoy
# Gasta tokens del proxy (una llamada por repetición). La key sale de ~/.claude/secrets, igual que en bin/bench.sh.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -f "$HOME/.claude/secrets/op-llm-proxy.env" ]]; then
  set -a; source "$HOME/.claude/secrets/op-llm-proxy.env"; set +a
  export MTG_LLM_KEY="${MTG_LLM_KEY:-${BHUB_MCP_LLM_KEY:-}}"
fi
export MTG_LLM_BASE_URL="${MTG_LLM_BASE_URL:-${OP_LLM_PROXY_URL:-}}"
args=()
for a in "$@"; do
  case "$a" in
    config/*|runs/*) args+=("$root/$a") ;;
    *) args+=("$a") ;;
  esac
done
cd "$root/vendor/mtg-bench"
exec npx tsx src/knowledge/llm-replay.ts "${args[@]}"
