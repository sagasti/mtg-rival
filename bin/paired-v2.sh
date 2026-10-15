#!/usr/bin/env bash
# Re-run pareado del piloto v2 sobre las mismas barajadas (seed 101, sin --alternate) para comparar con los runs glm-math-*.
# Uso: [PREFIX=glm-v2b] bin/paired-v2.sh "<deckA:deckB> <deckA:deckB> ..."   (slugs de decks/pauper-<slug>.dck); corre de a dos.
set -uo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"; D="$root/decks"
short() { echo "$1" | sed 's/red-madness/red/; s/blue-terror/terror/; s/grixis-control/grixis/; s/azorius-faeries/faeries/'; }
run() { local a="${1%%:*}" b="${1##*:}" id="${PREFIX:-glm-v2}-$(short "${1%%:*}")-vs-$(short "${1##*:}")-x12-seed101"
  "$root/bin/bench.sh" match config/pilot-math.yaml --seats glm,forge-ai-1 --decks "$D/pauper-$a.dck,$D/pauper-$b.dck" --matches 12 --parallel 2 --seed 101 --run-id "$id" > "$root/runs/$id.log" 2>&1
  echo "$(date +%H:%M:%S) done $id: $(grep -c 'match [0-9]*: glm (W)' "$root/runs/$id.log")-$(grep -c 'match [0-9]*: .* (L)' "$root/runs/$id.log")"; }
pairs=($1); i=0
while (( i < ${#pairs[@]} )); do run "${pairs[$i]}" & [[ -n "${pairs[$((i+1))]:-}" ]] && run "${pairs[$((i+1))]}" & wait; i=$((i+2)); done
echo "$(date +%H:%M:%S) paired done"
