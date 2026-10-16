# mtg-rival — convenciones del repo

Bot que juega Magic (Pauper) con un LLM sobre Forge + mtg-bench. Qué hay y cómo se corre: `README.md`. Contrato para
bots externos: `docs/API-BOT.md`. Las notas de trabajo, resultados y pendientes **no van en este repo** (es público):
viven en `CLAUDE.local.md` (no versionado) y en el wiki privado del proyecto.

## Reglas duras

- **Nada privado en el repo**: keys, endpoints, cuentas, nombres de personas, runs. Las keys sólo por `apiKeyEnv`;
  el endpoint del proxy por `${MTG_LLM_BASE_URL}` (los wrappers `bin/bench.sh` y `bin/mesa.sh` lo exportan desde el
  entorno). `data/mesa/` (cuentas y mazos de la gente), `runs/`, `forge/` y `node_modules/` están ignorados.
- Cada `config/*.yaml` tiene **exactamente 8 seats** (el harness lo valida). `event.name` nunca puede ser una palabra
  que aparezca en un prompt (el guard anti-leak aborta el match); por eso `pilotmesaweb`, `pilotmesabot`.
- El bridge Java se compila a un **jar nuevo** cuando hay partidas en curso (`engine.bridgeJar`); pisar el jar en uso
  rompe los JVMs vivos.
- `vendor/mtg-bench` es un submódulo (rama `pilot` del fork). Cambios al harness: commit ahí primero, push a la rama
  `pilot`, después bump del puntero en este repo. `patches/mtg-bench-pilot.patch` es el diff de referencia contra
  upstream (regenerar con `git add -N . && git diff 0870cb6` dentro del submódulo (0870cb6 = el commit base de upstream)).
- Commit y push sólo cuando el dueño del repo lo pide.

## Cómo se mide

- Misma semilla (`--seed N`) = mismas barajadas en el match k de cualquier run: comparar pareado, nunca por totales de
  runs con semillas distintas. Ruido medido entre configuraciones idénticas: ±1 partida en 12.
- `--alternate` balancea salir/robar (match impar sale el seat 0, par el seat 1); sin eso, con las semillas fijas el
  seat 0 gana el sorteo 9 de 12 veces.
- `bin/paired-cmp.mjs <runA> <runB>` compara dos runs partida por partida (salir/robar, resultado, mulligans con el
  veredicto de la sección, counters).

## Pendientes

Ver `CLAUDE.local.md` (no versionado).
