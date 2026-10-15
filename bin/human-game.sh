#!/usr/bin/env bash
# Una persona juega desde el navegador contra el piloto (seat glm por default) o contra la IA de stock (forge-ai-1).
# Uso: bin/human-game.sh <mazo-humano.dck> <mazo-rival.dck> [run-id] [seat-rival=glm] [--seed N]
#   ej: bin/human-game.sh decks/pauper-elves.dck decks/pauper-red-madness.dck visita-1
# Imprime el link (http://localhost:8787/?t=<token>); para alguien remoto, exponer el puerto con un túnel (cloudflared/ngrok).
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
me="$1"; rival="$2"; id="${3:-human-$(date +%Y%m%d-%H%M%S)}"; seat="${4:-glm}"; shift 2; [[ $# -gt 0 ]] && shift; [[ $# -gt 0 ]] && shift
abs() { [[ "$1" = /* ]] && echo "$1" || echo "$root/$1"; }
exec "$root/bin/bench.sh" match config/human.yaml --seats "$seat,human" --decks "$(abs "$rival"),$(abs "$me")" --matches 1 --parallel 1 --run-id "$id" "$@"
