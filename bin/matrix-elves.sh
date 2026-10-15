#!/usr/bin/env bash
# Matriz GLM+math con el tercer mazo (Elves): el piloto juega cada lado de cada pareja, 12 partidas, seed 101, de a dos runs.
set -uo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
D="$root/decks"
run() { # id seats deckA deckB
  "$root/bin/bench.sh" match config/pilot-math.yaml --seats "$2" --decks "$D/$3,$D/$4" --matches 12 --parallel 2 --seed 101 --run-id "$1" > "$root/runs/$1.log" 2>&1
  echo "$(date +%H:%M:%S) done $1: $(grep -c 'match [0-9]*: glm (W)' "$root/runs/$1.log")-$(grep -c 'match [0-9]*: .* (L)' "$root/runs/$1.log")"
}
run glm-math-elves-vs-red-x12-seed101   glm,forge-ai-1 pauper-elves.dck pauper-red-madness.dck &
run glm-math-red-vs-elves-x12-seed101   glm,forge-ai-1 pauper-red-madness.dck pauper-elves.dck &
wait
run glm-math-elves-vs-bogles-x12-seed101 glm,forge-ai-1 pauper-elves.dck pauper-bogles.dck &
run glm-math-bogles-vs-elves-x12-seed101 glm,forge-ai-1 pauper-bogles.dck pauper-elves.dck &
wait
echo "$(date +%H:%M:%S) matrix done"
