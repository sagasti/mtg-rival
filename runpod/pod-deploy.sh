#!/usr/bin/env bash
# Levanta un pod nuevo sobre el network volume del student (cuando el pod parado no arranca: "not enough free GPUs on the host").
# Uso: runpod/pod-deploy.sh [nombre=mtg-rival-student]   · vars: VOLUME=yk8ddqvg9q DC=EU-RO-1 GPU="NVIDIA A100 80GB PCIe"
#   IMAGE=runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04 DISK=60 PUBKEY=~/.ssh/id_rsa.pub
# Imprime el id del pod nuevo. Después: POD=<id> runpod/pod.sh ssh 'bash /workspace/mtg-rival/runpod/setup-pod.sh' (el disco del
# contenedor arranca vacío: java, node, tmux y vLLM se reinstalan; /workspace persiste).
set -euo pipefail
[[ -f "$HOME/.claude/secrets/runpod.env" ]] && { set -a; source "$HOME/.claude/secrets/runpod.env"; set +a; }
NAME="${1:-mtg-rival-student}"; VOLUME="${VOLUME:-yk8ddqvg9q}"; DC="${DC:-EU-RO-1}"; GPU="${GPU:-NVIDIA A100 80GB PCIe}"
IMAGE="${IMAGE:-runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04}"; DISK="${DISK:-60}"; PUBKEY="${PUBKEY:-$HOME/.ssh/id_rsa.pub}"
export NAME VOLUME DC GPU IMAGE DISK PUBKEY
python3 - <<'PY'
import json, os, urllib.request
key = open(os.path.expanduser(os.environ["PUBKEY"])).read().strip()
inp = {"cloudType": "SECURE", "gpuCount": 1, "volumeInGb": 0, "containerDiskInGb": int(os.environ["DISK"]), "gpuTypeId": os.environ["GPU"],
       "name": os.environ["NAME"], "imageName": os.environ["IMAGE"], "dockerArgs": "", "ports": "8000/http,22/tcp", "volumeMountPath": "/workspace",
       "networkVolumeId": os.environ["VOLUME"], "dataCenterId": os.environ["DC"], "env": [{"key": "PUBLIC_KEY", "value": key}]}
q = {"query": "mutation Deploy($input: PodFindAndDeployOnDemandInput) { podFindAndDeployOnDemand(input: $input) { id name costPerHr machine { gpuDisplayName } } }", "variables": {"input": inp}}
req = urllib.request.Request("https://api.runpod.io/graphql?api_key=" + os.environ["RUNPOD_API_KEY"], data=json.dumps(q).encode(), headers={"content-type": "application/json"})
r = json.load(urllib.request.urlopen(req))
if "errors" in r or not r.get("data", {}).get("podFindAndDeployOnDemand"):
    raise SystemExit("deploy falló: " + json.dumps(r.get("errors") or r)[:600])
p = r["data"]["podFindAndDeployOnDemand"]; print(f"pod {p['id']} ({p['name']}, {p['machine']['gpuDisplayName']}, US${p['costPerHr']}/h)")
PY
