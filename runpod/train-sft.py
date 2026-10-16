#!/usr/bin/env python3
"""SFT con LoRA del modelo student sobre las decisiones grabadas del piloto (bin/export-sft.mjs + sft-meta).

Formato: el mismo chat que manda el harness (system del juego + prompt renderizado + tool submit_decision) y como
respuesta la llamada a la tool con los ids elegidos. La pérdida se calcula sólo sobre la respuesta (prompt-completion).

Uso (en el pod):
  python3 train-sft.py --data /workspace/sft/decisions.jsonl --meta /workspace/sft/meta.json \
      --model Qwen/Qwen3-14B --out /workspace/loras/student-v1 [--won-only] [--max-seq 12288] [--epochs 1]
Después: bash serve-student.sh Qwen/Qwen3-14B --lora /workspace/loras/student-v1
"""
import argparse, json, random
from datasets import Dataset
from peft import LoraConfig
from transformers import AutoTokenizer
from trl import SFTConfig, SFTTrainer

ap = argparse.ArgumentParser()
ap.add_argument("--data", required=True); ap.add_argument("--meta", required=True); ap.add_argument("--out", required=True)
ap.add_argument("--model", default="Qwen/Qwen3-14B"); ap.add_argument("--won-only", action="store_true")
ap.add_argument("--max-seq", type=int, default=12288); ap.add_argument("--epochs", type=float, default=1.0)
ap.add_argument("--lr", type=float, default=1e-4); ap.add_argument("--rank", type=int, default=32)
ap.add_argument("--limit", type=int, default=0); ap.add_argument("--seed", type=int, default=7)
a = ap.parse_args()

meta = json.load(open(a.meta))
tok = AutoTokenizer.from_pretrained(a.model)
tools = [{"type": "function", "function": {"name": t["name"], "description": t["description"], "parameters": t["parameters"]}} for t in meta["tools"]]

rows = []
for line in open(a.data):
    d = json.loads(line)
    if a.won_only and not d["won"]:
        continue
    msgs = [{"role": "system", "content": meta["system"]}, {"role": "user", "content": d["prompt"]}]
    # Prompt renderizado con el chat template (incluye las tools como las ve el modelo en vLLM); la respuesta es la tool call.
    prompt = tok.apply_chat_template(msgs, tools=tools, tokenize=False, add_generation_prompt=True, enable_thinking=False)
    call = {"name": "submit_decision", "arguments": {"choice": d["choice"]}}
    completion = "<tool_call>\n" + json.dumps(call, ensure_ascii=False) + "\n</tool_call>" + tok.eos_token
    rows.append({"prompt": prompt, "completion": completion, "kind": d["kind"], "won": d["won"]})
random.Random(a.seed).shuffle(rows)
if a.limit:
    rows = rows[: a.limit]
print(f"ejemplos: {len(rows)} (won-only={a.won_only})")
ds = Dataset.from_list(rows).remove_columns(["kind", "won"])

import inspect
kw = dict(
    output_dir=a.out, num_train_epochs=a.epochs, learning_rate=a.lr, lr_scheduler_type="cosine", warmup_ratio=0.03,
    per_device_train_batch_size=1, gradient_accumulation_steps=16, gradient_checkpointing=True, bf16=True,
    max_length=a.max_seq, completion_only_loss=True, packing=False, logging_steps=10, save_strategy="epoch", report_to=[],
    dataset_num_proc=4, seed=a.seed,
)
# Las versiones de TRL/transformers renombran argumentos: adaptar a lo que acepte la instalada.
accepted = set(inspect.signature(SFTConfig.__init__).parameters)
if "warmup_ratio" not in accepted:
    kw.pop("warmup_ratio"); kw["warmup_steps"] = 20
if "max_length" not in accepted and "max_seq_length" in accepted:
    kw["max_seq_length"] = kw.pop("max_length")
dropped = [k for k in kw if k not in accepted]
kw = {k: v for k, v in kw.items() if k in accepted}
print("SFTConfig: ignorados", dropped)
cfg = SFTConfig(**kw)
peft = LoraConfig(r=a.rank, lora_alpha=2 * a.rank, lora_dropout=0.05, target_modules="all-linear", task_type="CAUSAL_LM")
trainer = SFTTrainer(model=a.model, args=cfg, train_dataset=ds, processing_class=tok, peft_config=peft)
trainer.train()
trainer.save_model(a.out)
print("LoRA guardada en", a.out)
