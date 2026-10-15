#!/usr/bin/env bash
# Wrapper del harness mtg-bench para el piloto. Uso:
#   bin/bench.sh match config/pilot.yaml --seats flash,forge-ai-1 --decks <abs>/a.dck,<abs>/b.dck --matches 4 --parallel 2 --run-id X [--seed N]
# --alternate (extensión propia): prende event.playDrawAlternate (match impar sale el seat 0, par el seat 1).
# --seed N (extensión propia): copia el yaml a runs/.cfg/ con `seed: N` y usa esa copia. Cada run con semilla distinta
# juega barajadas distintas; con la misma semilla, el match k de cualquier run repite la misma barajada (comparación apareada).
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -f "$HOME/.claude/secrets/op-llm-proxy.env" ]]; then
  set -a; source "$HOME/.claude/secrets/op-llm-proxy.env"; set +a
  export MTG_LLM_KEY="${MTG_LLM_KEY:-${BHUB_MCP_LLM_KEY:-}}"
fi
seed=""; alternate=""; args=()
while (($#)); do
  case "$1" in
    --seed) seed="$2"; shift 2; continue ;;
    --alternate) alternate=1; shift; continue ;;
    config/*) args+=("$root/$1") ;;
    *) args+=("$1") ;;
  esac
  shift
done
if [[ -n "$seed" || -n "$alternate" ]]; then
  for i in "${!args[@]}"; do
    if [[ "${args[$i]}" == *.yaml ]]; then
      src="${args[$i]}"; mkdir -p "$root/runs/.cfg"
      dst="$root/runs/.cfg/$(basename "${src%.yaml}")${seed:+-seed$seed}${alternate:+-alt}.yaml"
      sed -E "${seed:+s/^(  seed:) .*/\1 $seed/;}${alternate:+s/^(  playDrawAlternate:) .*/\1 true/;}" "$src" > "$dst"
      [[ -z "$seed" ]] || grep -qE "^  seed: $seed$" "$dst" || { echo "no pude fijar seed en $src" >&2; exit 1; }
      [[ -z "$alternate" ]] || grep -qE "^  playDrawAlternate: true$" "$dst" || { echo "no pude prender playDrawAlternate en $src (falta la clave)" >&2; exit 1; }
      args[$i]="$dst"; break
    fi
  done
fi
cd "$root/vendor/mtg-bench"
exec npm run --silent bench -- "${args[@]}"
