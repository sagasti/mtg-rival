#!/usr/bin/env python3
"""Cliente de ejemplo para jugar contra el piloto de mtg-rival por la API HTTP (ver docs/API-BOT.md).

Uso: python3 bot-client.py "https://<host>/?t=<token>"      (el link que te da el lobby en modo bot)

Sin dependencias: urllib + json. Escucha el stream SSE /events, y por cada evento `decision` llama a decide(),
que devuelve la lista de ids de opción a mandar a /answer. Reemplazá decide() por tu bot: recibe el mismo
estado filtrado (sin información oculta) que ve nuestro piloto.
"""
import json, random, sys, time, urllib.request, urllib.parse, urllib.error

def decide(d):
    """d = {rid, kind, prompt, state, options:[{id,label,card,type}], min, max, cards, deadline?} -> [option ids]."""
    opts = d["options"]
    # Ejemplo tonto (acá va tu bot): baja tierra si puede, lanza algo al azar la mitad de las veces, ataca con todo,
    # no bloquea, y en el resto de las decisiones elige al azar dentro de min/max.
    kind = d["kind"]
    if kind == "priority":
        land = [o for o in opts if o["label"].startswith("play land")]
        if land:
            return [land[0]["id"]]
        plays = [o for o in opts if o["label"].startswith(("cast spell", "activate ability"))]
        if plays and random.random() < 0.5:
            return [random.choice(plays)["id"]]
    if kind == "attackers":
        return [o["id"] for o in opts][: d["max"]]
    if kind == "blockers":
        return []
    pas = [o for o in opts if o.get("type") == "pass" or o["label"] in ("Button: OK", "Button: Keep", "Button: Play")]
    if pas and d["min"] <= 1:
        return [pas[0]["id"]]
    n = random.randint(d["min"], min(d["max"], len(opts)))
    return [o["id"] for o in random.sample(opts, n)]

def main(url):
    u = urllib.parse.urlsplit(url); token = urllib.parse.parse_qs(u.query)["t"][0]
    base = f"{u.scheme}://{u.netloc}"; q = urllib.parse.urlencode({"t": token})
    answered = set()

    def answer(rid, choice):
        body = json.dumps({"rid": rid, "choice": choice}).encode()
        req = urllib.request.Request(f"{base}/answer?{q}", data=body, headers={"content-type": "application/json"}, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            return json.loads(e.read() or b"{}")

    def handle(d):
        if d["rid"] in answered:
            return
        choice = decide(d)
        r = answer(d["rid"], choice)
        answered.add(d["rid"])
        labels = [o["label"] for o in d["options"] if o["id"] in choice]
        print(f"[{d.get('state', {}).get('turn', '?')}] {d['kind']}: {labels or 'nada'} -> {r}", flush=True)

    while True:
        try:
            # Al (re)conectar el server reenvía la decisión pendiente, si hay.
            with urllib.request.urlopen(f"{base}/events?{q}", timeout=600) as stream:
                event, data = None, ""
                for raw in stream:
                    line = raw.decode("utf-8").rstrip("\n")
                    if line.startswith("event:"):
                        event = line[6:].strip()
                    elif line.startswith("data:"):
                        data += line[5:].strip()
                    elif line == "":
                        if event == "decision":
                            handle(json.loads(data))
                        elif event == "game":
                            print("partida:", data, flush=True)
                        elif event == "over":
                            print("match terminado:", data, flush=True)
                            return
                        event, data = None, ""
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            print("reconectando:", e, flush=True); time.sleep(2)

if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("uso: bot-client.py 'https://host/?t=token'")
    main(sys.argv[1])
