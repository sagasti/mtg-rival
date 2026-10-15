#!/usr/bin/env bash
# Piloto contra piloto (glm vs glm-b, mismo modelo y prompt): la vara que no satura. Salir/robar balanceado.
# Uso: bin/duel.sh <slugA> <slugB> [matches=12] [seed=101] [run-id]
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"; D="$root/decks"
a="$1"; b="$2"; n="${3:-12}"; seed="${4:-101}"; id="${5:-duel-$a-vs-$b-x$n-seed$seed}"
exec "$root/bin/bench.sh" match config/pilot-math.yaml --seats glm,glm-b --decks "$D/pauper-$a.dck,$D/pauper-$b.dck" --matches "$n" --parallel 2 --seed "$seed" --alternate --run-id "$id"
