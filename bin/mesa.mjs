#!/usr/bin/env node
/**
 * Lobby de la mesa web (mtg-rival-pilot): cada persona tiene su cuenta y sus mazos guardados, elige uno, el rival y
 * juega contra el piloto. Sin dependencias. Lo compartido con la consola de admin está en bin/mesa-lib.mjs.
 *   GET  /                     lobby si hay sesión, login si no (o la mesa de la partida en curso con ?t=<token>)
 *   POST /registro             {usuario, clave, invitacion}   crea la cuenta (el código MESA_INVITE es la puerta)
 *   POST /login  /logout       {usuario, clave}              cookie "mesa" firmada, 30 días
 *   GET  /yo                   quién soy
 *   GET  /mazos  POST /mazos   lista / crea o actualiza ({nombre, lista, slug?})   GET|DELETE /mazos/<slug>
 *   POST /validar              {lista} -> cartas reconocidas / desconocidas (contra la base de Forge)
 *   POST /jugar                {mazo, rival, seat, modo?: humano|bot} -> lanza bin/human-game.sh (o bin/bot-game.sh) con el .dck guardado y devuelve el link
 *   GET  /api-bot /bot-client.py  doc y cliente de ejemplo para un bot externo (docs/API-BOT.md, examples/bot-client.py)
 *   POST/GET/DELETE /mcp       servidor MCP (Streamable HTTP) con las mismas acciones como tools: bin/mesa-mcp.mjs
 *   POST /abandonar            corta la partida (sólo quien la empezó)     GET /estado
 *   /events /answer /pending /img y /?t= se proxyan a la mesa (src/human/server.ts) mientras hay partida
 * Una partida por vez. Puerto 8787 (MESA_PORT). Código de invitación MESA_INVITE (si falta, se genera y se imprime).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { createMcp } from "./mesa-mcp.mjs";
import {
  root, RIVALES, SEATS, parseList, slugify,
  createUser, verifyUser, getUser, makeSession, readSession,
  listDecks, getDeck, saveDeck, deleteDeck, deckFile,
} from "./mesa-lib.mjs";

const PORT = Number(process.env.MESA_PORT ?? 8787);
const INVITE = process.env.MESA_INVITE || crypto.randomBytes(4).toString("hex");
const COOKIE = "mesa";

// --- partida en curso ------------------------------------------------------------------------------------------------
let game = null; // { child, port, token, user, player, deck, rival, seat, runId, startedAt, result, log: [] }
let lastResult = null;

function startGame({ user, player, deck, rival, seat, modo = "humano" }) {
  const runId = `mesa-${modo === "bot" ? "bot-" : ""}${user}-${slugify(deck.nombre, "mazo").slice(0, 20)}-${new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19)}`;
  const script = modo === "bot" ? "bin/bot-game.sh" : "bin/human-game.sh";
  const child = spawn(path.join(root, script), [deckFile(user, deck.slug), path.join(root, "decks", `pauper-${rival}.dck`), runId, seat], { cwd: root, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  const g = { child, port: null, token: null, user, player, deck: deck.nombre, rival, seat, modo, runId, startedAt: Date.now(), result: null, log: [] };
  const onLine = (line) => {
    g.log.push(line); if (g.log.length > 200) g.log.shift();
    const m = line.match(/open http:\/\/localhost:(\d+)\/\?t=([A-Za-z0-9_-]+)/);
    if (m) { g.port = Number(m[1]); g.token = m[2]; }
    const r = line.match(/^Games: (.*)$/);
    if (r) g.result = r[1];
  };
  let buf = "";
  const feed = (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { onLine(buf.slice(0, i)); buf = buf.slice(i + 1); } };
  child.stdout.on("data", feed); child.stderr.on("data", feed);
  child.on("exit", (code) => { lastResult = { ...g, exitCode: code, child: undefined }; if (game === g) game = null; console.log(`[mesa] partida ${runId} terminó (exit ${code}): ${g.result ?? "sin resultado"}`); });
  game = g;
  console.log(`[mesa] partida ${runId}: ${player} (${deck.nombre}) vs ${seat} con ${rival}`);
  return g;
}

function stopGame() {
  if (!game) return;
  const g = game; game = null;
  try { g.child.kill("SIGTERM"); } catch {}
  setTimeout(() => { try { g.child.kill("SIGKILL"); } catch {} }, 3000);
  // el bridge Java queda huérfano si node muere sin cerrar el match: lo buscamos por run-id
  spawn("pkill", ["-f", `AgentBridge.*${g.runId}`]);
}

// --- http ---------------------------------------------------------------------------------------------------------------
const PROXIED = new Set(["/events", "/answer", "/img", "/pending"]);
const DOCS = { "/api-bot": ["docs/API-BOT.md", "text/markdown; charset=utf-8"], "/bot-client.py": ["examples/bot-client.py", "text/plain; charset=utf-8"] };
const mcp = createMcp({ get game() { return game; }, startGame, stopGame, estado, checkInvite: (c) => sameCode(String(c ?? "").trim(), INVITE) });
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname, m = req.method;
  try {
    if (p === "/mcp") return mcp.handle(req, res, m === "POST" ? await body(req) : "");
    if (game?.port && (PROXIED.has(p) || (p === "/" && url.searchParams.get("t")))) return proxy(req, res, game.port);
    if (DOCS[p]) { res.writeHead(200, { "content-type": DOCS[p][1] }); return res.end(fs.readFileSync(path.join(root, DOCS[p][0]))); }
    const user = readSession(cookies(req)[COOKIE]);
    if (p === "/" || p === "/lobby") return html(res, user ? lobbyPage(user) : loginPage());
    if (p === "/yo") return user ? json(res, { usuario: user, nombre: getUser(user)?.nombre }) : json(res, { error: "sin sesión" }, 401);
    if (p === "/estado") return json(res, estado(user));
    if (p === "/validar" && m === "POST") { const b = JSON.parse(await body(req)); return json(res, parseList(b.lista ?? "")); }

    if (p === "/registro" && m === "POST") {
      const b = JSON.parse(await body(req));
      if (!sameCode(String(b.invitacion ?? "").trim(), INVITE)) { await sleep(500); return json(res, { error: "código de invitación incorrecto" }, 403); }
      let u; try { u = createUser(b.usuario, b.clave, b.nombre ?? b.usuario); } catch (e) { return json(res, { error: e.message }, 400); }
      console.log(`[mesa] cuenta nueva: ${u}`);
      return json(res, { usuario: u }, 200, { "set-cookie": cookie(makeSession(u)) });
    }
    if (p === "/login" && m === "POST") {
      const b = JSON.parse(await body(req));
      const u = verifyUser(b.usuario ?? "", b.clave ?? "");
      if (!u) { await sleep(500); return json(res, { error: "usuario o clave incorrectos" }, 401); }
      return json(res, { usuario: u }, 200, { "set-cookie": cookie(makeSession(u)) });
    }
    if (p === "/logout" && m === "POST") return json(res, { ok: true }, 200, { "set-cookie": cookie("", 0) });

    if (!user) return json(res, { error: "iniciá sesión" }, 401);

    if (p === "/mazos" && m === "GET") return json(res, listDecks(user));
    if (p === "/mazos" && m === "POST") {
      const b = JSON.parse(await body(req));
      try { return json(res, saveDeck(user, { nombre: b.nombre, lista: b.lista, slug: b.slug })); }
      catch (e) { return json(res, { error: e.message, ...(e.parsed ?? {}) }, 400); }
    }
    const dm = p.match(/^\/mazos\/([a-z0-9-]+)$/);
    if (dm && m === "GET") { const d = getDeck(user, dm[1]); return d ? json(res, d) : json(res, { error: "no existe" }, 404); }
    if (dm && m === "DELETE") { try { deleteDeck(user, dm[1]); return json(res, { ok: true }); } catch (e) { return json(res, { error: e.message }, 404); } }

    if (p === "/jugar" && m === "POST") {
      const b = JSON.parse(await body(req));
      if (game) return json(res, { error: `ya hay una partida en curso (${game.player})` }, 409);
      if (!RIVALES[b.rival] || !SEATS[b.seat]) return json(res, { error: "rival inválido" }, 400);
      const deck = getDeck(user, String(b.mazo ?? ""));
      if (!deck) return json(res, { error: "elegí uno de tus mazos guardados" }, 400);
      const modo = b.modo === "bot" ? "bot" : "humano";
      const g = startGame({ user, player: getUser(user)?.nombre ?? user, deck, rival: b.rival, seat: b.seat, modo });
      for (let i = 0; i < 120 && !g.token && game === g; i++) await sleep(500);
      if (!g.token) { const log = g.log.slice(-15).join("\n"); stopGame(); return json(res, { error: "la partida no arrancó", log }, 500); }
      return json(res, { url: `/?t=${g.token}`, runId: g.runId, modo });
    }
    if (p === "/abandonar" && m === "POST") {
      if (game && game.user !== user) return json(res, { error: `la partida es de ${game.player}` }, 403);
      stopGame(); return json(res, { ok: true });
    }
    res.statusCode = 404; res.end("not found");
  } catch (e) { res.statusCode = 500; res.end(String(e?.message ?? e)); }
});

function proxy(req, res, port) {
  const pr = http.request({ host: "127.0.0.1", port, path: req.url, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${port}` } }, (r) => {
    res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res);
  });
  pr.on("error", () => { res.statusCode = 502; res.end("la mesa no responde (¿terminó la partida?)"); });
  req.pipe(pr);
}
function estado(user) {
  return game
    ? { enCurso: true, jugador: game.player, mazo: game.deck, rival: RIVALES[game.rival], contra: SEATS[game.seat], modo: game.modo, desde: game.startedAt, mia: game.user === user, url: game.user === user && game.token ? `/?t=${game.token}` : null }
    : { enCurso: false, ultimo: lastResult ? { jugador: lastResult.player, mazo: lastResult.deck, rival: RIVALES[lastResult.rival], contra: SEATS[lastResult.seat], resultado: lastResult.result, runId: lastResult.runId } : null };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sameCode = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const cookies = (req) => Object.fromEntries((req.headers.cookie ?? "").split(";").map((c) => c.trim().split("=")).filter((c) => c[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join("="))]));
const cookie = (v, maxAge = 30 * 86400) => `${COOKIE}=${encodeURIComponent(v)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
const body = (req) => new Promise((ok, ko) => { let s = ""; req.on("data", (d) => { s += d; if (s.length > 2e5) req.destroy(); }); req.on("end", () => ok(s)); req.on("error", ko); });
const json = (res, o, code = 200, headers = {}) => { res.writeHead(code, { "content-type": "application/json; charset=utf-8", ...headers }); res.end(JSON.stringify(o)); };
const html = (res, s) => { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(s); };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// --- páginas --------------------------------------------------------------------------------------------------------------
const CSS = `
:root{--bg:#0f1115;--panel:#171a21;--line:#2a2f3a;--txt:#e8e8ec;--dim:#9aa0ad;--acc:#f5a524;--ok:#3fb950;--bad:#f85149}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--txt);font:15px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
main{max-width:860px;margin:0 auto;padding:24px 16px}h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:0 0 8px}.dim{color:var(--dim)}
header{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px;margin:14px 0}
label{display:block;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--dim);margin:10px 0 4px}
input,select,textarea{width:100%;background:#0f1115;color:var(--txt);border:1px solid var(--line);border-radius:6px;padding:8px;font:inherit}
textarea{min-height:260px;font-family:ui-monospace,Menlo,monospace;font-size:13px}
.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}.row3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px}@media(max-width:640px){.row,.row3{grid-template-columns:1fr}}
button{background:var(--acc);color:#000;border:0;border-radius:6px;padding:10px 16px;font-weight:700;font-size:15px;cursor:pointer;margin-top:12px}
button.sec{background:#232834;color:var(--txt);border:1px solid var(--line)}button.small{padding:4px 10px;font-size:13px;margin:0 0 0 6px}button:disabled{opacity:.4;cursor:not-allowed}
a{color:var(--acc)}.ok{color:var(--ok)}.bad{color:var(--bad)}ul{margin:6px 0 0 18px;padding:0}li{margin:2px 0}pre{white-space:pre-wrap;font-size:12px}
.mazo{display:flex;align-items:center;gap:8px;padding:8px 0;border-top:1px solid var(--line)}.mazo:first-of-type{border-top:0}.mazo .n{flex:1}
`;
const HEAD = (title) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>${CSS}</style></head><body><main>`;
const JS_COMMON = `const $=(i)=>document.getElementById(i);const esc=(s)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(url,data,method){const r=await fetch(url,{method:method||(data?'POST':'GET'),headers:data?{'content-type':'application/json'}:{},body:data?JSON.stringify(data):undefined});if(r.status===401&&!url.startsWith('/login')&&!url.startsWith('/registro')){location.reload();return {error:'sesión vencida'};}return r.json();}`;

function loginPage() {
  return `${HEAD("mtg-rival · entrar")}
<header><h1>mtg-rival · mesa</h1></header><div class="dim">Jugás Pauper contra el piloto que estamos entrenando. Entrá con tu cuenta; si es la primera vez, creala con el código que te pasó Jorge.</div>
<div class="panel">
  <div class="row"><div><label>Usuario</label><input id="usuario" autocomplete="username" placeholder="emi"></div><div><label>Clave</label><input id="clave" type="password" autocomplete="current-password"></div></div>
  <button id="entrar">Entrar</button>
  <div id="res" style="margin-top:10px"></div>
</div>
<div class="panel">
  <h2>¿Primera vez? Creá tu cuenta</h2>
  <div class="dim">Mismo usuario y clave de arriba, más el código de invitación. Los mazos que guardes quedan en tu cuenta.</div>
  <label>Código de invitación</label><input id="inv" placeholder="te lo pasa Jorge">
  <button class="sec" id="crear">Crear cuenta y entrar</button>
</div>
<script>${JS_COMMON}
async function go(url,extra){$('res').innerHTML='…';const p=await api(url,{usuario:$('usuario').value,clave:$('clave').value,...extra});if(p.usuario){location.href='/';return;}$('res').innerHTML='<span class="bad">'+esc(p.error||'error')+'</span>';}
$('entrar').onclick=()=>go('/login',{});$('crear').onclick=()=>go('/registro',{invitacion:$('inv').value});
$('clave').addEventListener('keydown',e=>{if(e.key==='Enter')go('/login',{})});$('inv').addEventListener('keydown',e=>{if(e.key==='Enter')go('/registro',{invitacion:$('inv').value})});
</script></main></body></html>`;
}

function lobbyPage(user) {
  const nombre = getUser(user)?.nombre ?? user;
  const rivales = Object.entries(RIVALES).map(([k, v]) => `<option value="${k}">${v}</option>`).join("");
  const seats = Object.entries(SEATS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("");
  return `${HEAD("mtg-rival · lobby")}
<header><h1>mtg-rival · mesa</h1><div class="dim">${esc(nombre)} <button class="sec small" id="salir">salir</button></div></header>
<div class="dim">Jugás Pauper contra el piloto que estamos entrenando. Guardá tu mazo una vez, después elegís y jugás.</div>
<div class="panel" id="estado">cargando…</div>
<div class="panel" id="jugarPanel">
  <h2>Jugar</h2>
  <div class="row3"><div><label>Tu mazo</label><select id="mazo"></select></div><div><label>El rival juega con</label><select id="rival">${rivales}</select></div><div><label>Contra</label><select id="seat">${seats}</select></div></div>
  <label>Quién juega</label><select id="modo"><option value="humano">vos, desde la mesa web</option><option value="bot">tu bot, por la API (<a href="/api-bot" target="_blank">doc</a>)</option></select>
  <button id="jugar" disabled>Jugar</button>
  <div id="resJugar" style="margin-top:10px"></div>
</div>
<div class="panel">
  <h2>Mis mazos</h2>
  <div id="mazos" class="dim">cargando…</div>
  <button class="sec" id="nuevo">+ Nuevo mazo</button>
  <div id="editor" style="display:none">
    <label>Nombre del mazo</label><input id="nombre" placeholder="Mono Red">
    <label>Lista (mazo principal; el sideboard se ignora)</label>
    <textarea id="lista" placeholder="4 Lightning Bolt
4 Monastery Swiftspear
…
16 Mountain"></textarea>
    <button class="sec" id="validar">Validar</button> <button id="guardar">Guardar</button> <button class="sec" id="cancelar">Cancelar</button>
    <div id="res" style="margin-top:10px"></div>
  </div>
</div>
<div class="panel dim"><b>Cómo se juega.</b> La mesa te muestra cada decisión con botones; la carta que corresponde a una opción se resalta y se puede clickear. Enter confirma o pasa. El sistema te pregunta sólo cuando hay algo que decidir: si no tenés jugadas, los turnos pasan solos. Los nombres de las cartas son los de Forge (inglés). Una partida por vez en la mesa.</div>
<script>${JS_COMMON}
let mazos=[],editando=null,fecha=(s)=>new Date(s).toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit'});
async function estado(){const e=await api('/estado');const el=$('estado');
 if(e.enCurso){const api=e.mia&&e.url&&e.modo==='bot'?'<div style="margin-top:8px"><b>Modo bot.</b> Conectá tu programa a esta URL (lleva tu token, no la compartas):<pre>'+esc(location.origin+e.url)+'</pre>Stream: <code>GET /events?t=…</code> · respuesta: <code>POST /answer?t=…</code> · pendiente: <code>GET /pending?t=…</code> · <a href="/api-bot" target="_blank">documentación</a> · <a href="/bot-client.py" target="_blank">cliente de ejemplo (Python)</a> · servidor MCP para agentes: <code>'+esc(location.origin)+'/mcp</code>: <code>python3 bot-client.py "'+esc(location.origin+e.url)+'"</code><br>También podés <a href="'+e.url+'">mirar la mesa</a> (si clickeás ahí, contestás vos por tu bot).</div>':'';
  el.innerHTML='<b>Partida en curso:</b> '+esc(e.jugador)+' con '+esc(e.mazo)+' vs '+esc(e.contra)+' con '+esc(e.rival)+(e.modo==='bot'?' (bot por la API)':'')+(e.mia?(e.url?(e.modo==='bot'?'':' — <a href="'+e.url+'">entrar a la mesa</a>'):' (arrancando…)')+' <button class="sec small" id="abandonar">abandonar</button>':' (mesa ocupada, esperá que termine)')+api;$('jugarPanel').style.display='none';
  const b=$('abandonar');if(b)b.onclick=async()=>{if(b.dataset.ok){await api('/abandonar',{});estado();}else{b.dataset.ok=1;b.textContent='¿seguro? tocá de nuevo';}};}
 else{el.innerHTML=e.ultimo?'<b>Última partida:</b> '+esc(e.ultimo.jugador)+' con '+esc(e.ultimo.mazo)+' vs '+esc(e.ultimo.contra)+' con '+esc(e.ultimo.rival)+' → '+esc(e.ultimo.resultado||'sin resultado'):'No hay partida en curso. Mesa libre.';$('jugarPanel').style.display='';}}
async function cargar(sel){mazos=await api('/mazos');if(!Array.isArray(mazos))mazos=[];
 $('mazos').innerHTML=mazos.length?mazos.map(m=>'<div class="mazo"><div class="n"><b>'+esc(m.nombre)+'</b> <span class="dim">'+m.total+' cartas · '+fecha(m.actualizado)+'</span></div><button class="sec small" onclick="editar(\\''+m.slug+'\\')">editar</button><button class="sec small" onclick="borrar(\\''+m.slug+'\\',this)">borrar</button></div>').join(''):'<div class="dim">Todavía no guardaste ningún mazo. Pegá tu lista con "Nuevo mazo".</div>';
 $('mazo').innerHTML=mazos.map(m=>'<option value="'+m.slug+'">'+esc(m.nombre)+' ('+m.total+')</option>').join('');if(sel)$('mazo').value=sel;$('jugar').disabled=!mazos.length;}
function abrirEditor(nombre,lista,slug){editando=slug||null;$('nombre').value=nombre||'';$('lista').value=lista||'';$('res').innerHTML='';$('editor').style.display='';$('nuevo').style.display='none';$('nombre').focus();}
$('nuevo').onclick=()=>abrirEditor('','',null);$('cancelar').onclick=()=>{$('editor').style.display='none';$('nuevo').style.display='';};
async function editar(slug){const d=await api('/mazos/'+slug);if(d.slug)abrirEditor(d.nombre,d.lista,d.slug);}
async function borrar(slug,b){if(!b.dataset.ok){b.dataset.ok=1;b.textContent='¿seguro?';return;}await api('/mazos/'+slug,null,'DELETE');cargar();}
function mostrar(p){let h='<div>'+p.total+' cartas reconocidas.</div>';if(p.unknown&&p.unknown.length)h+='<div class="bad">No reconozco: <ul>'+p.unknown.map(u=>'<li>'+esc(u)+'</li>').join('')+'</ul></div>';if(p.warnings&&p.warnings.length)h+='<div class="bad"><ul>'+p.warnings.map(w=>'<li>'+esc(w)+'</li>').join('')+'</ul></div>';if(p.ok)h+='<div class="ok">Lista OK ✓</div>';$('res').innerHTML=h;}
$('validar').onclick=async()=>mostrar(await api('/validar',{lista:$('lista').value}));
$('guardar').onclick=async()=>{const p=await api('/mazos',{nombre:$('nombre').value,lista:$('lista').value,slug:editando});if(p.slug){$('editor').style.display='none';$('nuevo').style.display='';cargar(p.slug);return;}if(p.unknown)mostrar(p);$('res').innerHTML='<div class="bad">'+esc(p.error||'error')+'</div>'+$('res').innerHTML;};
$('jugar').onclick=async()=>{$('jugar').disabled=true;$('resJugar').innerHTML='Arrancando la partida (Forge tarda unos segundos)…';
 const p=await api('/jugar',{mazo:$('mazo').value,rival:$('rival').value,seat:$('seat').value,modo:$('modo').value});
 if(p.url){if(p.modo==='bot'){$('resJugar').innerHTML='';estado();return;}location.href=p.url;return;}$('resJugar').innerHTML='<div class="bad">'+esc(p.error||'error')+(p.log?'<pre>'+esc(p.log)+'</pre>':'')+'</div>';$('jugar').disabled=false;};
$('salir').onclick=async()=>{await api('/logout',{});location.href='/';};
estado();cargar();setInterval(estado,5000);
</script></main></body></html>`;
}

server.listen(PORT, () => {
  console.log(`[mesa] lobby en http://localhost:${PORT}/  · código de invitación (para crear cuenta): ${INVITE}`);
  console.log(`[mesa] para alguien remoto: cloudflared tunnel --url http://localhost:${PORT}  · usuarios y mazos: bin/mesa-admin.mjs`);
});
process.on("SIGINT", () => { stopGame(); process.exit(0); });
process.on("SIGTERM", () => { stopGame(); process.exit(0); });
