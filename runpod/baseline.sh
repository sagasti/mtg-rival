#!/usr/bin/env bash
# Baseline del student en el pod: sirve el modelo con vLLM y juega los cruces pareables contra la IA de stock
# (mismas barajadas que los runs glm-* de la Mac: seed 101, sin --alternate). Uso: bash baseline.sh [tag=student0] [--lora path]
set -euo pipefail
cd /workspace/mtg-rival && mkdir -p runs
TAG="${1:-student0}"; shift || true
export HF_HOME=/workspace/hf STUDENT_BASE_URL=http://127.0.0.1:8000/v1 STUDENT_KEY=x MTG_LLM_BASE_URL="${MTG_LLM_BASE_URL:-http://unused.invalid/v1}" MTG_LLM_KEY="${MTG_LLM_KEY:-unused}"
if [[ "${1:-}" == "--lora" ]]; then export STUDENT_MODEL=student-lora; curl -sf -m 3 http://127.0.0.1:8000/v1/models | grep -q student-lora || bash runpod/serve-student.sh Qwen/Qwen3-14B --lora "$2"
else export STUDENT_MODEL=student; curl -sf -m 3 http://127.0.0.1:8000/v1/models >/dev/null || bash runpod/serve-student.sh Qwen/Qwen3-14B; fi
D=/workspace/mtg-rival/decks
short() { echo "$1" | sed 's/red-madness/red/; s/blue-terror/terror/'; }
run() { local a="$1" b="$2"; local id="$TAG-$(short "$a")-vs-$(short "$b")-x12-seed101"
  bin/bench.sh match config/pilot-student.yaml --seats student,forge-ai-1 --decks "$D/pauper-$a.dck,$D/pauper-$b.dck" --matches 12 --parallel 4 --seed 101 --run-id "$id" > "runs/$id.log" 2>&1 || true
  echo "$(date +%H:%M:%S) done $id: $(grep -c 'match [0-9]*: student (W)' "runs/$id.log")-$(grep -c 'match [0-9]*: .* (L)' "runs/$id.log") · forfeits $(grep -c '"forfeit":true' "runs/$id/decisions.jsonl" 2>/dev/null)"; }
run red-madness bogles
run blue-terror bogles
echo "$(date +%H:%M:%S) baseline done"
