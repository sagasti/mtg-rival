#!/usr/bin/env bash
# Una ronda de self-play del student (expert iteration): juega N partidas con cada mazo contra cada mazo de la IA de
# stock, exporta las decisiones de las partidas ganadas, sigue entrenando el adapter con ese dato y lo evalúa con la
# vara pareada (baseline.sh). Uso (en el pod, con nohup):
#   bash runpod/selfplay.sh <ronda> <lora-de-entrada> [fase=all]      fases: play | export | train | eval | all
#   GAMES=8 PAR=6 (partidas por cruce, cruces en paralelo) · DECKS=lista (6 mazos) · LR=5e-5 · LIMIT=0 (tope de ejemplos)
# Salidas: runs/sp<R>-play-*, data/sft/sp<R>.jsonl, /workspace/loras/student-sp<R>, runs/sp<R>-{red,terror}-vs-bogles-*.
set -euo pipefail
cd /workspace/mtg-rival && mkdir -p runs data/sft
R="${1:?ronda}"; IN="${2:?lora de entrada}"; PHASE="${3:-all}"
GAMES="${GAMES:-8}"; PAR="${PAR:-6}"; LR="${LR:-5e-5}"; LIMIT="${LIMIT:-0}"
DECKS="${DECKS:-bogles,red-madness,blue-terror,elves,grixis-control,azorius-faeries}"
OUT=/workspace/loras/student-sp$R; DATA=data/sft/sp$R.jsonl; D=/workspace/mtg-rival/decks
export HF_HOME=/workspace/hf STUDENT_BASE_URL=http://127.0.0.1:8000/v1 STUDENT_KEY=x STUDENT_MODEL=student-lora MTG_LLM_BASE_URL="${MTG_LLM_BASE_URL:-http://unused.invalid/v1}" MTG_LLM_KEY="${MTG_LLM_KEY:-unused}"
short() { echo "$1" | sed 's/red-madness/red/; s/blue-terror/terror/; s/grixis-control/grixis/; s/azorius-faeries/faeries/'; }
wl() { node -e 'const fs=require("fs");let w=0,l=0;for(const line of fs.readFileSync(process.argv[1],"utf8").split("\n").filter(Boolean)){const g=JSON.parse(line).games[0];if(!g)continue;g.winner===0?w++:l++}console.log(w+"-"+l)' "runs/$1/matches.jsonl" 2>/dev/null || echo "?"; }
serve() { { curl -sf -m 3 http://127.0.0.1:8000/v1/models | grep -q student-lora && [[ "$(cat /workspace/vllm.lora 2>/dev/null)" == "$1" ]]; } || bash runpod/serve-student.sh Qwen/Qwen3-14B --lora "$1"; }
has() { [[ "$PHASE" == all || "$PHASE" == "$1" ]]; }

if has play; then
  serve "$IN"
  mkdir -p ~/.forge/{custom/editions,decks/{commander,constructed,draft,net,network-events,oathbreaker,planar,scheme,sealed},gauntlet,preferences,quest/saves} ~/.cache/forge/{db,pics}
  IFS=, read -ra decks <<< "$DECKS"; i=0
  for a in "${decks[@]}"; do for b in "${decks[@]}"; do
    i=$((i+1)); seed=$((1000*R+i)); id="sp$R-play-$(short "$a")-vs-$(short "$b")-x$GAMES-seed$seed"
    [[ -f "runs/$id/matches.jsonl" ]] && { echo "$(date +%H:%M:%S) skip $id (ya está): $(wl "$id")"; continue; }
    bin/bench.sh match config/pilot-student.yaml --seats student,forge-ai-1 --decks "$D/pauper-$a.dck,$D/pauper-$b.dck" --matches "$GAMES" --parallel "$PAR" --seed "$seed" --alternate --run-id "$id" > "runs/$id.log" 2>&1 || true
    echo "$(date +%H:%M:%S) done $id: $(wl "$id") · forfeits $(grep -c '"forfeit":true' "runs/$id/decisions.jsonl" 2>/dev/null || echo 0)"
  done; done
  echo "$(date +%H:%M:%S) play done ($i cruces)"
fi
if has export; then
  node bin/export-sft.mjs "$DATA" --runs "sp$R-play-"
  echo "$(date +%H:%M:%S) export done: $(wc -l < "$DATA") decisiones, $(grep -c '"won":true' "$DATA") de partidas ganadas → $DATA"
fi
if has train; then
  tmux kill-session -t vllm 2>/dev/null || true; sleep 5   # la GPU entera para entrenar
  PYTHONUNBUFFERED=1 /workspace/venv-train/bin/python -u runpod/train-sft.py --data "$DATA" --meta /workspace/sft/meta.json --model Qwen/Qwen3-14B \
    --out "$OUT" --won-only --init-lora "$IN" --lr "$LR" --max-seq 10240 ${LIMIT:+--limit $LIMIT} 2>&1 | tee "/workspace/train-sp$R.log" | grep -v -E "it/s\]|s/it\]" || true
  [[ -f "$OUT/adapter_model.safetensors" ]] || { echo "$(date +%H:%M:%S) train FALLÓ (ver /workspace/train-sp$R.log)"; exit 1; }
  echo "$(date +%H:%M:%S) train done → $OUT"
fi
if has eval; then
  tmux kill-session -t vllm 2>/dev/null || true
  bash runpod/baseline.sh "sp$R" --lora "$OUT"
  for x in red terror; do echo "eval sp$R $x vs bogles: $(wl "sp$R-$x-vs-bogles-x12-seed101")"; done
  echo "$(date +%H:%M:%S) selfplay round $R done"
fi
