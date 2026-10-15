#!/usr/bin/env node
// Compara dos runs pareados (mismas barajadas) partida por partida: salir/robar, resultado, turnos, mulligans
// (cartas/tierras[:verdict de la sección] -> K|M), counters jugados. Uso:
//   bin/paired-cmp.mjs <runA> <runB> [--seat glm] [--n 12] [--lands "Nombre,Nombre"]
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import YAML from "../vendor/mtg-bench/node_modules/yaml/dist/index.js";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2); const flags = {}; const pos = [];
for (let i = 0; i < args.length; i++) { if (args[i].startsWith("--")) { flags[args[i].slice(2)] = args[i + 1]; i++; } else pos.push(args[i]); }
if (pos.length < 2) { console.error("uso: paired-cmp.mjs <runA> <runB> [--seat glm] [--n 12] [--lands a,b]"); process.exit(2); }
const SEAT = flags.seat ?? "glm", N = Number(flags.n ?? 12);
const LANDS = new Set(["Mountain","Forest","Island","Swamp","Plains","Ash Barrens","Snow-Covered Plains","Snow-Covered Island","Snow-Covered Forest","Ancient Den","Idyllic Beachfront","Razortide Bridge","Seat of the Synod","Bojuka Bog","Contaminated Aquifer","Dimir Aqueduct","Seething Landscape","Volatile Fjord","Evolving Wilds","Khalni Garden","Quandrix Campus", ...(flags.lands ? flags.lands.split(",") : [])]);
const COUNTERS = new Set(["Counterspell","Spell Pierce","Lose Focus","Essence Scatter","Negate","Mana Leak","Spellstutter Sprite","Hydroblast","Blue Elemental Blast","Force Spike","Dispel","Deem Inferior"]);
function load(run) {
  const dir = path.join(root, "runs", run); const jl = (f) => fs.readFileSync(path.join(dir, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const prompts = new Map(jl("rendered-prompts.jsonl").map((r) => [r.requestId, r])); const games = {};
  for (const m of jl("matches.jsonl")) { const g = m.games[0]; const me = m.seats.indexOf(SEAT); games[m.round] = { win: g.winner === me, play: g.onThePlay === me, turns: g.turns, mulls: [], keep: null, counters: 0 }; }
  for (const d of jl("decisions.jsonl")) {
    if (d.seat !== SEAT) continue; const G = games[Number(d.matchId.match(/^h2h-(\d+)-/)[1])]; if (!G) continue;
    if (d.kind === "mulligan") {
      const p = prompts.get(d.requestId); let size = "?", lands = "?", verdict = "";
      if (p) { const s = p.prompt.indexOf("## State\n"); const e = p.prompt.indexOf("\n## ", s + 9); const st = YAML.parse(p.prompt.slice(s + 9, e)); const hand = st.you?.hand ?? []; size = hand.length; lands = hand.filter((h) => LANDS.has(h.name)).length; const v = p.prompt.match(/Heuristic verdict: \*\*([A-Z]+)( \(borderline\))?\*\*/); verdict = v ? v[1][0] + (v[2] ? "b" : "") : ""; }
      const keep = d.choice[0] === "ok"; G.mulls.push(`${size}c/${lands}L${verdict ? ":" + verdict : ""}->${keep ? "K" : "M"}`); if (keep) G.keep = { size, lands };
    }
    if (d.kind === "priority" && d.choiceLabels) for (const l of d.choiceLabels) for (const c of COUNTERS) if (l.includes(c)) G.counters++;
  }
  return games;
}
const A = load(pos[0]), B = load(pos[1]); let same = 0, wa = 0, wb = 0; const lk = { A: {}, B: {} };
console.log(`round | A play? | A | A mulls | B play? | B | B mulls | counters A/B`);
for (let r = 1; r <= N; r++) { const x = A[r], y = B[r]; if (!x || !y) { console.log(`${r} | missing`); continue; } if (x.win === y.win) same++; wa += x.win; wb += y.win;
  for (const [k, g] of [["A", x], ["B", y]]) if (g.keep) { const key = `${g.keep.size}c/${g.keep.lands}L`; lk[k][key] = (lk[k][key] ?? 0) + 1; }
  console.log(`${r} | ${x.play ? "P" : "D"} | ${x.win ? "W" : "L"}${x.turns} | ${x.mulls.join(" ")} | ${y.play ? "P" : "D"} | ${y.win ? "W" : "L"}${y.turns} | ${y.mulls.join(" ")} | ${x.counters}/${y.counters}`); }
console.log(`A ${wa}-${N - wa}  B ${wb}-${N - wb}  same result ${same}/${N}\nkept A ${JSON.stringify(lk.A)}\nkept B ${JSON.stringify(lk.B)}`);
