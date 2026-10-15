#!/usr/bin/env node
/**
 * Consola de admin del lobby (usuarios y mazos en data/mesa/). No hace falta que el lobby esté corriendo.
 *   bin/mesa-admin.mjs usuarios
 *   bin/mesa-admin.mjs crear <usuario> [clave] [nombre]     sin clave: genera una y la imprime
 *   bin/mesa-admin.mjs clave <usuario> [clave]              resetea la clave
 *   bin/mesa-admin.mjs borrar-usuario <usuario>             borra la cuenta y sus mazos
 *   bin/mesa-admin.mjs mazos <usuario>
 *   bin/mesa-admin.mjs mazo <usuario> "<nombre>" <lista.txt|->   importa (o actualiza si ya existe uno con ese nombre)
 *   bin/mesa-admin.mjs ver <usuario> <slug>                 imprime la lista
 *   bin/mesa-admin.mjs borrar-mazo <usuario> <slug>
 */
import crypto from "node:crypto";
import fs from "node:fs";
import { listUsers, createUser, setPassword, deleteUser, listDecks, getDeck, saveDeck, deleteDeck, slugify, parseList } from "./mesa-lib.mjs";

const [cmd, ...a] = process.argv.slice(2);
const need = (n) => { if (a.length < n) { console.error("faltan argumentos; ver el encabezado de bin/mesa-admin.mjs"); process.exit(2); } };
try {
  switch (cmd) {
    case "usuarios": {
      const us = listUsers();
      if (!us.length) console.log("(no hay usuarios)");
      for (const u of us) console.log(`${u.usuario.padEnd(16)} ${String(u.mazos).padStart(2)} mazo(s)  creado ${u.creado.slice(0, 10)}  (${u.nombre})`);
      break;
    }
    case "crear": { need(1); const clave = a[1] || crypto.randomBytes(6).toString("base64url"); const u = createUser(a[0], clave, a[2]); console.log(`usuario ${u} creado${a[1] ? "" : ` · clave: ${clave}`}`); break; }
    case "clave": { need(1); const clave = a[1] || crypto.randomBytes(6).toString("base64url"); setPassword(a[0], clave); console.log(`clave de ${a[0]} cambiada${a[1] ? "" : `: ${clave}`}`); break; }
    case "borrar-usuario": { need(1); deleteUser(a[0]); console.log(`usuario ${a[0]} borrado (con sus mazos)`); break; }
    case "mazos": { need(1); const ds = listDecks(a[0]); if (!ds.length) console.log("(sin mazos)"); for (const d of ds) console.log(`${d.slug.padEnd(24)} ${String(d.total).padStart(3)} cartas  ${new Date(d.actualizado).toLocaleString("es-AR", { hour12: false }).replace(",", "")}  ${d.nombre}`); break; }
    case "mazo": {
      need(3);
      const lista = a[2] === "-" ? fs.readFileSync(0, "utf8") : fs.readFileSync(a[2], "utf8");
      const slug = slugify(a[1], "mazo");
      const existe = getDeck(a[0], slug);
      const p = parseList(lista);
      if (!p.ok) { console.error(`lista inválida: ${[...p.unknown.map((u) => `no reconozco "${u}"`), ...p.warnings].join("; ")}`); process.exit(1); }
      const d = saveDeck(a[0], { nombre: a[1], lista, slug: existe ? slug : undefined });
      console.log(`${existe ? "actualizado" : "guardado"} ${d.slug} (${d.total} cartas) para ${a[0]}`);
      break;
    }
    case "ver": { need(2); const d = getDeck(a[0], a[1]); if (!d) throw new Error("ese mazo no existe"); console.log(`# ${d.nombre} (${d.total}) · actualizado ${d.actualizado}`); for (const c of d.cards) console.log(`${c.n} ${c.name}`); break; }
    case "borrar-mazo": { need(2); deleteDeck(a[0], a[1]); console.log(`mazo ${a[1]} de ${a[0]} borrado`); break; }
    default: console.error(fs.readFileSync(new URL(import.meta.url), "utf8").split("*/")[0].split("\n").slice(1).map((l) => l.replace(/^ \* ?/, "")).join("\n")); process.exit(cmd ? 2 : 0);
  }
} catch (e) { console.error(`error: ${e.message}`); process.exit(1); }
