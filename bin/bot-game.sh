#!/usr/bin/env bash
# Un bot externo juega por la API HTTP (docs/API-BOT.md) contra el piloto (seat glm por default) o contra la IA de stock (forge-ai-1).
# Uso: bin/bot-game.sh <mazo-del-bot.dck> <mazo-rival.dck> [run-id] [seat-rival=glm] [--seed N]
# Imprime el link con el token (http://localhost:8790/?t=<token>); el bot usa /events, /answer y /pending con ese token.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
me="$1"; rival="$2"; id="${3:-bot-$(date +%Y%m%d-%H%M%S)}"; seat="${4:-glm}"; shift 2; [[ $# -gt 0 ]] && shift; [[ $# -gt 0 ]] && shift
abs() { [[ "$1" = /* ]] && echo "$1" || echo "$root/$1"; }
exec "$root/bin/bench.sh" match "${BOT_CFG:-config/bot.yaml}" --seats "$seat,bot" --decks "$(abs "$rival"),$(abs "$me")" --matches 1 --parallel 1 --run-id "$id" "$@"
