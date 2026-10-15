/**
 * MCP (Model Context Protocol) del lobby: las mismas acciones que la mesa web, como tools para un agente externo.
 * Transporte Streamable HTTP en POST/GET/DELETE /mcp del lobby (bin/mesa.mjs). Una sesión MCP = un cliente; la sesión
 * se autentica con la tool `login` (o `register`), o con `Authorization: Bearer <token de sesión del lobby>`.
 * Tools: login, register, whoami, list_rivals, validate_deck, save_deck, list_decks, get_deck, delete_deck,
 *        start_game, game_status, wait_for_decision, answer, abandon_game.   Resource: mtg-rival://docs/api-bot
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { RIVALES, SEATS, parseList, createUser, verifyUser, getUser, readSession, listDecks, getDeck, saveDeck, deleteDeck } from "./mesa-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ok = (o) => ({ content: [{ type: "text", text: typeof o === "string" ? o : JSON.stringify(o, null, 1) }] });
const fail = (msg) => ({ content: [{ type: "text", text: String(msg) }], isError: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** lobby = { get game(), startGame({user, player, deck, rival, seat, modo}), stopGame(), estado(user), checkInvite(code) } */
export function createMcp(lobby) {
  const sessions = new Map(); // sessionId -> { transport, user }

  async function pending(game) {
    if (!game?.port || !game.token) return null;
    try { return await (await fetch(`http://127.0.0.1:${game.port}/pending?t=${game.token}`)).json(); } catch { return null; }
  }

  function build(session) {
    const server = new McpServer({ name: "mtg-rival-mesa", version: "1.0.0" });
    const needUser = () => { if (!session.user) throw new Error("not logged in: call login (or register) first"); return session.user; };
    const mine = () => { const g = lobby.game; const u = needUser(); if (!g) return null; if (g.user !== u) throw new Error(`the table is busy: ${g.player} is playing`); return g; };

    server.registerTool("login", { title: "Log in", description: "Log in to the lobby with your account. Required before deck and game tools (unless the connection carries a Bearer token).", inputSchema: { usuario: z.string(), clave: z.string() } },
      async ({ usuario, clave }) => { const u = verifyUser(usuario, clave); if (!u) { await sleep(500); return fail("wrong user or password"); } session.user = u; return ok({ usuario: u, nombre: getUser(u)?.nombre }); });
    server.registerTool("register", { title: "Create account", description: "Create a lobby account with the invitation code you were given, and log in.", inputSchema: { usuario: z.string().describe("3-24 chars, letters/digits/._-"), clave: z.string().min(6), nombre: z.string().optional(), invitacion: z.string() } },
      async ({ usuario, clave, nombre, invitacion }) => { if (!lobby.checkInvite(invitacion)) { await sleep(500); return fail("wrong invitation code"); } let u; try { u = createUser(usuario, clave, nombre ?? usuario); } catch (e) { return fail(e.message); } session.user = u; console.log(`[mesa] cuenta nueva (mcp): ${u}`); return ok({ usuario: u }); });
    server.registerTool("whoami", { title: "Who am I", description: "The logged-in account, if any." }, async () => ok(session.user ? { usuario: session.user, nombre: getUser(session.user)?.nombre } : { usuario: null }));
    server.registerTool("list_rivals", { title: "List rival decks and opponents", description: "Decks the opponent can play (rival_deck slugs) and who pilots them (opponent seats). Default opponent: glm, our LLM pilot." },
      async () => ok({ rival_decks: RIVALES, opponents: SEATS, default_opponent: "glm" }));
    server.registerTool("validate_deck", { title: "Validate a deck list", description: "Parse a Pauper deck list (lines like '4 Lightning Bolt'; Forge's English card names; sideboard ignored) without saving it.", inputSchema: { list: z.string() } },
      async ({ list }) => ok(parseList(list)));
    server.registerTool("save_deck", { title: "Save a deck", description: "Save (or update, with slug) a deck list for your account. Returns the slug to use in start_game.", inputSchema: { name: z.string(), list: z.string(), slug: z.string().optional().describe("to overwrite an existing deck") } },
      async ({ name, list, slug }) => { const u = needUser(); try { const d = saveDeck(u, { nombre: name, lista: list, slug }); return ok({ slug: d.slug, nombre: d.nombre, total: d.total ?? undefined }); } catch (e) { return fail(e.message); } });
    server.registerTool("list_decks", { title: "List my decks", description: "Your saved decks (slug, name, size)." }, async () => ok(listDecks(needUser())));
    server.registerTool("get_deck", { title: "Get a deck", description: "A saved deck's list.", inputSchema: { slug: z.string() } }, async ({ slug }) => { const d = getDeck(needUser(), slug); return d ? ok(d) : fail("no such deck"); });
    server.registerTool("delete_deck", { title: "Delete a deck", inputSchema: { slug: z.string() } }, async ({ slug }) => { try { deleteDeck(needUser(), slug); return ok({ ok: true }); } catch (e) { return fail(e.message); } });

    server.registerTool("start_game", { title: "Start a game", description: "Start a best-of-one Pauper game: your saved deck against the opponent's deck, you playing through the API (bot mode). One game at a time on the table. Then loop: wait_for_decision -> answer.", inputSchema: { deck: z.string().describe("slug of one of your saved decks"), rival_deck: z.string().describe("slug from list_rivals"), opponent: z.string().optional().describe("seat from list_rivals; default glm (our pilot). forge-ai-1 = Forge's stock AI, for testing") } },
      async ({ deck, rival_deck, opponent }) => {
        const u = needUser(); if (lobby.game) return fail(`a game is already in progress (${lobby.game.player})`);
        if (!RIVALES[rival_deck]) return fail(`unknown rival_deck; one of: ${Object.keys(RIVALES).join(", ")}`);
        const seat = opponent ?? "glm"; if (!SEATS[seat]) return fail(`unknown opponent; one of: ${Object.keys(SEATS).join(", ")}`);
        const d = getDeck(u, deck); if (!d) return fail("save the deck first (save_deck) and pass its slug");
        const g = lobby.startGame({ user: u, player: getUser(u)?.nombre ?? u, deck: d, rival: rival_deck, seat, modo: "bot" });
        for (let i = 0; i < 120 && !g.token && lobby.game === g; i++) await sleep(500);
        if (!g.token) { const log = g.log.slice(-15).join("\n"); lobby.stopGame(); return fail(`the game did not start:\n${log}`); }
        return ok({ runId: g.runId, you: d.nombre, opponent: `${SEATS[seat]} with ${RIVALES[rival_deck]}`, next: "call wait_for_decision" });
      });
    server.registerTool("game_status", { title: "Game status", description: "Whether a game is in progress, whose it is, and whether a decision is pending for you." },
      async () => { const u = needUser(); const e = lobby.estado(u); const g = lobby.game; const p = g && g.user === u ? await pending(g) : null; return ok({ ...e, url: undefined, pending: p ? { rid: p.rid, kind: p.kind, prompt: p.prompt, deadline: p.deadline } : null }); });
    server.registerTool("wait_for_decision", { title: "Wait for my next decision", description: "Blocks up to timeout_sec (default 30, max 55) until the game asks you something. Returns the full decision (rid, kind, prompt, state, options with ids, min, max, cards oracle text, deadline) to answer with `answer`; or {gameOver, result} when the game ended; or {waiting: true} if nothing happened yet (call again).", inputSchema: { timeout_sec: z.number().optional() } },
      async ({ timeout_sec }) => {
        const u = needUser(); const until = Date.now() + Math.min(Math.max(timeout_sec ?? 30, 1), 55) * 1000;
        while (true) {
          const g = lobby.game;
          if (!g) { const e = lobby.estado(u); return ok({ gameOver: true, result: e.ultimo?.resultado ?? null, runId: e.ultimo?.runId }); }
          if (g.user !== u) return fail(`the table is busy: ${g.player} is playing`);
          const p = await pending(g); if (p) return ok(p);
          if (Date.now() > until) return ok({ waiting: true, hint: "nothing pending yet; call wait_for_decision again" });
          await sleep(500);
        }
      });
    server.registerTool("answer", { title: "Answer the pending decision", description: "Send your choice for the pending decision: the option ids (min..max of them; [] when min is 0, e.g. no attack / no block).", inputSchema: { rid: z.string(), choice: z.array(z.string()) } },
      async ({ rid, choice }) => {
        const g = mine(); if (!g?.port) return fail("no game in progress");
        const r = await fetch(`http://127.0.0.1:${g.port}/answer?t=${g.token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rid, choice }) });
        const j = await r.json().catch(() => ({ error: r.statusText })); return r.ok ? ok(j) : fail(j.error ?? "rejected");
      });
    server.registerTool("abandon_game", { title: "Abandon the game", description: "Stop your game in progress (counts as a loss)." }, async () => { const g = mine(); if (!g) return ok({ ok: true, note: "no game in progress" }); lobby.stopGame(); return ok({ ok: true }); });

    server.registerResource("api-doc", "mtg-rival://docs/api-bot", { title: "API doc for external bots", description: "Decision kinds, state schema, one real example per kind.", mimeType: "text/markdown" },
      async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: fs.readFileSync(path.join(root, "docs/API-BOT.md"), "utf8") }] }));
    return server;
  }

  async function handle(req, res, bodyText) {
    const sid = req.headers["mcp-session-id"];
    let s = sid ? sessions.get(sid) : undefined;
    if (!s) {
      let parsed; try { parsed = bodyText ? JSON.parse(bodyText) : undefined; } catch { parsed = undefined; }
      if (req.method !== "POST" || !isInitializeRequest(parsed)) { res.writeHead(400, { "content-type": "application/json" }); return res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "no valid session; send an initialize request first" }, id: null })); }
      const auth = /^Bearer (.+)$/.exec(req.headers.authorization ?? "");
      const session = { user: auth ? readSession(auth[1].trim()) : null, transport: null };
      session.transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => crypto.randomUUID(), onsessioninitialized: (id) => sessions.set(id, session), onsessionclosed: (id) => sessions.delete(id) });
      await build(session).connect(session.transport);
      return session.transport.handleRequest(req, res, parsed);
    }
    let parsed; try { parsed = bodyText ? JSON.parse(bodyText) : undefined; } catch { parsed = undefined; }
    return s.transport.handleRequest(req, res, parsed);
  }
  return { handle };
}
