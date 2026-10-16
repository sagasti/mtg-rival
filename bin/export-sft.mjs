#!/usr/bin/env node
// Exporta las decisiones grabadas de los seats LLM como dataset de fine-tuning (prompt renderizado -> respuesta),
// con el resultado de la partida para filtrar por outcome. Uso: bin/export-sft.mjs [out=data/sft/decisions.jsonl] [--runs glob]
// Cada línea: {run, matchId, game, seat, model, kind, turn, won, onThePlay, requestId, prompt, choice, choiceLabels}
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = process.argv[2] ?? "data/sft/decisions.jsonl";
const LLM = new Set(["openai", "anthropic", "openrouter", "gemini"]);
fs.mkdirSync(path.dirname(path.resolve(root, out)), { recursive: true });
const w = fs.createWriteStream(path.resolve(root, out)); const stats = { runs: 0, games: 0, lines: 0, bySeat: {}, byKind: {}, won: 0 };
for (const run of fs.readdirSync(path.join(root, "runs")).sort()) {
  const dir = path.join(root, "runs", run); if (!fs.existsSync(path.join(dir, "rendered-prompts.jsonl")) || !fs.existsSync(path.join(dir, "matches.jsonl"))) continue;
  const jl = (f) => fs.readFileSync(path.join(dir, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const prompts = new Map(jl("rendered-prompts.jsonl").map((r) => [r.requestId, r.prompt]));
  const outcome = new Map(); // matchId -> { seats, winner, onThePlay }
  for (const m of jl("matches.jsonl")) for (const g of m.games) outcome.set(`${m.matchId}:${g.game}`, { seats: m.seats, winner: g.winner, onThePlay: g.onThePlay, turns: g.turns });
  stats.runs++; stats.games += outcome.size;
  for (const d of jl("decisions.jsonl")) {
    if (!LLM.has(d.provider) || d.phase !== "game" || !d.valid || d.forfeit || d.fallback || d.autoResolved) continue;
    const prompt = prompts.get(d.requestId); const o = outcome.get(`${d.matchId}:${d.game}`); if (!prompt || !o) continue;
    const idx = o.seats.indexOf(d.seat); const won = o.winner === idx;
    const turn = Number((prompt.match(/^turn: (\d+)/m) ?? [])[1] ?? -1);
    w.write(JSON.stringify({ run, matchId: d.matchId, game: d.game, seat: d.seat, model: d.model, kind: d.kind, turn, won, onThePlay: o.onThePlay === idx, requestId: d.requestId, prompt, choice: d.choice, choiceLabels: d.choiceLabels }) + "\n");
    stats.lines++; stats.bySeat[d.seat] = (stats.bySeat[d.seat] ?? 0) + 1; stats.byKind[d.kind] = (stats.byKind[d.kind] ?? 0) + 1; if (won) stats.won++;
  }
}
w.end(); console.log(JSON.stringify(stats, null, 1));
