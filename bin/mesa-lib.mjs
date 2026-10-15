/**
 * Lo que comparten el lobby (bin/mesa.mjs) y la consola de admin (bin/mesa-admin.mjs):
 * base de cartas de Forge, parser de listas, usuarios (clave con scrypt, sesión = cookie firmada) y
 * mazos guardados por usuario. Todo vive en data/mesa/ (gitignoreado: claves, secreto y listas privadas).
 *   data/mesa/secret                 clave HMAC de las cookies (se genera sola, chmod 600)
 *   data/mesa/usuarios.json          { usuario: { nombre, salt, hash, creado } }
 *   data/mesa/mazos/<usuario>/<slug>.json  lista cruda + cartas parseadas; <slug>.dck = lo que lee Forge
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DATA = path.join(root, "data", "mesa");
export const RIVALES = { "red-madness": "Mono Red Madness", bogles: "Bogles", elves: "Elves", "blue-terror": "Mono Blue Terror", "grixis-control": "Grixis Control", "azorius-faeries": "Azorius Faeries" };
export const SEATS = { glm: "el piloto (GLM 5.3 + damage math)", flash: "el piloto caro (DeepSeek Flash razonando)", "forge-ai-1": "la IA de stock de Forge" };

// --- cartas -------------------------------------------------------------------------------------------------------
const db = JSON.parse(fs.readFileSync(path.join(root, "vendor/mtg-bench/data/cards.json"), "utf8"));
export const strip = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[’']/g, "'").trim();
export const slugify = (s, fallback = "x") => strip(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || fallback;
const byName = new Map();
for (const c of db) { byName.set(strip(c.name), c.name); const front = c.name.split(" // ")[0]; if (!byName.has(strip(front))) byName.set(strip(front), c.name); }
const BASICS = new Set(["Plains", "Island", "Swamp", "Mountain", "Forest", "Wastes", "Snow-Covered Plains", "Snow-Covered Island", "Snow-Covered Swamp", "Snow-Covered Mountain", "Snow-Covered Forest"]);

/** Lista en formato Goldfish/Arena/Moxfield ("4 Lightning Bolt", "4x ...", "(SET) 123", "*F*"); el sideboard se ignora. */
export function parseList(text) {
  const main = [], unknown = [], warnings = [];
  let side = false;
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^(sideboard|side|sb)\b/i.test(line)) { side = true; continue; }
    if (/^(deck|main|maindeck|mainboard|commander)\b:?$/i.test(line)) continue;
    if (/^\/\//.test(line) || /^#/.test(line)) continue;
    if (side) continue;
    const m = line.match(/^(\d+)\s*[xX]?\s+(.+?)(?:\s+\([A-Za-z0-9]{2,6}\)\s*\d*[a-z]?)?(?:\s+\*F\*)?$/);
    if (!m) { unknown.push(line); continue; }
    const n = Number(m[1]);
    const name = m[2].replace(/\s+\/\s+/, " // ").trim();
    const found = byName.get(strip(name)) ?? byName.get(strip(name.split(" // ")[0]));
    if (!found) { unknown.push(name); continue; }
    main.push({ n, name: found });
  }
  const merged = new Map();
  for (const { n, name } of main) merged.set(name, (merged.get(name) ?? 0) + n);
  const total = [...merged.values()].reduce((a, b) => a + b, 0);
  for (const [name, n] of merged) if (n > 4 && !BASICS.has(name)) warnings.push(`${name}: ${n} copias (más de 4)`);
  if (total < 60) warnings.push(`${total} cartas en el mazo principal (mínimo 60)`);
  return { cards: [...merged].map(([name, n]) => ({ name, n })), total, unknown, warnings, ok: unknown.length === 0 && total >= 60 };
}

// --- usuarios -----------------------------------------------------------------------------------------------------
const USERS = path.join(DATA, "usuarios.json");
export const USER_RE = /^[a-z0-9][a-z0-9_.-]{1,23}$/;
export const normUser = (u) => strip(u).replace(/\s+/g, "");
const loadUsers = () => { try { return JSON.parse(fs.readFileSync(USERS, "utf8")); } catch { return {}; } };
const saveUsers = (u) => { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(USERS, JSON.stringify(u, null, 2) + "\n", { mode: 0o600 }); };
const hashPw = (pw, salt) => crypto.scryptSync(String(pw), salt, 64).toString("hex");

export function listUsers() {
  return Object.entries(loadUsers()).map(([usuario, r]) => ({ usuario, nombre: r.nombre, creado: r.creado, mazos: listDecks(usuario).length }));
}
export function getUser(usuario) { return loadUsers()[normUser(usuario)] ?? null; }

export function createUser(usuario, clave, nombre) {
  const u = normUser(usuario);
  if (!USER_RE.test(u)) throw new Error("usuario inválido: de 2 a 24 caracteres, letras, números, punto, guion o guion bajo");
  if (String(clave ?? "").length < 6) throw new Error("la clave necesita al menos 6 caracteres");
  const users = loadUsers();
  if (users[u]) throw new Error("ese usuario ya existe");
  const salt = crypto.randomBytes(16).toString("hex");
  users[u] = { nombre: String(nombre ?? usuario).trim().slice(0, 40) || u, salt, hash: hashPw(clave, salt), creado: new Date().toISOString() };
  saveUsers(users);
  return u;
}
export function setPassword(usuario, clave) {
  const u = normUser(usuario); const users = loadUsers();
  if (!users[u]) throw new Error("ese usuario no existe");
  if (String(clave ?? "").length < 6) throw new Error("la clave necesita al menos 6 caracteres");
  users[u].salt = crypto.randomBytes(16).toString("hex"); users[u].hash = hashPw(clave, users[u].salt);
  saveUsers(users);
}
export function deleteUser(usuario) {
  const u = normUser(usuario); const users = loadUsers();
  if (!users[u]) throw new Error("ese usuario no existe");
  delete users[u]; saveUsers(users);
  fs.rmSync(deckDir(u), { recursive: true, force: true });
}
/** Devuelve el usuario normalizado si la clave es correcta, si no null. Mismo costo exista o no el usuario. */
export function verifyUser(usuario, clave) {
  const u = normUser(usuario); const r = loadUsers()[u];
  if (!r) { hashPw(clave, "0000"); return null; }
  const a = Buffer.from(hashPw(clave, r.salt), "hex"), b = Buffer.from(r.hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? u : null;
}

// --- sesiones: cookie "usuario.expira.firma" firmada con HMAC del secreto local ---------------------------------
const SECRET_FILE = path.join(DATA, "secret");
let secret = null;
function sessionSecret() {
  if (secret) return secret;
  try { secret = fs.readFileSync(SECRET_FILE, "utf8").trim(); if (secret.length >= 32) return secret; } catch {}
  fs.mkdirSync(DATA, { recursive: true });
  secret = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(SECRET_FILE, secret + "\n", { mode: 0o600 });
  return secret;
}
const sign = (s) => crypto.createHmac("sha256", sessionSecret()).update(s).digest("base64url");
export function makeSession(usuario, days = 30) { const p = `${usuario}.${Date.now() + days * 864e5}`; return `${p}.${sign(p)}`; }
export function readSession(token) {
  if (!token) return null;
  const [u, exp, sig] = String(token).split(".");
  if (!u || !exp || !sig) return null;
  const good = sign(`${u}.${exp}`);
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  if (Number(exp) < Date.now()) return null;
  return loadUsers()[u] ? u : null;
}

// --- mazos por usuario --------------------------------------------------------------------------------------------
const deckDir = (u) => path.join(DATA, "mazos", normUser(u));
const SLUG_RE = /^[a-z0-9-]{1,50}$/;
export function listDecks(usuario) {
  let files; try { files = fs.readdirSync(deckDir(usuario)); } catch { return []; }
  return files.filter((f) => f.endsWith(".json")).map((f) => {
    const d = JSON.parse(fs.readFileSync(path.join(deckDir(usuario), f), "utf8"));
    return { slug: d.slug, nombre: d.nombre, total: d.total, creado: d.creado, actualizado: d.actualizado };
  }).sort((a, b) => b.actualizado.localeCompare(a.actualizado));
}
export function getDeck(usuario, slug) {
  if (!SLUG_RE.test(String(slug))) return null;
  try { return JSON.parse(fs.readFileSync(path.join(deckDir(usuario), `${slug}.json`), "utf8")); } catch { return null; }
}
export const deckFile = (usuario, slug) => path.join(deckDir(usuario), `${slug}.dck`);

/** Guarda (slug vacío = nuevo, derivado del nombre) o actualiza (slug dado) un mazo. Exige lista válida. */
export function saveDeck(usuario, { nombre, lista, slug }) {
  const u = normUser(usuario);
  if (!getUser(u)) throw new Error("ese usuario no existe");
  nombre = String(nombre ?? "").trim().slice(0, 40);
  if (!nombre) throw new Error("el mazo necesita un nombre");
  const parsed = parseList(lista);
  if (!parsed.ok) { const e = new Error("la lista no está lista"); e.parsed = parsed; throw e; }
  const isNew = !slug;
  slug = isNew ? slugify(nombre, "mazo") : String(slug);
  if (!SLUG_RE.test(slug)) throw new Error("mazo inválido");
  const prev = getDeck(u, slug);
  if (isNew && prev) throw new Error(`ya tenés un mazo llamado "${prev.nombre}": editalo o elegí otro nombre`);
  if (!isNew && !prev) throw new Error("ese mazo no existe");
  const now = new Date().toISOString();
  const d = { slug, nombre, lista: String(lista), cards: parsed.cards, total: parsed.total, creado: prev?.creado ?? now, actualizado: now };
  fs.mkdirSync(deckDir(u), { recursive: true });
  fs.writeFileSync(path.join(deckDir(u), `${slug}.json`), JSON.stringify(d, null, 2) + "\n");
  const ascii = nombre.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7e]/g, "").trim();
  fs.writeFileSync(deckFile(u, slug), `[metadata]\nName=${ascii || slug}\n[Main]\n${parsed.cards.map((c) => `${c.n} ${c.name}`).join("\n")}\n`);
  return d;
}
export function deleteDeck(usuario, slug) {
  if (!getDeck(usuario, slug)) throw new Error("ese mazo no existe");
  for (const ext of ["json", "dck"]) fs.rmSync(path.join(deckDir(usuario), `${slug}.${ext}`), { force: true });
}
