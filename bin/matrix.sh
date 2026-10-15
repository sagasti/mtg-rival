#!/usr/bin/env bash
# Matriz GLM+math para un mazo nuevo: el piloto juega el mazo contra cada rival de stock y cada rival contra el mazo de stock.
# Uso: bin/matrix.sh <slug> <rival1,rival2,...> [matches=12] [seed=101]   (slugs = decks/pauper-<slug>.dck)
#   PREFIX=glm-v2 (default glm-math) cambia el prefijo de los run-ids; ALT=1 pasa --alternate (salir/robar balanceado)
#   ej: bin/matrix.sh blue-terror red-madness,bogles,elves
set -uo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
D="$root/decks"; prefix="${PREFIX:-glm-math}"; alt="${ALT:+--alternate}"; deck="$1"; IFS=, read -ra opps <<< "$2"; n="${3:-12}"; seed="${4:-101}"
short() { echo "$1" | sed 's/red-madness/red/; s/blue-terror/terror/'; }
run() { # id deckA deckB
  "$root/bin/bench.sh" match config/pilot-math.yaml --seats glm,forge-ai-1 --decks "$D/pauper-$2.dck,$D/pauper-$3.dck" --matches "$n" --parallel 2 --seed "$seed" $alt --run-id "$1" > "$root/runs/$1.log" 2>&1
  echo "$(date +%H:%M:%S) done $1: $(grep -c 'match [0-9]*: glm (W)' "$root/runs/$1.log")-$(grep -c 'match [0-9]*: .* (L)' "$root/runs/$1.log")"
}
for o in "${opps[@]}"; do
  run "$prefix-$(short $deck)-vs-$(short $o)-x$n-seed$seed" "$deck" "$o" &
  run "$prefix-$(short $o)-vs-$(short $deck)-x$n-seed$seed" "$o" "$deck" &
  wait
done
echo "$(date +%H:%M:%S) matrix $deck done"
