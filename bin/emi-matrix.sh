#!/usr/bin/env bash
# Nuestros mazos contra los de Emi, piloto contra piloto (glm vs glm-b, salir/robar balanceado, seed 101), de a dos.
# Uso: bin/emi-matrix.sh ["red-madness elves blue-terror bogles"] ["grixis-control azorius-faeries"]   log: runs/emi-matrix.log
set -uo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
ours=(${1:-red-madness elves blue-terror bogles}); theirs=(${2:-grixis-control azorius-faeries})
run() { local id="duel-$1-vs-$2-x12-seed101"
  "$root/bin/duel.sh" "$1" "$2" 12 101 "$id" > "$root/runs/$id.log" 2>&1
  echo "$(date +%H:%M:%S) done $id: $(grep -c 'match [0-9]*: glm (W)' "$root/runs/$id.log")-$(grep -c 'match [0-9]*: .* (L)' "$root/runs/$id.log")"; }
jobs=(); for a in "${ours[@]}"; do for b in "${theirs[@]}"; do jobs+=("$a $b"); done; done
i=0; while (( i < ${#jobs[@]} )); do run ${jobs[$i]} & [[ -n "${jobs[$((i+1))]:-}" ]] && run ${jobs[$((i+1))]} & wait; i=$((i+2)); done
echo "$(date +%H:%M:%S) emi-matrix done"
