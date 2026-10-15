#!/usr/bin/env bash
# Vara de stock (IA de Forge contra IA de Forge) para un mazo nuevo contra una lista de rivales, salir/robar balanceado.
# Uso: bin/stock-bar.sh <slug> <rival1,rival2,...> [matches=12] [seed=101]   → runs/stock-<slug>-vs-<rival>-x<n>-seed<seed>-alt
set -uo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"; D="$root/decks"; deck="$1"; IFS=, read -ra opps <<< "$2"; n="${3:-12}"; seed="${4:-101}"
short() { echo "$1" | sed 's/red-madness/red/; s/blue-terror/terror/; s/grixis-control/grixis/; s/azorius-faeries/faeries/'; }
for o in "${opps[@]}"; do
  id="stock-$(short $deck)-vs-$(short $o)-x$n-seed$seed-alt"
  "$root/bin/bench.sh" match config/pilot-math.yaml --seats forge-ai-1,forge-ai-2 --decks "$D/pauper-$deck.dck,$D/pauper-$o.dck" --matches "$n" --parallel 2 --seed "$seed" --alternate --run-id "$id" > "$root/runs/$id.log" 2>&1
  echo "$(date +%H:%M:%S) done $id: $(grep -c 'match [0-9]*: forge-ai-1 (W)' "$root/runs/$id.log")-$(grep -c 'match [0-9]*: .* (L)' "$root/runs/$id.log")"
done
