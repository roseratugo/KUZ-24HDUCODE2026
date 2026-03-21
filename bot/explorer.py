"""
Bot d'exploration serpentin.

Stratégie :
  1. Serpentin horizontal : balaye la map ligne par ligne (Est, descend, Ouest, descend, Est...)
     en espaçant les lignes de (2 * visibilityRange) pour ne pas scanner deux fois la même zone.
  2. Surveillance énergie : avant chaque mouvement, vérifie qu'il reste assez de points
     pour revenir à l'île KNOWN la plus proche (distance Chebyshev + buffer).
  3. Découverte d'île : dès qu'une île passe en DISCOVERED, le bot rentre immédiatement
     vers l'île KNOWN la plus proche pour la valider.
  4. Recharge : quand le bot est sur une île KNOWN, il attend que l'énergie remonte
     avant de repartir.
  5. Base de données : utilise MongoDB pour connaître toutes les cellules déjà explorées
     et optimiser le parcours (sauter les zones déjà couvertes).
"""

import time
import math
import requests
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
SAFETY_BUFFER = 2  # marge de sécurité en mouvements

HEADERS = {
    "Content-Type": "application/json",
    "codinggame-id": CODINGGAME_ID,
}

DIR_VECTORS = {
    "N":  (0, -1), "S":  (0, 1),  "E":  (1, 0),  "W":  (-1, 0),
    "NE": (1, -1), "NW": (-1, -1), "SE": (1, 1),  "SW": (-1, 1),
}


# ──────────────────────────── API ────────────────────────────

def api_get(path):
    r = requests.get(f"{GAME_API}{path}", headers=HEADERS, timeout=10)
    r.raise_for_status()
    return r.json()


def api_post(path, body=None):
    r = requests.post(f"{GAME_API}{path}", headers=HEADERS, json=body or {}, timeout=10)
    r.raise_for_status()
    return r.json()


def get_player_details():
    return api_get("/players/details")


def move_ship(direction):
    return api_post("/ship/move", {"direction": direction})


# ──────────────────────────── DB ────────────────────────────

class MapDB:
    def __init__(self):
        client = MongoClient(MONGO_URI)
        self.db = client[MONGO_DB]
        self.cells = self.db["cells"]
        self.islands = self.db["islands"]

    def get_known_cells(self):
        """Retourne un dict {(x,y): cell_doc} de toutes les cellules connues."""
        cells = {}
        for c in self.cells.find({"gameId": GAME_ID}):
            cells[(c["x"], c["y"])] = c
        return cells

    def get_sand_cells(self):
        """Retourne toutes les cellules SAND (îles) connues."""
        return list(self.cells.find({"gameId": GAME_ID, "type": "SAND"}))

    def get_known_island_cells(self):
        """Retourne les cellules SAND d'îles KNOWN."""
        known_ids = set()
        for isl in self.islands.find({"gameId": GAME_ID, "state": "KNOWN"}):
            known_ids.add(isl.get("islandId"))
        # Aussi les cellules SAND avec state KNOWN
        result = []
        for c in self.cells.find({"gameId": GAME_ID, "type": "SAND"}):
            if c.get("state") == "KNOWN":
                result.append(c)
            elif c.get("island", {}).get("id") in known_ids:
                result.append(c)
        return result

    def save_cells(self, cells):
        """Sauvegarde une liste de cellules (upsert)."""
        for c in cells:
            self.cells.update_one(
                {"gameId": GAME_ID, "x": c["x"], "y": c["y"]},
                {"$set": {
                    "gameId": GAME_ID,
                    "x": c["x"], "y": c["y"],
                    "type": c.get("type", "SEA"),
                    "zone": c.get("zone", 1),
                    "island": c.get("island"),
                    "state": c.get("state", "SEEN"),
                    "lastSeenAt": time.time(),
                }},
                upsert=True,
            )

    def is_cell_known(self, x, y):
        return self.cells.find_one({"gameId": GAME_ID, "x": x, "y": y}) is not None

    def get_bounds(self):
        """Retourne (min_x, max_x, min_y, max_y) des cellules connues."""
        pipeline = [
            {"$match": {"gameId": GAME_ID}},
            {"$group": {
                "_id": None,
                "min_x": {"$min": "$x"}, "max_x": {"$max": "$x"},
                "min_y": {"$min": "$y"}, "max_y": {"$max": "$y"},
            }}
        ]
        result = list(self.cells.aggregate(pipeline))
        if not result:
            return None
        r = result[0]
        return r["min_x"], r["max_x"], r["min_y"], r["max_y"]


# ──────────────────────────── HELPERS ────────────────────────────

def chebyshev(a, b):
    """Distance de Chebyshev entre deux points (tuples)."""
    return max(abs(a[0] - b[0]), abs(a[1] - b[1]))


def direction_to(frm, to):
    """Retourne la meilleure direction (str) pour aller de frm vers to."""
    dx = to[0] - frm[0]
    dy = to[1] - frm[1]
    d = ""
    if dy < 0:
        d += "N"
    elif dy > 0:
        d += "S"
    if dx > 0:
        d += "E"
    elif dx < 0:
        d += "W"
    return d or "N"


def nearest_known_island(pos, db):
    """Retourne (x, y) de la cellule d'île KNOWN la plus proche, ou None."""
    cells = db.get_known_island_cells()
    if not cells:
        # Fallback : toutes les SAND
        cells = db.get_sand_cells()
    if not cells:
        return None
    best = None
    best_dist = math.inf
    for c in cells:
        d = chebyshev(pos, (c["x"], c["y"]))
        if d < best_dist:
            best_dist = d
            best = (c["x"], c["y"])
    return best


# ──────────────────────────── BOT ────────────────────────────

class ExplorerBot:
    def __init__(self):
        self.db = MapDB()
        self.pos = None          # (x, y)
        self.pos_type = None     # SEA / SAND
        self.energy = 0
        self.max_energy = 0
        self.visibility = 1
        self.speed = 5000        # cooldown ms
        self.known_cells = {}    # cache local {(x,y): True}

        # Serpentin
        self.serpentin_dir = "E"  # direction horizontale courante
        self.serpentin_y = None   # ligne Y courante du serpentin
        self.returning = False    # mode retour vers île

    # ── Init ──

    def load_state(self):
        """Charge l'état depuis l'API et la DB."""
        details = get_player_details()
        ship = details["ship"]
        level = ship["level"]

        self.energy = ship["availableMove"]
        self.max_energy = level["maxMovement"]
        self.visibility = level["visibilityRange"]
        self.speed = level["speed"]

        # Position actuelle — on doit la déduire du dernier mouvement ou details
        # Le détails ne donnent pas la position directement, on la récupère de la DB
        ship_pos = self.db.db["shippositions"].find_one({"gameId": GAME_ID})
        if ship_pos:
            self.pos = (ship_pos["x"], ship_pos["y"])
            self.pos_type = ship_pos.get("type", "SEA")
        else:
            # Pas de position connue, on fait un mouvement initial
            self.pos = None
            self.pos_type = None

        # Charger le cache des cellules connues
        for c in self.db.cells.find({"gameId": GAME_ID}, {"x": 1, "y": 1}):
            self.known_cells[(c["x"], c["y"])] = True

        print(f"[INIT] Énergie: {self.energy}/{self.max_energy}")
        print(f"[INIT] Visibilité: {self.visibility}")
        print(f"[INIT] Cooldown: {self.speed}ms")
        print(f"[INIT] Position: {self.pos}")
        print(f"[INIT] Cellules connues en DB: {len(self.known_cells)}")

    # ── Movement ──

    def do_move(self, direction):
        """Exécute un mouvement et traite la réponse."""
        data = move_ship(direction)

        new_pos = data["position"]
        self.pos = (new_pos["x"], new_pos["y"])
        self.pos_type = new_pos.get("type", "SEA")
        self.energy = data["energy"]

        # Sauver la position
        self.db.db["shippositions"].update_one(
            {"gameId": GAME_ID},
            {"$set": {
                "gameId": GAME_ID,
                "x": self.pos[0], "y": self.pos[1],
                "type": self.pos_type,
                "zone": new_pos.get("zone"),
            }},
            upsert=True,
        )

        # Traiter les cellules découvertes
        discovered = data.get("discoveredCells", [])
        new_islands_found = False
        cells_to_save = []
        for cell in discovered:
            cx, cy = cell["x"], cell["y"]
            is_new = (cx, cy) not in self.known_cells
            self.known_cells[(cx, cy)] = True

            state = "KNOWN" if (cx, cy) == self.pos else "SEEN"
            cells_to_save.append({
                "x": cx, "y": cy,
                "type": cell.get("type", "SEA"),
                "zone": cell.get("zone", 1),
                "island": cell.get("island"),
                "state": state,
            })

            # Détection d'île
            if cell.get("type") == "SAND" and cell.get("island") and is_new:
                new_islands_found = True
                isl = cell["island"]
                self.db.islands.update_one(
                    {"gameId": GAME_ID, "islandId": isl["id"]},
                    {"$set": {
                        "gameId": GAME_ID,
                        "islandId": isl["id"],
                        "name": isl.get("name", ""),
                        "bonusQuotient": isl.get("bonusQuotient", 0),
                        "state": "DISCOVERED",
                    },
                    "$addToSet": {
                        "cells": {"x": cx, "y": cy}
                    }},
                    upsert=True,
                )

        if cells_to_save:
            self.db.save_cells(cells_to_save)

        new_count = sum(1 for c in discovered if (c["x"], c["y"]) not in self.known_cells or True)
        print(f"  → ({self.pos[0]}, {self.pos[1]}) ⚡{self.energy} | {len(discovered)} cellules vues")

        return new_islands_found

    def wait_cooldown(self):
        """Attend le cooldown entre les mouvements."""
        wait_sec = (self.speed + 200) / 1000.0
        time.sleep(wait_sec)

    # ── Safety ──

    def dist_to_nearest_known_island(self):
        """Distance Chebyshev vers l'île KNOWN la plus proche."""
        target = nearest_known_island(self.pos, self.db)
        if target is None:
            return math.inf, None
        return chebyshev(self.pos, target), target

    def can_afford_move(self):
        """Vérifie qu'on a assez d'énergie pour bouger ET revenir à une île."""
        dist, _ = self.dist_to_nearest_known_island()
        if dist == math.inf:
            # Pas d'île connue — on continue tant qu'on a de l'énergie
            return self.energy > 1
        # Il faut pouvoir : se déplacer (1) + revenir (dist+1 car on s'éloigne potentiellement) + buffer
        return self.energy > dist + 1 + SAFETY_BUFFER

    def should_return(self):
        """Vérifie si on doit rentrer (énergie critique)."""
        dist, _ = self.dist_to_nearest_known_island()
        if dist == math.inf:
            return False
        return self.energy <= dist + SAFETY_BUFFER

    # ── Navigation vers île ──

    def navigate_to_island(self):
        """Retourne vers l'île KNOWN la plus proche, pas à pas."""
        print("[NAV] Retour vers île KNOWN la plus proche...")
        while self.isRunning():
            dist, target = self.dist_to_nearest_known_island()
            if target is None:
                print("[NAV] ERREUR: aucune île KNOWN trouvée!")
                return False
            if self.pos == target or dist == 0:
                print(f"[NAV] Arrivé sur l'île à {self.pos}")
                return True

            direction = direction_to(self.pos, target)
            print(f"[NAV] → {direction} vers {target} (dist={dist}, ⚡{self.energy})")

            try:
                self.do_move(direction)
            except Exception as e:
                print(f"[NAV] Erreur mouvement {direction}: {e}")
                # Essayer une direction alternative
                alt = self.find_alternative_direction(direction)
                if alt:
                    try:
                        self.do_move(alt)
                    except Exception as e2:
                        print(f"[NAV] Erreur alt {alt}: {e2}")
                        return False
                else:
                    return False

            self.wait_cooldown()

        return False

    def find_alternative_direction(self, blocked_dir):
        """Trouve une direction alternative quand une direction est bloquée."""
        # Décomposer la direction souhaitée en composantes
        vec = DIR_VECTORS.get(blocked_dir, (0, 0))
        alternatives = []
        for d, v in DIR_VECTORS.items():
            if d == blocked_dir:
                continue
            # Préférer les directions qui vont dans le même sens général
            dot = vec[0] * v[0] + vec[1] * v[1]
            if dot > 0:
                alternatives.append((dot, d))
        alternatives.sort(reverse=True)
        for _, d in alternatives:
            return d
        return None

    # ── Recharge ──

    def wait_recharge(self):
        """Attend sur une île KNOWN que l'énergie remonte."""
        print(f"[RECHARGE] Sur île, énergie {self.energy}/{self.max_energy}")

        # On veut au moins 80% de l'énergie ou assez pour aller à la frontière
        target_energy = int(self.max_energy * 0.8)

        while self.energy < target_energy:
            time.sleep(3)
            details = get_player_details()
            self.energy = details["ship"]["availableMove"]
            print(f"[RECHARGE] ⚡{self.energy}/{self.max_energy}")

            if self.energy >= target_energy:
                break

        print(f"[RECHARGE] Prêt! ⚡{self.energy}")

    # ── Check DISCOVERED islands ──

    def has_discovered_islands(self):
        """Vérifie si on a des îles DISCOVERED à valider via l'API."""
        details = get_player_details()
        self.energy = details["ship"]["availableMove"]
        for isl in details.get("discoveredIslands", []):
            if isl.get("islandState") == "DISCOVERED":
                return True
        return False

    # ── Serpentin ──

    def compute_serpentin_target(self):
        """
        Calcule le prochain point cible du serpentin.
        Le serpentin balaye horizontalement en espaçant les lignes de (2 * visibility).
        Utilise la DB pour sauter les lignes déjà explorées.
        """
        step = max(1, 2 * self.visibility)  # espacement entre lignes

        if self.serpentin_y is None:
            self.serpentin_y = self.pos[1]

        # Direction horizontale courante
        if self.serpentin_dir == "E":
            # Vérifier s'il reste des cellules inconnues à l'Est sur cette ligne
            target_x = self.pos[0] + 1
            # Chercher la limite Est : aller jusqu'à ce qu'on ne connaisse plus rien
            # ou qu'on ait parcouru assez loin
            scan_range = self.max_energy * 2  # limite raisonnable
            has_unknown = False
            for dx in range(1, scan_range):
                test_x = self.pos[0] + dx
                if (test_x, self.serpentin_y) not in self.known_cells:
                    has_unknown = True
                    break

            if not has_unknown:
                # Toute la ligne est connue vers l'Est, descendre
                self.serpentin_y += step
                self.serpentin_dir = "W"
                return self.pos[0], self.serpentin_y  # aller à la nouvelle ligne
            else:
                return self.pos[0] + 1, self.serpentin_y  # continuer vers l'Est

        else:  # W
            has_unknown = False
            scan_range = self.max_energy * 2
            for dx in range(1, scan_range):
                test_x = self.pos[0] - dx
                if (test_x, self.serpentin_y) not in self.known_cells:
                    has_unknown = True
                    break

            if not has_unknown:
                self.serpentin_y += step
                self.serpentin_dir = "E"
                return self.pos[0], self.serpentin_y
            else:
                return self.pos[0] - 1, self.serpentin_y

    def isRunning(self):
        return True  # le bot ne s'arrête jamais

    # ── Main loop ──

    def run(self):
        """Boucle principale du bot."""
        print("=" * 60)
        print("  EXPLORATION BOT - Stratégie Serpentin")
        print("=" * 60)

        self.load_state()

        # Si pas de position, faire un mouvement initial
        if self.pos is None:
            print("[INIT] Pas de position, mouvement initial...")
            for d in ["E", "N", "S", "W", "NE", "SE", "NW", "SW"]:
                try:
                    self.do_move(d)
                    self.wait_cooldown()
                    break
                except Exception:
                    continue
            if self.pos is None:
                print("[FATAL] Impossible de bouger!")
                return

        # Initialiser le serpentin à la ligne courante
        self.serpentin_y = self.pos[1]

        print(f"\n[START] Position: {self.pos} | Énergie: {self.energy}/{self.max_energy}")
        print(f"[START] Visibilité: {self.visibility} | Espacement serpentin: {max(1, 2*self.visibility)}")
        print()

        tick = 0
        while self.isRunning():
            tick += 1

            # ── 1. Refresh énergie ──
            if tick % 5 == 0:
                details = get_player_details()
                self.energy = details["ship"]["availableMove"]

            # ── 2. Si on est sur une île : recharger si besoin ──
            if self.pos_type == "SAND":
                if self.energy < self.max_energy * 0.5:
                    self.wait_recharge()

            # ── 3. Vérifier s'il y a des îles DISCOVERED à valider ──
            if self.has_discovered_islands():
                print("[!] Île DISCOVERED détectée → retour pour validation!")
                self.returning = True

            # ── 4. Mode retour : naviguer vers île KNOWN ──
            if self.returning:
                success = self.navigate_to_island()
                if success:
                    self.returning = False
                    # Attendre que le serveur valide la découverte
                    time.sleep(2)
                    # Recharger avant de repartir
                    self.wait_recharge()
                    # Réinitialiser le serpentin depuis la nouvelle position
                    self.serpentin_y = self.pos[1]
                    print("[!] Découverte validée, reprise exploration")
                else:
                    print("[!] Impossible de retourner à l'île, retry...")
                    time.sleep(5)
                continue

            # ── 5. Vérifier énergie avant de bouger ──
            if self.should_return():
                print(f"[!] Énergie critique ({self.energy}) → retour île!")
                self.returning = True
                continue

            if not self.can_afford_move():
                print(f"[!] Pas assez d'énergie ({self.energy}) pour continuer")
                self.returning = True
                continue

            # ── 6. Calculer le prochain mouvement serpentin ──
            target = self.compute_serpentin_target()
            direction = direction_to(self.pos, target)

            print(f"[TICK {tick}] Serpentin → {direction} (cible: {target}, ligne Y={self.serpentin_y}, dir={self.serpentin_dir})")

            try:
                found_island = self.do_move(direction)
                if found_island:
                    print("[!] ★★★ NOUVELLE ÎLE DÉCOUVERTE ★★★")
                    # Vérifier si c'est une DISCOVERED (pas déjà KNOWN)
                    if self.has_discovered_islands():
                        print("[!] Île en DISCOVERED → retour pour validation!")
                        self.returning = True
            except requests.exceptions.HTTPError as e:
                status = e.response.status_code if e.response else 0
                body = e.response.text if e.response else ""
                print(f"[ERR] Mouvement {direction} échoué ({status}): {body}")

                # Si bloqué, ajuster le serpentin
                if self.serpentin_dir == "E":
                    # Peut pas aller plus à l'Est, descendre
                    self.serpentin_y += max(1, 2 * self.visibility)
                    self.serpentin_dir = "W"
                else:
                    self.serpentin_y += max(1, 2 * self.visibility)
                    self.serpentin_dir = "E"
                print(f"[ADJ] Serpentin ajusté → ligne Y={self.serpentin_y}, dir={self.serpentin_dir}")

            except Exception as e:
                print(f"[ERR] {e}")
                time.sleep(2)

            self.wait_cooldown()


# ──────────────────────────── MAIN ────────────────────────────

if __name__ == "__main__":
    bot = ExplorerBot()
    try:
        bot.run()
    except KeyboardInterrupt:
        print("\n[STOP] Bot arrêté par l'utilisateur")
    except Exception as e:
        print(f"\n[FATAL] {e}")
        import traceback
        traceback.print_exc()
