"""
Bot d'exploration serpentin avec serveur HTTP intégré.

Lancement : python explorer.py
  → Démarre un serveur HTTP sur le port 5001
  → Le bot est contrôlé via POST /start, POST /stop, GET /status, GET /logs
"""

import time
import math
import json
import threading
import traceback
from http.server import HTTPServer, BaseHTTPRequestHandler
import requests as http_requests
from pymongo import MongoClient

# ──────────────────────────── CONFIG ────────────────────────────

GAME_API = "http://ec2-15-237-116-133.eu-west-3.compute.amazonaws.com:8443"
CODINGGAME_ID = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJjb2RpbmdnYW1lIiwic3ViIjoiZTQ2MmE1ZWItOWQxNi00M2Q2LTg4MTYtMzc2N2MzMzZiZjczIiwicm9sZXMiOlsiVVNFUiJdfQ."
    "i4gq-3ey6r0m1BOQjGTcjhvONZe9UXmPJo8ojcMf-7k"
)
GAME_ID = "default"
MONGO_URI = "mongodb://localhost:27017"
MONGO_DB = "kuz3026"
SAFETY_BUFFER = 2
BOT_PORT = 5001

HEADERS = {
    "Content-Type": "application/json",
    "codinggame-id": CODINGGAME_ID,
}

DIR_VECTORS = {
    "N": (0, -1), "S": (0, 1), "E": (1, 0), "W": (-1, 0),
    "NE": (1, -1), "NW": (-1, -1), "SE": (1, 1), "SW": (-1, 1),
}


# ──────────────────────────── LOGS PARTAGÉS ────────────────────────────

class LogStore:
    def __init__(self, max_size=500):
        self.logs = []
        self.lock = threading.Lock()
        self.max_size = max_size
        self.counter = 0

    def add(self, message, level="info"):
        with self.lock:
            self.counter += 1
            entry = {
                "id": self.counter,
                "timestamp": time.strftime("%H:%M:%S"),
                "message": message,
                "type": level,
            }
            self.logs.append(entry)
            if len(self.logs) > self.max_size:
                self.logs = self.logs[-self.max_size:]
            # Aussi print dans le terminal
            prefix = {"info": "   ", "warn": "⚠️ ", "error": "❌ "}.get(level, "   ")
            print(f"[{entry['timestamp']}] {prefix}{message}")

    def get_since(self, since_id=0):
        with self.lock:
            return [l for l in self.logs if l["id"] > since_id]

    def clear(self):
        with self.lock:
            self.logs.clear()
            self.counter = 0


log_store = LogStore()


# ──────────────────────────── API GAME ────────────────────────────

def api_get(path):
    r = http_requests.get(f"{GAME_API}{path}", headers=HEADERS, timeout=10)
    r.raise_for_status()
    return r.json()


def api_post(path, body=None):
    r = http_requests.post(f"{GAME_API}{path}", headers=HEADERS, json=body or {}, timeout=10)
    r.raise_for_status()
    return r.json()


# ──────────────────────────── DB ────────────────────────────

class MapDB:
    def __init__(self):
        client = MongoClient(MONGO_URI)
        self.db = client[MONGO_DB]
        self.cells = self.db["cells"]
        self.islands = self.db["islands"]

    def get_known_cells_set(self):
        """Retourne un set de (x,y) de toutes les cellules connues."""
        return {(c["x"], c["y"]) for c in self.cells.find({"gameId": GAME_ID}, {"x": 1, "y": 1})}

    def get_known_island_cells(self):
        """Retourne les coordonnées des cellules SAND d'îles KNOWN."""
        known_ids = {isl["islandId"] for isl in self.islands.find({"gameId": GAME_ID, "state": "KNOWN"})}
        result = []
        for c in self.cells.find({"gameId": GAME_ID, "type": "SAND"}):
            if c.get("state") == "KNOWN" or c.get("island", {}).get("id") in known_ids:
                result.append((c["x"], c["y"]))
        return result

    def get_all_sand_cells(self):
        return [(c["x"], c["y"]) for c in self.cells.find({"gameId": GAME_ID, "type": "SAND"}, {"x": 1, "y": 1})]

    def save_cells(self, cells):
        for c in cells:
            self.cells.update_one(
                {"gameId": GAME_ID, "x": c["x"], "y": c["y"]},
                {"$set": {
                    "gameId": GAME_ID, "x": c["x"], "y": c["y"],
                    "type": c.get("type", "SEA"), "zone": c.get("zone", 1),
                    "island": c.get("island"), "state": c.get("state", "SEEN"),
                    "lastSeenAt": time.time(),
                }},
                upsert=True,
            )

    def save_island(self, island_data, cx, cy):
        self.islands.update_one(
            {"gameId": GAME_ID, "islandId": island_data["id"]},
            {"$set": {
                "gameId": GAME_ID, "islandId": island_data["id"],
                "name": island_data.get("name", ""), "bonusQuotient": island_data.get("bonusQuotient", 0),
                "state": "DISCOVERED",
            }, "$addToSet": {"cells": {"x": cx, "y": cy}}},
            upsert=True,
        )

    def save_position(self, x, y, cell_type, zone):
        self.db["shippositions"].update_one(
            {"gameId": GAME_ID},
            {"$set": {"gameId": GAME_ID, "x": x, "y": y, "type": cell_type, "zone": zone}},
            upsert=True,
        )


# ──────────────────────────── HELPERS ────────────────────────────

def chebyshev(a, b):
    return max(abs(a[0] - b[0]), abs(a[1] - b[1]))


def direction_to(frm, to):
    dx, dy = to[0] - frm[0], to[1] - frm[1]
    d = ""
    if dy < 0: d += "N"
    elif dy > 0: d += "S"
    if dx > 0: d += "E"
    elif dx < 0: d += "W"
    return d or "N"


def nearest_island_pos(pos, db):
    cells = db.get_known_island_cells()
    if not cells:
        cells = db.get_all_sand_cells()
    if not cells:
        return None
    return min(cells, key=lambda c: chebyshev(pos, c))


# ──────────────────────────── BOT ────────────────────────────

class ExplorerBot:
    def __init__(self):
        self.db = MapDB()
        self.running = False
        self.pos = None
        self.pos_type = None
        self.energy = 0
        self.max_energy = 0
        self.visibility = 1
        self.speed = 5000
        self.known_cells = set()
        self.serpentin_dir = "E"
        self.serpentin_y = None

    def log(self, msg, level="info"):
        log_store.add(msg, level)

    # ── Init ──

    def load_state(self):
        details = api_get("/players/details")
        ship = details["ship"]
        level = ship["level"]

        self.energy = ship["availableMove"]
        self.max_energy = level["maxMovement"]
        self.visibility = level["visibilityRange"]
        self.speed = level["speed"]

        # Position depuis la DB
        ship_pos = self.db.db["shippositions"].find_one({"gameId": GAME_ID})
        if ship_pos:
            self.pos = (ship_pos["x"], ship_pos["y"])
            self.pos_type = ship_pos.get("type", "SEA")

        self.known_cells = self.db.get_known_cells_set()

        self.log(f"Énergie: {self.energy}/{self.max_energy} | Vision: {self.visibility} | Cooldown: {self.speed}ms")
        self.log(f"Position: {self.pos} | Cellules connues: {len(self.known_cells)}")

    # ── Move ──

    def do_move(self, direction):
        data = api_post("/ship/move", {"direction": direction})
        new_pos = data["position"]
        self.pos = (new_pos["x"], new_pos["y"])
        self.pos_type = new_pos.get("type", "SEA")
        self.energy = data["energy"]

        self.db.save_position(self.pos[0], self.pos[1], self.pos_type, new_pos.get("zone"))

        discovered = data.get("discoveredCells", [])
        new_island = False
        cells_to_save = []

        for cell in discovered:
            cx, cy = cell["x"], cell["y"]
            is_new = (cx, cy) not in self.known_cells
            self.known_cells.add((cx, cy))

            state = "KNOWN" if (cx, cy) == self.pos else "SEEN"
            cells_to_save.append({
                "x": cx, "y": cy, "type": cell.get("type", "SEA"),
                "zone": cell.get("zone", 1), "island": cell.get("island"), "state": state,
            })

            if cell.get("type") == "SAND" and cell.get("island") and is_new:
                new_island = True
                self.db.save_island(cell["island"], cx, cy)

        if cells_to_save:
            self.db.save_cells(cells_to_save)

        new_count = sum(1 for c in discovered if True)
        self.log(f"→ {direction} ({self.pos[0]},{self.pos[1]}) ⚡{self.energy} | {new_count} cells")
        return new_island

    def wait_cooldown(self):
        time.sleep((self.speed + 200) / 1000.0)

    # ── Safety ──

    def dist_to_island(self):
        target = nearest_island_pos(self.pos, self.db)
        if target is None:
            return math.inf, None
        return chebyshev(self.pos, target), target

    def can_afford_move(self):
        dist, _ = self.dist_to_island()
        if dist == math.inf:
            return self.energy > 1
        return self.energy > dist + 1 + SAFETY_BUFFER

    def should_return(self):
        dist, _ = self.dist_to_island()
        if dist == math.inf:
            return False
        return self.energy <= dist + SAFETY_BUFFER

    # ── Navigation retour ──

    def navigate_to_island(self):
        self.log("↩️ Retour vers île KNOWN...", "warn")
        while self.running:
            dist, target = self.dist_to_island()
            if target is None:
                self.log("Aucune île trouvée!", "error")
                return False
            if self.pos == target or dist == 0:
                self.log(f"✅ Arrivé sur île ({self.pos[0]},{self.pos[1]})")
                return True

            direction = direction_to(self.pos, target)
            try:
                self.do_move(direction)
            except Exception as e:
                alt = self.alt_direction(direction)
                if alt:
                    try:
                        self.do_move(alt)
                    except Exception:
                        self.log(f"Bloqué en retour!", "error")
                        return False
                else:
                    return False
            self.wait_cooldown()
        return False

    def alt_direction(self, blocked):
        vec = DIR_VECTORS.get(blocked, (0, 0))
        best = None
        best_dot = -2
        for d, v in DIR_VECTORS.items():
            if d == blocked:
                continue
            dot = vec[0] * v[0] + vec[1] * v[1]
            if dot > best_dot:
                best_dot = dot
                best = d
        return best

    # ── Recharge ──

    def wait_recharge(self):
        target = int(self.max_energy * 0.8)
        self.log(f"🔋 Recharge... {self.energy}/{self.max_energy} (cible: {target})")

        while self.energy < target and self.running:
            time.sleep(3)
            details = api_get("/players/details")
            self.energy = details["ship"]["availableMove"]
            self.log(f"🔋 {self.energy}/{self.max_energy}")

        self.log(f"🔋 Rechargé! ⚡{self.energy}")

    # ── Check DISCOVERED ──

    def has_discovered_islands(self):
        details = api_get("/players/details")
        self.energy = details["ship"]["availableMove"]
        for isl in details.get("discoveredIslands", []):
            if isl.get("islandState") == "DISCOVERED":
                return True
        return False

    # ── Serpentin ──

    def next_serpentin_move(self):
        step = max(1, 2 * self.visibility)

        if self.serpentin_y is None:
            self.serpentin_y = self.pos[1]

        # Si le bot n'est pas sur la bonne ligne Y, d'abord y aller
        if self.pos[1] != self.serpentin_y:
            return direction_to(self.pos, (self.pos[0], self.serpentin_y))

        # Balayage horizontal
        if self.serpentin_dir == "E":
            scan = 50
            has_unknown = any(
                (self.pos[0] + dx, self.serpentin_y) not in self.known_cells
                for dx in range(1, scan)
            )
            if has_unknown:
                return "E"
            else:
                self.serpentin_y += step
                self.serpentin_dir = "W"
                self.log(f"🔄 Serpentin → ligne Y={self.serpentin_y}, dir=W")
                return direction_to(self.pos, (self.pos[0], self.serpentin_y))
        else:
            scan = 50
            has_unknown = any(
                (self.pos[0] - dx, self.serpentin_y) not in self.known_cells
                for dx in range(1, scan)
            )
            if has_unknown:
                return "W"
            else:
                self.serpentin_y += step
                self.serpentin_dir = "E"
                self.log(f"🔄 Serpentin → ligne Y={self.serpentin_y}, dir=E")
                return direction_to(self.pos, (self.pos[0], self.serpentin_y))

    # ── Main ──

    def run(self):
        self.running = True
        log_store.clear()
        self.log("🚀 Bot démarré — Stratégie Serpentin")

        try:
            self.load_state()
        except Exception as e:
            self.log(f"Erreur init: {e}", "error")
            self.running = False
            return

        # Mouvement initial si pas de position
        if self.pos is None:
            self.log("Pas de position, mouvement initial...")
            for d in ["E", "N", "S", "W"]:
                try:
                    self.do_move(d)
                    self.wait_cooldown()
                    break
                except Exception:
                    continue
            if self.pos is None:
                self.log("Impossible de bouger!", "error")
                self.running = False
                return

        self.serpentin_y = self.pos[1]
        self.log(f"📍 Départ ({self.pos[0]},{self.pos[1]}) | Espacement: {max(1, 2*self.visibility)}")

        returning = False
        tick = 0
        errors = 0

        while self.running:
            tick += 1

            try:
                # Refresh énergie périodique
                if tick % 5 == 0:
                    details = api_get("/players/details")
                    self.energy = details["ship"]["availableMove"]

                # Sur une île → recharger
                if self.pos_type == "SAND" and self.energy < self.max_energy * 0.5:
                    self.wait_recharge()
                    if not self.running:
                        break

                # Îles DISCOVERED à valider
                if not returning and self.has_discovered_islands():
                    self.log("🏝️ Île DISCOVERED → retour validation!", "warn")
                    returning = True

                # Énergie critique
                if not returning and self.should_return():
                    self.log(f"⚠️ Énergie critique ({self.energy}) → retour!", "warn")
                    returning = True

                if not returning and not self.can_afford_move():
                    self.log(f"⚠️ Énergie insuffisante ({self.energy}) → retour!", "warn")
                    returning = True

                # Mode retour
                if returning:
                    success = self.navigate_to_island()
                    if success:
                        returning = False
                        time.sleep(2)
                        self.wait_recharge()
                        self.serpentin_y = self.pos[1]
                        self.log("✅ Validation OK, reprise exploration")
                    else:
                        self.log("Échec retour, retry dans 5s...", "error")
                        time.sleep(5)
                    continue

                # Mouvement serpentin
                direction = self.next_serpentin_move()
                try:
                    found = self.do_move(direction)
                    errors = 0
                    if found:
                        self.log("🏝️ ★ NOUVELLE ÎLE DÉCOUVERTE ★", "warn")
                except http_requests.exceptions.HTTPError as e:
                    errors += 1
                    body = e.response.text if e.response else ""
                    self.log(f"Mouvement {direction} bloqué: {body[:100]}", "error")

                    # Ajuster serpentin
                    step = max(1, 2 * self.visibility)
                    self.serpentin_y += step
                    self.serpentin_dir = "E" if self.serpentin_dir == "W" else "W"
                    self.log(f"🔄 Ajusté → Y={self.serpentin_y}, dir={self.serpentin_dir}")

                    if errors >= 5:
                        self.log("Trop d'erreurs, pause 10s", "error")
                        errors = 0
                        time.sleep(10)

                self.wait_cooldown()

            except Exception as e:
                self.log(f"Erreur: {e}", "error")
                traceback.print_exc()
                time.sleep(2)

        self.log("⏹️ Bot arrêté")


# ──────────────────────────── HTTP SERVER ────────────────────────────

bot_instance = None
bot_thread = None


class BotHandler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, code, data):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self._cors()
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path == "/status":
            global bot_instance
            self._json(200, {
                "running": bot_instance is not None and bot_instance.running,
                "position": list(bot_instance.pos) if bot_instance and bot_instance.pos else None,
                "energy": bot_instance.energy if bot_instance else 0,
                "maxEnergy": bot_instance.max_energy if bot_instance else 0,
                "knownCells": len(bot_instance.known_cells) if bot_instance else 0,
            })

        elif self.path.startswith("/logs"):
            # /logs?since=42
            since = 0
            if "?" in self.path:
                params = dict(p.split("=") for p in self.path.split("?")[1].split("&") if "=" in p)
                since = int(params.get("since", 0))
            self._json(200, {"logs": log_store.get_since(since)})

        else:
            self._json(404, {"error": "not found"})

    def do_POST(self):
        global bot_instance, bot_thread

        if self.path == "/start":
            if bot_instance and bot_instance.running:
                self._json(200, {"status": "already_running"})
                return

            bot_instance = ExplorerBot()
            bot_thread = threading.Thread(target=bot_instance.run, daemon=True)
            bot_thread.start()
            self._json(200, {"status": "started"})

        elif self.path == "/stop":
            if bot_instance:
                bot_instance.running = False
            self._json(200, {"status": "stopped"})

        else:
            self._json(404, {"error": "not found"})

    def log_message(self, format, *args):
        pass  # Silence les logs HTTP


# ──────────────────────────── MAIN ────────────────────────────

if __name__ == "__main__":
    print(f"🤖 Bot server démarré sur http://localhost:{BOT_PORT}")
    print(f"   POST /start  → démarrer le bot")
    print(f"   POST /stop   → arrêter le bot")
    print(f"   GET  /status → état du bot")
    print(f"   GET  /logs   → logs récents")
    print()

    server = HTTPServer(("0.0.0.0", BOT_PORT), BotHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        if bot_instance:
            bot_instance.running = False
        print("\nServeur arrêté")
