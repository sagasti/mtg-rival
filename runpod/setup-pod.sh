#!/usr/bin/env bash
# Bootstrap de un pod de RunPod (imagen runpod/pytorch) para el piloto: Java 17, Node 22, el repo con submódulos, Forge 2.0.15,
# el bridge compilado, la base de cartas y vLLM. Idempotente: se puede re-correr. Todo bajo /workspace (network volume).
# Uso: bash setup-pod.sh   (vars opcionales: REPO, FORGE_URL, FORGE_TARBALL=/workspace/forge-installer-2.0.15.tar.bz2)
set -euo pipefail
W=/workspace; REPO="${REPO:-https://github.com/sagasti/mtg-rival.git}"
FORGE_TARBALL="${FORGE_TARBALL:-$W/forge-installer-2.0.15.tar.bz2}"
FORGE_URL="${FORGE_URL:-https://releases.cardforge.org/forge/forge-gui-desktop/2.0.15/forge-installer-2.0.15.tar.bz2}"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq && apt-get install -y -qq openjdk-17-jdk-headless bzip2 git curl tmux >/dev/null
if ! command -v node >/dev/null || [[ "$(node -v)" != v22* ]]; then curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null && apt-get install -y -qq nodejs >/dev/null; fi
cd $W
[[ -d mtg-rival ]] || git clone --recurse-submodules "$REPO" mtg-rival
cd mtg-rival && git pull -q --recurse-submodules && git submodule update --init -q
if [[ ! -f forge/forge-gui-desktop-2.0.15-jar-with-dependencies.jar ]]; then
  [[ -f "$FORGE_TARBALL" ]] || curl -fL -o "$FORGE_TARBALL" "$FORGE_URL"
  mkdir -p forge && tar -xjf "$FORGE_TARBALL" -C forge --strip-components=0
  [[ -f forge/forge-gui-desktop-2.0.15-jar-with-dependencies.jar ]] || { d=$(find forge -name 'forge-gui-desktop-2.0.15-jar-with-dependencies.jar' -maxdepth 3 | head -1); [[ -n "$d" ]] && mv "$(dirname "$d")"/* forge/ || { echo "no encuentro el jar de Forge"; exit 1; }; }
fi
mkdir -p forge-user forge-cache
(cd vendor/mtg-bench && npm install --no-audit --no-fund >/dev/null)
npm install --no-audit --no-fund >/dev/null
# bridge
(cd vendor/mtg-bench/bridge && mkdir -p build/classes-v2 && javac --release 17 -cp ../../../forge/forge-gui-desktop-2.0.15-jar-with-dependencies.jar -d build/classes-v2 $(find src -name '*.java') && jar cf build/mtg-bench-bridge-v2.jar -C build/classes-v2 .)
# base de cartas desde los scripts de Forge
[[ -f vendor/mtg-bench/data/cards.json ]] || (cd vendor/mtg-bench && npm run --silent bench -- cards index --forge-res ../../forge/res)
# los yaml traen paths absolutos de la Mac: reescribirlos al pod
sed -i -e "s#/Users/jorge/dev/mtg-rival-pilot#$W/mtg-rival#g" -e "s#^\(\s*java:\) .*#\1 $(command -v java)#" config/*.yaml
# vLLM (en el venv del pod)
python -c "import vllm" 2>/dev/null || pip install -q "vllm>=0.10" >/dev/null
echo "listo: $W/mtg-rival · java $(java -version 2>&1 | head -1) · node $(node -v) · forge $(ls forge/*.jar | wc -l) jars · cards.json $(du -h vendor/mtg-bench/data/cards.json | cut -f1)"
