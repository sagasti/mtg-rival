# API para que un bot externo juegue contra el piloto de mtg-rival

La mesa web del lobby es una API HTTP: el mismo asiento que usa una persona desde el navegador lo puede usar un
programa. Tu bot ve **exactamente la misma vista filtrada** del juego que nuestro piloto (tu mano, las mesas, los
cementerios, la pila, el registro reciente; del rival sólo la cantidad de cartas en mano) y contesta cada decisión
con los ids de las opciones que elige. Todo queda grabado (decisiones de los dos lados, reporte de la partida).

## Flujo

1. Entrás al lobby con el link que te pasamos y creás tu cuenta (código de invitación). Guardás tu lista
   (Pauper, nombres de cartas en inglés tal como los usa Forge).
2. En "Jugar" elegís tu mazo, contra qué juega el rival y **"quién juega: tu bot por la API"**. El lobby te
   muestra la URL con tu token: `https://<host>/?t=<token>`.
3. Tu programa se conecta a `GET /events?t=<token>` (Server-Sent Events) y contesta cada `decision` con
   `POST /answer?t=<token>`. Cliente de ejemplo sin dependencias: `examples/bot-client.py "<url>"`.
4. Una partida por vez en la mesa. Bo1. El link vale para esa partida.

## Si tu bot es un agente (MCP)

El lobby también expone un **servidor MCP** (Model Context Protocol, transporte Streamable HTTP) en
`https://<host>/mcp`, con las mismas acciones como tools, para que un agente (Claude, un agente propio con cliente
MCP) juegue sin programar el transporte. Configuralo como servidor MCP remoto con esa URL; opcionalmente con el header
`Authorization: Bearer <token de sesión del lobby>` para saltear el login.

Tools: `register` (con el código de invitación) o `login`; `whoami`; `list_rivals`; `validate_deck`,
`save_deck`, `list_decks`, `get_deck`, `delete_deck`; `start_game` (deck, rival_deck, opponent); luego el
loop `wait_for_decision` (bloquea hasta 55 s y devuelve la decisión completa, `{gameOver, result}` al terminar o
`{waiting: true}`) → `answer` (rid, choice); `game_status`; `abandon_game`. Resource `mtg-rival://docs/api-bot`
con este documento. Desde Claude Code, por ejemplo: `claude mcp add --transport http mtg-rival https://<host>/mcp`
(después `register` con el código de invitación, `save_deck`, `start_game`, y el loop). Es la misma API de abajo: la decisión que devuelve `wait_for_decision` es el evento `decision`
tal cual, y `answer` es el `POST /answer`.

## Transporte

- `GET /events?t=<token>` — stream SSE. Eventos: `hello` {seatId, label}; `game` {event: "start"|"end", …};
  `decision` (abajo); `waiting` {answered: rid, timedOut?} cuando una decisión se cerró; `over` al terminar el match.
  Al (re)conectar el server reenvía la historia de `game` y la decisión pendiente si la hay.
- `POST /answer?t=<token>` con JSON `{"rid": "<rid>", "choice": ["<id>", …]}`. Respuesta `{"ok": true}` o
  `400 {"error": "…"}` (decisión ya cerrada, cantidad fuera de min/max, id inexistente). Se valida del lado del server.
- `GET /pending?t=<token>` — la decisión abierta (mismo JSON que el evento) o `null`. Útil si perdés un evento.
- **Timeout**: tenés `timeoutMs` por decisión (90 s por default; el campo `deadline` es epoch ms). Sin respuesta,
  el harness aplica la acción nula (pasar / no atacar / no bloquear / la primera opción válida), lo registra como
  `forfeit` y la partida sigue. Un bot colgado pierde solo, no cuelga la mesa.

## El evento `decision`

```json
{ "rid": "h2h-1-glm-vs-bot-g1-17", "kind": "priority", "prompt": "Priority: P2 Turn: 3 (P2) Phase: Main phase, precombat Stack: Empty",
  "state": { … }, "options": [{ "id": "c42", "label": "cast spell: your Lava Dart [Hand]", "card": "Lava Dart" }, { "id": "ok", "label": "Button: OK", "type": "pass" }],
  "min": 1, "max": 1, "cards": { "Lava Dart": { "manaCost": "{R}", "types": "Instant", "oracle": "Lava Dart deals 1 damage to any target.\nFlashback—Sacrifice a Mountain." } },
  "matchId": "h2h-1-glm-vs-bot", "game": 1, "timeoutMs": 90000, "deadline": 1760562000000 }
```

- `options[].id` es lo que mandás en `choice`. `label` es texto para humanos (no lo parsees si podés evitarlo);
  `card` es el nombre de la carta de la opción cuando aplica; `type: "pass"` marca la acción nula.
- `min`/`max`: cuántos ids tenés que mandar. Con `min: 0` podés mandar `[]` (no atacar, no bloquear).
- `cards`: texto oracle de cada carta que aparece en el estado o en las opciones (para que no necesites una base de cartas).
- `state`: `turn`, `phase` (UPKEEP, DRAW, MAIN1, COMBAT_BEGIN, COMBAT_DECLARE_ATTACKERS, COMBAT_DECLARE_BLOCKERS,
  COMBAT_DAMAGE, MAIN2, END_OF_TURN, CLEANUP), `activePlayer` ("you"|"opponent"), `youAre` (P1|P2), `you` {life,
  librarySize, hand[], battlefield[], graveyard[], exile[], landsPlayedThisTurn}, `opponent` {life, librarySize,
  handSize, battlefield[], graveyard[], exile[]}, `stack[]` {controller, source, description} (lo último arriba al
  final), `combat[]` (atacantes declarados: id, attacking), `recentLog[]` (líneas del registro de Forge).
  Las cartas en mesa traen `id`, `name`, `pt`, `tapped`, `summoningSick`, `text` (y auras/contadores adjuntos en el texto).

## Un ejemplo real por tipo de decisión

Sacados de partidas grabadas del piloto (el `state` se muestra completo sólo en los tipos que más importan).

### `play_draw`

Ganaste el sorteo: salir o robar.

Prompt: `P1, you have won the coin toss. Would you like to play or draw?`  
Opciones (elegir 1):

```json
[{"id":"play","label":"Button: Play"},
 {"id":"draw","label":"Button: Draw"}]
```

Estado (resumen): turno 0, fase null, juega undefined, vida 20 vs 20, mano 

### `mulligan`

Quedarse con la mano (ok) o mulligan (cancel). Orden de Forge: mulligan → london_bottom (elegís qué va al fondo de la nueva mano de 7) → mulligan otra vez sobre la mano resultante.

Prompt: `P2 is going first. P1, you are going 2nd.`  
Opciones (elegir 1):

```json
[{"id":"ok","label":"Button: Keep"},
 {"id":"cancel","label":"Button: Mulligan"}]
```

Estado (resumen): turno 0, fase null, juega undefined, vida 20 vs 20, mano Island, Island, Dispel, Thought Scour, Island, Mental Note

### `london_bottom`

Después de un mulligan: elegí N cartas de la mano nueva para poner al fondo.

Prompt: `Return 1 card(s) to the bottom of your library Choose 1 at once.`  
Opciones (elegir 1):

```json
[{"id":"c29","label":"select card: your Island [Hand]"},
 {"id":"c30","label":"select card: your Island [Hand]"},
 {"id":"c54","label":"select card: your Dispel [Hand]"},
 {"id":"c38","label":"select card: your Deem Inferior [Hand]"},
 {"id":"c5","label":"select card: your Thought Scour [Hand]"},
 {"id":"c32","label":"select card: your Island [Hand]"},
 {"id":"c42","label":"select card: your Mental Note [Hand]"}]
```

Estado (resumen): turno 0, fase null, juega undefined, vida 20 vs 20, mano Island, Island, Dispel, Deem Inferior, Thought Scour, Island, Mental Note

### `priority`

Tenés prioridad: jugar tierra, lanzar un hechizo/activar (una opción por carta jugable y pagable), o pasar (`ok`, type pass). Si hay algo en la pila, pasar = dejar que resuelva.

Prompt: `Priority: P1 Turn: 1 (P1)`  
Opciones (elegir 1):

```json
[{"id":"c35","label":"play land: your Island [Hand]"},
 {"id":"c22","label":"play land: your Island [Hand]"},
 {"id":"ok","label":"Button: OK"}]
```

Estado (`state`):

```yaml
game: 1
match:
  gamesYouWon: 0
  gamesOpponentWon: 0
turn: 1
phase: MAIN1
activePlayer: you
youAre: P1
you:
  life: 20
  librarySize: 53
  hand:
    - id: c35
      name: Island
    - id: c38
      name: Deem Inferior
    - id: c46
      name: Spell Pierce
    - id: c52
      name: Ponder
    - id: c22
      name: Island
    - id: c6
      name: Thought Scour
    - id: c48
      name: Lórien Revealed
  landsPlayedThisTurn: 0
  battlefield: []
  graveyard: []
opponent:
  life: 20
  librarySize: 53
  handSize: 7
  battlefield: []
  graveyard: []
recentLog:
  - P1 has kept a hand of 7 cards
  - P2 has kept a hand of 7 cards
  - Turn 1 (P1)
```

### `targets`

Objetivos del hechizo o habilidad que estás lanzando (cartas en mesa o jugadores).

Prompt: `You are casting Thought Scour; choose its targets. Thought Scour (7) - Target player mills two cards. Draw a card. `  
Opciones (elegir 1):

```json
[{"id":"player:0","label":"Select player: you"},
 {"id":"player:1","label":"Select player: opponent"}]
```

Estado (`state`):

```yaml
game: 1
match:
  gamesYouWon: 0
  gamesOpponentWon: 0
turn: 1
phase: MAIN1
activePlayer: you
youAre: P1
you:
  life: 20
  librarySize: 53
  hand:
    - id: c56
      name: Sleep of the Dead
    - id: c59
      name: Counterspell
    - id: c19
      name: Cryptic Serpent
      pt: 6/5
    - id: c5
      name: Thought Scour
    - id: c25
      name: Island
  landsPlayedThisTurn: 1
  battlefield:
    - id: c22
      name: Island
  graveyard: []
opponent:
  life: 20
  librarySize: 54
  handSize: 6
  battlefield: []
  graveyard: []
recentLog:
  - P2 has mulliganed down to 6 cards.
  - P1 has kept a hand of 7 cards
  - P2 has kept a hand of 6 cards
  - Turn 1 (P1)
  - P1 played Island (22)
```

### `mana_payment`

Pago de maná cuando hay fuentes distintas (color, tierras con habilidad). Cuando las fuentes son intercambiables o justas, el harness paga solo y no te pregunta.

Prompt: `Elvish Vanguard - Creature 1 / 1 Pay Mana Cost: {1}{G}`  
Opciones (elegir entre 2 y 3):

```json
[{"id":"c36","label":"Pay mana with card: your Forest"},
 {"id":"c15","label":"Pay mana with card: your Llanowar Elves 1/1"},
 {"id":"c32","label":"Pay mana with card: your Forest"}]
```

Estado (resumen): turno 3, fase MAIN1, juega you, vida 20 vs 20, mano Generous Ent, Nyxborn Hydra, Sagu Wildling, Forest

### `attackers`

Declarar atacantes: todas de una vez (0..N). Nada = no atacar.

Prompt: `Select creatures to attack P2 or select player/card you wish to attack. Choose all your attacking creatures at once (none = no attack).`  
Opciones (elegir entre 0 y 1):

```json
[{"id":"c11","label":"Attack with card: your Insectile Aberration 3/2"}]
```

Estado (`state`):

```yaml
game: 1
match:
  gamesYouWon: 0
  gamesOpponentWon: 0
turn: 3
phase: COMBAT_DECLARE_ATTACKERS
activePlayer: you
youAre: P1
you:
  life: 20
  librarySize: 54
  hand:
    - id: c1
      name: Tolarian Terror
      pt: 5/5
    - id: c58
      name: Counterspell
    - id: c56
      name: Sleep of the Dead
    - id: c54
      name: Dispel
  landsPlayedThisTurn: 0
  battlefield:
    - id: c27
      name: Island
    - id: c11
      name: Insectile Aberration
      text: Flying
      pt: 3/2
  graveyard: []
opponent:
  life: 20
  librarySize: 52
  handSize: 7
  battlefield:
    - id: c87
      name: Forest
  graveyard: []
recentLog:
  - P1 has mulliganed down to 6 cards.
  - P1 has mulliganed down to 5 cards.
  - P1 has kept a hand of 5 cards
  - P2 has kept a hand of 7 cards
  - Turn 1 (P1)
  - P1 played Island (27)
  - P1 cast Delver of Secrets
  - Delver of Secrets - Creature 1 / 1
  - Turn 2 (P2)
  - P2 played Forest (87)
  - Turn 3 (P1)
  - P1 triggered Delver of Secrets
  - At the beginning of your upkeep, look at the top card of your library. You
    may reveal that card. If an instant or sorcery card is revealed this way,
    transform Delver of Secrets.
```

### `blockers`

Declarar bloqueadores: cada opción es `bloqueador->atacante`; varias de tus criaturas pueden bloquear al mismo atacante. Nada = no bloquear.

Prompt: `Select creatures to block Kessig Flamebreather (73) or select another attacker to declare blockers for. Choose all your blocks at once: each of your creatures blocks at most one attacker; several may block the same attac`  
Opciones (elegir entre 0 y 1):

```json
[{"id":"c42->c73","label":"Elvish Vanguard 1/1 (c42) blocks Kessig Flamebreather 1/3 (c73)"}]
```

Estado (`state`):

```yaml
game: 1
match:
  gamesYouWon: 0
  gamesOpponentWon: 0
turn: 6
phase: COMBAT_DECLARE_BLOCKERS
activePlayer: opponent
youAre: P1
you:
  life: 20
  librarySize: 51
  hand:
    - id: c52
      name: Nyxborn Hydra
      pt: 0/1
    - id: c22
      name: Quirion Ranger
      pt: 1/1
    - id: c6
      name: Lead the Stampede
    - id: c48
      name: Fyndhorn Elves
      pt: 1/1
    - id: c26
      name: Masked Vandal
      pt: 1/3
  landsPlayedThisTurn: 0
  battlefield:
    - id: c35
      name: Forest
      tapped: true
    - id: c46
      name: Fyndhorn Elves
      text: "{T}: Add {G}."
      pt: 1/1
      tapped: true
    - id: c42
      name: Elvish Vanguard
      text: Whenever another Elf enters, put a +1/+1 counter on Elvish Vanguard.
      pt: 1/1
      summoningSick: true
  graveyard:
    - Elvish Mystic
opponent:
  life: 20
  librarySize: 50
  handSize: 6
  battlefield:
    - id: c96
      name: Mountain
    - id: c91
      name: Mountain
    - id: c73
      name: Kessig Flamebreather
      text: Whenever you cast a noncreature spell, Kessig Flamebreather deals 1 damage
        to each opponent.
      pt: 1/3
      tapped: true
  graveyard:
    - Lightning Bolt
combat:
  - id: c73
    name: Kessig Flamebreather
    text: Whenever you cast a noncreature spell, Kessig Flamebreather deals 1 damage
      to each opponent.
    pt: 1/3
    tapped: true
    attacking: you
recentLog:
  - P2 cast Lightning Bolt targeting [Elvish Mystic (38)]
  - Lightning Bolt (62) deals 3 damage to Elvish Mystic (38).
  - Lightning Bolt (62) - Lightning Bolt (62) deals 3 damage to Elvish Mystic
    (38).
  - Turn 3 (P1)
  - P1 cast Fyndhorn Elves
  - Fyndhorn Elves - Creature 1 / 1
  - Turn 4 (P2)
  - P2 played Mountain (91)
  - P2 cast Kessig Flamebreather
  - Kessig Flamebreather - Creature 1 / 3
  - Turn 5 (P1)
  - P1 cast Elvish Vanguard
  - Elvish Vanguard - Creature 1 / 1
  - Turn 6 (P2)
  - P2 assigned Kessig Flamebreather (73) to attack P1.
```

### `discard`

Descartar N cartas (Looting, mano de 8 al final del turno).

Prompt: `Faithless Looting (11) Discard 2 card(s)`  
Opciones (elegir 2):

```json
[{"id":"c1","label":"select card: your Lightning Bolt [Hand]"},
 {"id":"c58","label":"select card: your Fiery Temper [Hand]"},
 {"id":"c18","label":"select card: your Grab the Prize [Hand]"},
 {"id":"c54","label":"select card: your Highway Robbery [Hand]"},
 {"id":"c4","label":"select card: your Lightning Bolt [Hand]"}]
```

Estado (resumen): turno 1, fase MAIN1, juega you, vida 20 vs 20, mano Lightning Bolt, Fiery Temper, Grab the Prize, Highway Robbery, Lightning Bolt

### `choose_cards`

Elegir cartas (p. ej. qué descartar a un coste adicional, qué mirar).

Prompt: `Grab the Prize (20)  - As an additional cost to cast this spell, discard a card. Draw two cards. If the discarded card wasn't a land card, Grab the Prize deals 2 damage to each opponent. `  
Opciones (elegir 1):

```json
[{"id":"c6","label":"select card: your Sneaky Snacker 2/1 [Hand]"},
 {"id":"c53","label":"select card: your Highway Robbery [Hand]"},
 {"id":"c12","label":"select card: your Sazacap's Brew [Hand]"}]
```

Estado (resumen): turno 3, fase MAIN1, juega you, vida 20 vs 20, mano Sneaky Snacker, Highway Robbery, Sazacap's Brew

### `confirm`

Sí/no a un efecto opcional ("¿querés …?").

Prompt: `Your Ponder: Do you want to shuffle the library? `  
Opciones (elegir 1):

```json
[{"id":"yes","label":"Button: Yes"},
 {"id":"no","label":"Button: No"}]
```

Estado (resumen): turno 1, fase MAIN1, juega you, vida 20 vs 20, mano Deem Inferior, Spell Pierce, Island, Thought Scour, Lórien Revealed

### `order_triggers`

Orden de los disparos simultáneos propios.

Prompt: `Choose order of cards to put into the library (Closest to top: pick the next one) `  
Opciones (elegir 1):

```json
[{"id":"o1","label":"Island (c26)"},
 {"id":"o2","label":"Mental Note (c42)"},
 {"id":"o3","label":"Island (c31)"}]
```

Estado (resumen): turno 1, fase MAIN1, juega you, vida 20 vs 20, mano Deem Inferior, Spell Pierce, Island, Thought Scour, Lórien Revealed

### `optional_costs`

Costes opcionales (kicker, coste alternativo como Fireblast sacrificando Mountains).

Prompt: `Choose optional costs `  
Opciones (elegir entre 0 y 1):

```json
[{"id":"o1","label":"Promise Gift – Gift something"}]
```

Estado (resumen): turno 5, fase MAIN1, juega you, vida 20 vs 18, mano Highway Robbery, Sazacap's Brew, Sneaky Snacker, Fiery Temper

### `choose_ability`

Qué habilidad de una carta usar (p. ej. ciclar vs lanzar).

Prompt: `Choose what to do with Nyxborn Hydra. `  
Opciones (elegir entre 0 y 1):

```json
[{"id":"o1","label":"Nyxborn Hydra - Creature 0 / 1 (X=0)"},
 {"id":"o2","label":"Bestow {X}{G}{G} (If you cast this card for its bestow cost, it's an Aura spell with enchant creature. It becomes a creature again if it's not attached to a creature.)"}]
```

Estado (resumen): turno 5, fase MAIN1, juega you, vida 20 vs 20, mano Timberwatch Elf, Nyxborn Hydra, Lead the Stampede

### `choose_entity`

Elegir una carta/permanente entre varias.

Prompt: `Choose a card type `  
Opciones (elegir 1):

```json
[{"id":"o1","label":"Creature"},
 {"id":"o2","label":"Land"}]
```

Estado (resumen): turno 3, fase MAIN1, juega you, vida 20 vs 20, mano Lead the Stampede, Timberwatch Elf, Nyxborn Hydra, Priest of Titania

### `choose_number`

Elegir un número (X).

Prompt: `Choose X for Nyxborn Hydra (mana cost {X}{G}). Your untapped sources and floating mana make about 2 mana, so X can be at most 1. `  
Opciones (elegir entre 0 y 1):

```json
[{"id":"o1","label":"0"},
 {"id":"o2","label":"1"}]
```

Estado (resumen): turno 5, fase MAIN1, juega you, vida 20 vs 20, mano Timberwatch Elf, Lead the Stampede

### `pay_or_else`

Pagar un coste o aceptar la alternativa.

Prompt: `Highway Robbery (56)  - Discard a card. If you do, draw two cards.`  
Opciones (elegir 1):

```json
[{"id":"c55","label":"select card: your Highway Robbery [Hand]"},
 {"id":"c3","label":"select card: your Lightning Bolt [Hand]"},
 {"id":"c16","label":"select card: your Kessig Flamebreather 1/3 [Hand]"},
 {"id":"c57","label":"select card: your Fiery Temper [Hand]"}]
```

Estado (resumen): turno 7, fase MAIN1, juega you, vida 17 vs 13, mano Highway Robbery, Lightning Bolt, Kessig Flamebreather, Fiery Temper

### `assign_damage`

Repartir daño de combate entre varios bloqueadores.

Prompt: `Assign 1 combat damage from Timberwatch Elf (c11) among its blockers (trample: the player gets damage only after each blocker has lethal). `  
Opciones (elegir 1):

```json
[{"id":"o1","label":"Kessig Flamebreather (c73): 1, Kessig Flamebreather (c75): 0, defending P2: 0"},
 {"id":"o2","label":"Kessig Flamebreather (c73): 0, Kessig Flamebreather (c75): 1, defending P2: 0"}]
```

Estado (resumen): turno 10, fase COMBAT_DAMAGE, juega you, vida 17 vs 20, mano Timberwatch Elf, Masked Vandal, Land Grant

### `scry`

Scry: qué cartas van arriba y qué cartas al fondo.

Prompt: `Move cards to top or bottom of library Choose the cards to put on the bottom (none = keep all on top). `  
Opciones (elegir entre 0 y 2):

```json
[{"id":"o1","label":"Quirion Ranger (c22)"},
 {"id":"o2","label":"Land Grant (c44)"}]
```

Estado (resumen): turno 15, fase UPKEEP, juega you, vida 10 vs 1, mano Forest

### `scry_order`

Orden de las cartas que quedan arriba.

Prompt: `Move cards to top or bottom of library Order the cards staying on top (top card: pick the next one) `  
Opciones (elegir 1):

```json
[{"id":"o1","label":"Quirion Ranger (c22)"},
 {"id":"o2","label":"Land Grant (c44)"}]
```

Estado (resumen): turno 15, fase UPKEEP, juega you, vida 10 vs 1, mano Forest

## Reglas y límites

- Un asiento externo por partida: tu bot contra nuestro piloto (o contra la IA de stock de Forge para probar).
- Cartas: Pauper, nombres en inglés de Forge (el lobby valida la lista al guardarla).
- El estado nunca incluye información oculta (tu rival tampoco ve tu mano).
- Si tu bot contesta un id inválido o una cantidad fuera de rango recibe 400 y la decisión sigue abierta hasta el timeout.
- Registro: al terminar, nosotros tenemos `decisions.jsonl` de los dos lados y el reporte; te lo pasamos si querés.
