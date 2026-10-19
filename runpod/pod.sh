#!/usr/bin/env bash
# Helper del pod del student. Usa RUNPOD_API_KEY (~/.claude/secrets/runpod.env) y el pod POD (default: el de CLAUDE.local.md).
# Uso: runpod/pod.sh status | ssh [cmd...] | put <local> <remoto> | get <remoto> <local> | url | stop | start
set -euo pipefail
[[ -f "$HOME/.claude/secrets/runpod.env" ]] && { set -a; source "$HOME/.claude/secrets/runpod.env"; set +a; }
POD="${POD:-1af6e6po3n9qyq}"
gql() { curl -s "https://api.runpod.io/graphql?api_key=$RUNPOD_API_KEY" -H 'content-type: application/json' -d "{\"query\":\"$1\"}"; }
ports() { gql "query { pod(input:{podId:\\\"$POD\\\"}) { desiredStatus runtime { uptimeInSeconds ports { ip isIpPublic privatePort publicPort type } } } }"; }
sshaddr() { ports | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s).data.pod.runtime; const p=r&&r.ports&&r.ports.find(p=>p.privatePort===22&&p.isIpPublic); if(!p){console.error("el pod no expone SSH todavía (runtime vacío)");process.exit(1)} console.log(p.ip+" "+p.publicPort)})'; }
case "${1:-status}" in
  status) ports; echo ;;
  url) echo "https://$POD-8000.proxy.runpod.net/v1" ;;
  ssh) read -r ip port < <(sshaddr); shift; exec ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -p "$port" "root@$ip" "$@" ;;
  put) read -r ip port < <(sshaddr); exec scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -P "$port" "$2" "root@$ip:$3" ;;
  get) read -r ip port < <(sshaddr); exec scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -P "$port" "root@$ip:$2" "$3" ;;
  stop) runpodctl stop pod "$POD" ;;
  start) runpodctl start pod "$POD" ;;
  *) echo "uso: $0 status|url|ssh [cmd]|put <local> <remoto>|get <remoto> <local>|stop|start" >&2; exit 2 ;;
esac
