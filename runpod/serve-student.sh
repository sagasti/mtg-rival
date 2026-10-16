#!/usr/bin/env bash
# Sirve el modelo student con vLLM (OpenAI-compatible, tool calling hermes para Qwen3) en el puerto 8000, en tmux.
# Uso: bash serve-student.sh [modelo=Qwen/Qwen3-14B] [--lora /workspace/loras/student-v1]
set -euo pipefail
MODEL="${1:-Qwen/Qwen3-14B}"; shift || true
LORA=""; [[ "${1:-}" == "--lora" ]] && LORA="$2"
args=(serve "$MODEL" --port 8000 --max-model-len 16384 --gpu-memory-utilization 0.85 --enable-auto-tool-choice --tool-call-parser hermes --served-model-name student)
[[ -n "$LORA" ]] && args+=(--enable-lora --lora-modules "student-lora=$LORA" --max-lora-rank 64)
tmux kill-session -t vllm 2>/dev/null || true
tmux new-session -d -s vllm "vllm ${args[*]} 2>&1 | tee /workspace/vllm.log"
echo "vLLM arrancando en tmux 'vllm' (log /workspace/vllm.log). Para el harness: export STUDENT_BASE_URL=http://127.0.0.1:8000/v1 STUDENT_MODEL=${LORA:+student-lora}${LORA:-student} STUDENT_KEY=x"
until curl -sf http://127.0.0.1:8000/v1/models >/dev/null; do sleep 5; done; echo "vLLM listo"
