# mtg-rival

Un bot que juega Magic: The Gathering (Pauper) como un experto, con un LLM pilotando partidas reales sobre el motor
[Forge](https://github.com/Card-Forge/forge) a través del harness [mtg-bench](https://github.com/zachmay/mtg-bench).
Incluye la vara de medición (matrices contra la IA de stock y piloto contra piloto), una mesa web para que una persona
juegue contra el bot, y una API HTTP + servidor MCP para que otros bots o agentes jueguen contra él.

## Qué hay

| Carpeta | Qué es |
|---|---|
| `vendor/mtg-bench/` | submódulo: fork de mtg-bench, rama `pilot` (harness TypeScript + bridge Java que corre dentro de Forge). Nuestro parche: fallback por timeout, secciones calculadas en el prompt (daño/letal, keep-or-mulligan, plan de cruce), asiento humano/bot web, salir/robar forzado. `patches/mtg-bench-pilot.patch` es el mismo diff contra upstream. |
| `config/*.yaml` | eventos del harness: `pilot-math.yaml` (piloto base: GLM 5.3 low + secciones), `human.yaml` (mesa web), `bot.yaml` (bot externo con timeout). Exactamente 8 seats por config. ⚠️ Llevan paths absolutos de esta Mac (`forgeDir`, `bridgeJar`, `java`, `plansFile`): ajustarlos al clonar. |
| `decks/*.dck` | mazos Pauper del meta (Goldfish): Red Madness, Bogles, Elves, Blue Terror, Grixis Control, Azorius Faeries. |
| `knowledge/plans.yaml` | arquetipos con cartas firma y un plan por cruce (`ours|theirs`) que el harness pega en el prompt. |
| `bin/` | `bench.sh` (wrapper del harness, `--seed`, `--alternate`), `matrix.sh`, `duel.sh` (piloto vs piloto), `stock-bar.sh`, `paired-v2.sh`, `paired-cmp.mjs` (comparar dos runs partida por partida), `mesa.sh`/`mesa.mjs` (lobby web con cuentas, mazos guardados, mesa, API y MCP), `mesa-admin.mjs`, `human-game.sh`, `bot-game.sh`. |
| `docs/API-BOT.md` | contrato para un bot externo (SSE + POST, o tools MCP), con un ejemplo real por tipo de decisión. |
| `examples/bot-client.py` | cliente de ejemplo sin dependencias. |
| `CLAUDE.md` | notas de trabajo, decisiones y pendientes (fuente de verdad operativa). |

Historia, resultados y decisiones con sus trade-offs viven en el wiki privado del proyecto.

- **Capa experta del piloto** (`event.*` en los configs): `damageMath` (daño y letal), `mulliganMath` + `mulliganPolicy`
  (keep/mull con veredicto vinculante en los casos claros), `plansFile` (planes por cruce y la lista conocida de cada
  arquetipo), `combatMath` (cada bloqueo legal y su resultado, la carrera), `openMana` (maná abierto del rival y las
  respuestas que le quedan), `auraPolicy` y `combatPolicy` (auras sólo sobre hexproof; nada con auras ataca contra
  deathtouch destapado salvo letal). Herramientas de replay y perfil de errores en `vendor/mtg-bench/src/knowledge/`
  (`expert-replay.ts`, `mistakes.ts`, `policy-replay.ts`).

## Setup

1. **Forge 2.0.15** (sin parches) descomprimido en `forge/` (ignorado por git). Perfil aislado en `forge-user/` y `forge-cache/`.
2. **JDK 17+** para el bridge (acá: OpenJDK 19 arm64, compilando con `--release 17`). Compilar el bridge a un jar nuevo:
   ```
   cd vendor/mtg-bench/bridge
   javac --release 17 -cp <jar de Forge> -d build/classes $(find src -name '*.java')
   jar cf build/mtg-bench-bridge-v2.jar -C build/classes .
   ```
   y apuntar `engine.bridgeJar` de los yaml a ese jar. (Regla: nunca pisar un jar que esté en uso por una partida en curso.)
3. **Node 22**: `npm install` en `vendor/mtg-bench/` (harness) y en la raíz (SDK de MCP para el lobby).
4. **Key del LLM**: `bin/bench.sh` y `bin/mesa.sh` exportan `MTG_LLM_KEY` desde `~/.claude/secrets/op-llm-proxy.env` si existe; si no, exportarla a mano. Las keys nunca van en el repo ni en los yaml (sólo `apiKeyEnv`).
5. Submódulo: `git clone --recurse-submodules` o `git submodule update --init`.

## Correr

```
bin/bench.sh check config/pilot-math.yaml
bin/bench.sh match config/pilot-math.yaml --seats glm,forge-ai-1 \
  --decks $PWD/decks/pauper-red-madness.dck,$PWD/decks/pauper-bogles.dck \
  --matches 12 --parallel 2 --seed 101 --alternate --run-id <id>
bin/duel.sh red-madness grixis-control 12 101        # piloto contra piloto
MESA_INVITE=<código> bin/mesa.sh --tunnel            # lobby web (+ cloudflared) para que una persona o un bot juegue
```

Los runs quedan en `runs/<run-id>/` (reporte, decisiones, prompts renderizados, logs de cada partida).

## Licencia

mtg-bench es GPL-3.0; nuestro fork mantiene la licencia. El resto del repo es privado.
