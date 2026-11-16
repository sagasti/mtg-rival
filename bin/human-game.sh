#!/usr/bin/env bash
# Una persona juega desde el navegador contra el piloto (seat glm por default) o contra la IA de stock (forge-ai-1).
# Uso: bin/human-game.sh <mazo-humano.dck> <mazo-rival.dck> [run-id] [seat-rival=glm] [--seed N]
#   ej: bin/human-game.sh decks/pauper-elves.dck decks/pauper-red-madness.dck visita-1
# Imprime el link (http://localhost:8787/?t=<token>); para alguien remoto, exponer el puerto con un túnel (cloudflared/ngrok).
# MTG_HUMAN_PEEK=1: modo análisis, la mesa le muestra a la persona la mano del rival (no vale contra forge-ai-*, que decide dentro de Forge).
# MTG_HUMAN_CONFIG=config/otra.yaml: otra config en vez de config/human.yaml (otro webPort: una segunda mesa, o QA sin pisar la que está en uso).
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
me="$1"; rival="$2"; id="${3:-human-$(date +%Y%m%d-%H%M%S)}"; seat="${4:-glm}"; shift 2; [[ $# -gt 0 ]] && shift; [[ $# -gt 0 ]] && shift
abs() { [[ "$1" = /* ]] && echo "$1" || echo "$root/$1"; }
# Sin --seed, cada partida baraja distinto: el yaml trae una semilla fija y con --matches 1 toda partida sería la misma barajada.
[[ " $* " == *" --seed "* ]] || set -- "$@" --seed "$(( (RANDOM << 15 | RANDOM) + 1 ))"
exec "$root/bin/bench.sh" match "${MTG_HUMAN_CONFIG:-config/human.yaml}" --seats "$seat,human" --decks "$(abs "$rival"),$(abs "$me")" --matches 1 --parallel 1 --run-id "$id" "$@"
