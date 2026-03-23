"""
SmartExplorer — Le cerveau du bot d'exploration.

Machine a etats avec 5 modes : IDLE, EXPLORING, RETURNING, RECHARGING, RESCUE.

Algorithme d'exploration base sur une frontiere :
- Les cellules explorees sont stockees dans un set pour un lookup O(1)
- La frontiere = cellules explorees ayant au moins un voisin inexplore
- A chaque tick, le bot choisit la meilleure cellule de la frontiere selon un score
  qui combine : distance, nombre de voisins inconnus, distance retour base

Gestion de l'energie :
- Le bot garde toujours SAFETY_BUFFER points de reserve
- Distance calculee en Chebyshev (max(|dx|, |dy|)) car le bateau bouge en 8 directions
- Quand l'energie est basse, retour a la base de recharge la plus proche

Double persistance : MongoDB (direct) + Backend (notification HTTP fire-and-forget)
"""

import time
from datetime import datetime
from typing import Optional, Tuple, Set, List
from api_client import GameAPIClient, BackendAPIClient
from database import Database
from config import SAFETY_BUFFER, TICK_INTERVAL, RECHARGE_THRESHOLD


class SmartExplorer:
    # Les 8 voisins d'une cellule (incluant les diagonales)
    # Utilise pour la detection de frontiere et le comptage de voisins inconnus
    NEIGHBORS = [
        (-1, -1), (0, -1), (1, -1),
        (-1, 0),          (1, 0),
        (-1, 1),  (0, 1),  (1, 1)
    ]

    MAX_LOGS = 500

    def __init__(self):
        self.api = GameAPIClient()
        self.db = Database()
        self.backend = BackendAPIClient()

        self.running = False
        self.state = "IDLE"

        self.position: Optional[dict] = None
        self.energy = 0
        self.max_energy = 100

        self.explored_cells: Set[Tuple[int, int]] = set()
        self.frontier_cells: Set[Tuple[int, int]] = set()
        self.known_bases: List[Tuple[int, int]] = []
        self.known_island_names: Set[str] = set()

        self.current_target: Optional[Tuple[int, int]] = None

        self.move_count = 0
        self.cells_discovered = 0
        self.islands_found: Set[str] = set()
        self.start_time: Optional[str] = None

        self.logs: List[dict] = []

    def log(self, message: str, level: str = "info"):
        timestamp = datetime.utcnow().isoformat()
        entry = {
            "id": len(self.logs),
            "timestamp": timestamp,
            "message": message,
            "type": level
        }
        self.logs.append(entry)

        if len(self.logs) > self.MAX_LOGS:
            self.logs.pop(0)

        prefix = {"info": "ℹ️", "success": "✅", "warn": "⚠️", "error": "❌"}.get(level, "")
        print(f"[{time.strftime('%H:%M:%S')}] {prefix} {message}")

    def get_logs(self, since: int = 0) -> List[dict]:
        return [log for log in self.logs if log["id"] >= since]

    def clear_logs(self):
        self.logs = []

    def chebyshev(self, a: Tuple[int, int], b: Tuple[int, int]) -> int:
        """
        Distance de Chebyshev = max(|dx|, |dy|).
        C'est la distance reelle en nombre de mouvements car le bateau
        peut se deplacer en diagonale (8 directions).
        Ex: (0,0) → (3,5) = 5 mouvements (pas 8 comme en Manhattan).
        """
        return max(abs(a[0] - b[0]), abs(a[1] - b[1]))

    def get_nearest_base(self) -> Optional[Tuple[int, int]]:
        if not self.known_bases or not self.position:
            return None

        pos = (self.position["x"], self.position["y"])
        nearest = None
        min_dist = float("inf")

        for base in self.known_bases:
            dist = self.chebyshev(pos, base)
            if dist < min_dist:
                min_dist = dist
                nearest = base

        return nearest

    def distance_to_nearest_base(self) -> float:
        nearest = self.get_nearest_base()
        if not nearest or not self.position:
            return float("inf")
        return self.chebyshev((self.position["x"], self.position["y"]), nearest)

    def direction_toward(self, target: Tuple[int, int]) -> str:
        if not self.position:
            return "N"

        dx = target[0] - self.position["x"]
        dy = target[1] - self.position["y"]

        direction = ""
        if dy < 0:
            direction += "N"
        if dy > 0:
            direction += "S"
        if dx > 0:
            direction += "E"
        if dx < 0:
            direction += "W"

        return direction or "N"

    def build_frontier_from_explored(self):
        """
        Reconstruit la frontiere a partir de zero.
        Appele au demarrage apres avoir charge les cellules explorees depuis MongoDB.
        Une cellule est en frontiere si elle a au moins un voisin qui n'est pas explore.
        """
        self.frontier_cells.clear()

        for (x, y) in self.explored_cells:
            for (dx, dy) in self.NEIGHBORS:
                neighbor = (x + dx, y + dy)
                if neighbor not in self.explored_cells:
                    self.frontier_cells.add((x, y))
                    break

        self.log(f"Frontière reconstruite: {len(self.frontier_cells)} cellules")

    def update_frontier(self, new_cells: list):
        """
        Met a jour incrementalement la frontiere apres avoir decouvert de nouvelles cellules.
        Plus efficace que de tout reconstruire : on ajoute les nouvelles cellules
        et on retire celles qui n'ont plus de voisins inconnus.
        """
        for cell in new_cells:
            coord = (cell["x"], cell["y"])
            self.explored_cells.add(coord)
            self.frontier_cells.discard(coord)

            has_unknown_neighbor = False
            for (dx, dy) in self.NEIGHBORS:
                neighbor = (coord[0] + dx, coord[1] + dy)
                if neighbor not in self.explored_cells:
                    has_unknown_neighbor = True
                    break

            if has_unknown_neighbor:
                self.frontier_cells.add(coord)

        to_remove = set()
        for frontier in self.frontier_cells:
            has_unknown = False
            for (dx, dy) in self.NEIGHBORS:
                neighbor = (frontier[0] + dx, frontier[1] + dy)
                if neighbor not in self.explored_cells:
                    has_unknown = True
                    break
            if not has_unknown:
                to_remove.add(frontier)

        self.frontier_cells -= to_remove

    def count_unknown_neighbors(self, cell: Tuple[int, int]) -> int:
        count = 0
        for (dx, dy) in self.NEIGHBORS:
            neighbor = (cell[0] + dx, cell[1] + dy)
            if neighbor not in self.explored_cells:
                count += 1
        return count

    def choose_best_frontier(self) -> Optional[Tuple[int, int]]:
        """
        Choisit la meilleure cellule de frontiere a explorer.

        Algorithme de scoring :
        1. Filtre les cellules inaccessibles (cout aller + retour base + marge > energie)
        2. Score chaque cellule restante :
           - +100/(distance+1)  : prefere les cellules proches (decroit vite avec la distance)
           - +15*voisins_inconnus : prefere les zones avec beaucoup de terrain inexplore
           - -0.5*distance_base  : penalise les cellules loin d'une base de recharge
        3. Trie par score decroissant, retourne la meilleure

        Retourne None si aucune cellule n'est atteignable en securite.
        """
        if not self.frontier_cells or not self.position:
            return None

        pos = (self.position["x"], self.position["y"])
        nearest_base = self.get_nearest_base()

        candidates = []

        for frontier in self.frontier_cells:
            dist_to_frontier = self.chebyshev(pos, frontier)

            if nearest_base:
                dist_to_base = self.chebyshev(frontier, nearest_base)
            else:
                dist_to_base = 0

            # Cout total = aller a la frontiere + revenir a la base + marge de securite
            # Si ce cout depasse l'energie, on ne peut pas y aller en securite
            total_cost = dist_to_frontier + dist_to_base + SAFETY_BUFFER

            if total_cost > self.energy:
                continue

            score = 0
            # Bonus proximite : 100 pour une cellule adjacente, 50 a 2 cases, 33 a 3 cases...
            score += 100 / (dist_to_frontier + 1)

            # Bonus decouverte : plus une cellule a de voisins inexplores, plus elle est interessante
            unknown_count = self.count_unknown_neighbors(frontier)
            score += unknown_count * 15

            # Penalite eloignement base : evite de s'aventurer trop loin
            if nearest_base:
                score -= dist_to_base * 0.5

            candidates.append((frontier, score, dist_to_frontier))

        if not candidates:
            return None

        candidates.sort(key=lambda x: x[1], reverse=True)
        best = candidates[0]
        self.log(f"Cible choisie: {best[0]} (score={best[1]:.1f}, dist={best[2]})")
        return best[0]

    def can_safely_explore(self) -> bool:
        dist_to_base = self.distance_to_nearest_base()
        if dist_to_base == float("inf"):
            return self.energy > SAFETY_BUFFER
        return self.energy > dist_to_base + SAFETY_BUFFER

    def should_return_to_base(self) -> bool:
        return not self.can_safely_explore()

    def _check_island_is_known(self, island_name: str) -> bool:
        try:
            details = self.api.get_player_details()
            for disc in details.get("discoveredIslands", []):
                if disc.get("island", {}).get("name") == island_name:
                    return disc.get("islandState") == "KNOWN"
            return False
        except Exception as e:
            self.log(f"Erreur vérification île: {e}", "warn")
            return False

    def refresh_known_islands(self):
        try:
            details = self.api.get_player_details()
            old_count = len(self.known_island_names)

            for disc in details.get("discoveredIslands", []):
                if disc.get("islandState") == "KNOWN":
                    island_name = disc.get("island", {}).get("name")
                    if island_name and island_name not in self.known_island_names:
                        self.known_island_names.add(island_name)
                        self.log(f"Île validée: {island_name}", "success")

            if len(self.known_island_names) > old_count:
                self.known_bases = self.db.load_known_bases()
                self.log(f"Bases de recharge mises à jour: {len(self.known_bases)}")

        except Exception as e:
            self.log(f"Erreur rafraîchissement îles: {e}", "warn")

    def _pay_due_taxes(self) -> bool:
        try:
            taxes = self.api.get_taxes()
            due_taxes = [t for t in taxes if t.get("state") == "DUE"]

            if not due_taxes:
                return False

            self.log(f"Taxes en attente détectées: {len(due_taxes)}", "warn")

            for tax in due_taxes:
                tax_id = tax.get("id")
                tax_type = tax.get("type", "UNKNOWN")
                amount = tax.get("amount", 0)
                message = tax.get("message", "")

                self.log(f"Paiement taxe {tax_type}: {message} - {amount} pièces", "warn")

                try:
                    self.api.pay_tax(tax_id)
                    self.log(f"Taxe {tax_type} payée!", "success")
                except Exception as e:
                    self.log(f"Échec paiement taxe: {e}", "error")
                    return False

            time.sleep(1)
            return True

        except Exception as e:
            self.log(f"Erreur vérification taxes: {e}", "warn")
            return False

    def _is_ship_in_distress_error(self, error: Exception) -> bool:
        error_msg = str(error).upper()
        distress_keywords = [
            "SHIP_IN_DISTRESS", "IMMOBILI", "MAELSTROM", "KRAKEN",
            "PIRATE", "PANNE", "RESCUE", "MORT", "DEAD", "SUNK"
        ]
        return any(keyword in error_msg for keyword in distress_keywords)

    def initialize(self) -> bool:
        self.log("Initialisation du bot...")

        try:
            if self._pay_due_taxes():
                self.log("Taxes payées au démarrage", "success")

            details = self.api.get_player_details()

            if not details.get("ship"):
                self.log("Pas de bateau! Construis un bateau d'abord.", "error")
                return False

            ship = details["ship"]
            self.energy = ship.get("availableMove", 0)
            self.max_energy = ship.get("level", {}).get("maxMovement", 100)

            self.known_island_names.clear()
            for disc in details.get("discoveredIslands", []):
                if disc.get("islandState") == "KNOWN":
                    island_name = disc.get("island", {}).get("name")
                    if island_name:
                        self.known_island_names.add(island_name)

            self.log(f"Énergie: {self.energy}/{self.max_energy}")
            self.log(f"Îles KNOWN: {len(self.known_island_names)}")

            if self.known_island_names:
                self.db.sync_known_islands(self.known_island_names)

            self.explored_cells = self.db.load_explored_cells()
            self.log(f"Cellules explorées chargées: {len(self.explored_cells)}")

            self.known_bases = self.db.load_known_bases()
            self.log(f"Bases de recharge: {len(self.known_bases)}")

            self.position = self.db.load_ship_position()
            if self.position:
                self.log(f"Position chargée: ({self.position['x']}, {self.position['y']})")
            else:
                self.log("Position inconnue, mouvement initial...")

                if self.energy <= 0:
                    self.log("Pas d'énergie, vérification des taxes...", "warn")
                    if self._pay_due_taxes():
                        details = self.api.get_player_details()
                        self.energy = details["ship"].get("availableMove", 0)
                        self.log(f"Énergie après paiement: {self.energy}")

                    if self.energy <= 0:
                        self.log("Toujours pas d'énergie après paiement!", "error")
                        return False

                try:
                    result = self.api.move_ship("N")
                except Exception as e:
                    if self._is_ship_in_distress_error(e):
                        self.log(f"Bateau en détresse: {e}", "warn")
                        if self._pay_due_taxes():
                            result = self.api.move_ship("N")
                        else:
                            raise
                    else:
                        raise

                self.position = result["position"]
                self.energy = result["energy"]
                self.move_count += 1
                self.db.save_ship_position(self.position)
                self.backend.notify_ship_position(self.position)

                if result.get("discoveredCells"):
                    self.db.save_cells(result["discoveredCells"])
                    self.update_frontier(result["discoveredCells"])
                    self.backend.notify_cells(result["discoveredCells"])

                self.log(f"Position initiale: ({self.position['x']}, {self.position['y']})")

            self.build_frontier_from_explored()

            return True

        except Exception as e:
            if self._is_ship_in_distress_error(e):
                self.log(f"Détresse détectée: {e}, tentative de récupération...", "warn")
                if self._pay_due_taxes():
                    return self.initialize()

            self.log(f"Erreur d'initialisation: {e}", "error")
            return False

    def do_move(self, direction: str) -> Optional[dict]:
        if not self.position:
            self.log("Position inconnue!", "error")
            return None

        from_pos = {
            "x": self.position["x"],
            "y": self.position["y"],
            "type": self.position.get("type"),
            "zone": self.position.get("zone")
        }
        energy_before = self.energy

        self.log(f"Mouvement {direction} depuis ({self.position['x']}, {self.position['y']})")

        try:
            result = self.api.move_ship(direction)
            self.move_count += 1

            self.position = result["position"]
            self.energy = result["energy"]

            self.db.save_ship_position(self.position)

            cells = result.get("discoveredCells", [])
            self.cells_discovered += len(cells)

            for cell in cells:
                island = cell.get("island")
                if island:
                    island_name = island.get("name")
                    if island_name and island_name not in self.islands_found:
                        self.islands_found.add(island_name)
                        self.db.save_island(island)

                        is_known = self._check_island_is_known(island_name)
                        status = "KNOWN" if is_known else "DISCOVERED"
                        self.log(f"Île {status}: {island_name}", "success")

                        if is_known:
                            self.known_island_names.add(island_name)

                    if cell.get("type") == "SAND" and island_name in self.known_island_names:
                        base = (cell["x"], cell["y"])
                        if base not in self.known_bases:
                            self.known_bases.append(base)
                            self.log(f"Nouvelle base de recharge: ({cell['x']}, {cell['y']})", "info")

            self.update_frontier(cells)

            self.db.save_cells(cells)
            self.db.save_move(
                direction, from_pos, self.position,
                energy_before, self.energy, len(cells)
            )

            self.backend.notify_ship_position(self.position)
            self.backend.notify_cells(cells)

            return result

        except Exception as e:
            if self._is_ship_in_distress_error(e):
                self.log(f"Bateau en détresse: {e}", "warn")
                self.state = "RESCUE"
                return None

            self.log(f"Erreur mouvement: {e}", "error")
            raise

    def handle_exploring(self):
        if self.should_return_to_base():
            nearest = self.get_nearest_base()
            if nearest:
                dist = self.chebyshev(
                    (self.position["x"], self.position["y"]),
                    nearest
                )
                if dist <= self.energy:
                    self.state = "RETURNING"
                    self.log(f"Énergie basse ({self.energy}), retour à la base", "warn")
                    return

            if self.energy <= 0:
                self.state = "RECHARGING"
                self.log("Plus d'énergie! Attente de remorquage...", "warn")
                return

        if not self.current_target:
            self.current_target = self.choose_best_frontier()

        if not self.current_target:
            self.log("Aucune frontière atteignable!", "warn")
            if self.known_bases:
                self.state = "RETURNING"
            return

        pos = (self.position["x"], self.position["y"])
        if pos == self.current_target:
            self.current_target = self.choose_best_frontier()
            if not self.current_target:
                return

        direction = self.direction_toward(self.current_target)
        self.do_move(direction)

    def handle_returning(self):
        nearest_base = self.get_nearest_base()

        if not nearest_base:
            self.log("Pas de base connue!", "error")
            self.state = "RECHARGING"
            return

        pos = (self.position["x"], self.position["y"])
        dist = self.chebyshev(pos, nearest_base)

        if dist == 0:
            self.state = "RECHARGING"
            self.log(f"Arrivé à la base ({pos[0]}, {pos[1]})", "success")
            return

        direction = self.direction_toward(nearest_base)
        self.do_move(direction)

        if self.position.get("type") == "SAND":
            self.state = "RECHARGING"
            self.log("Sur une île, recharge en cours...", "success")

    def handle_recharging(self):
        try:
            details = self.api.get_player_details()
            old_energy = self.energy
            self.energy = details["ship"].get("availableMove", self.energy)
            self.max_energy = details["ship"].get("level", {}).get("maxMovement", self.max_energy)

            old_known_count = len(self.known_island_names)
            for disc in details.get("discoveredIslands", []):
                if disc.get("islandState") == "KNOWN":
                    island_name = disc.get("island", {}).get("name")
                    if island_name and island_name not in self.known_island_names:
                        self.known_island_names.add(island_name)
                        self.log(f"Nouvelle île validée: {island_name}", "success")
                        self.db.sync_known_islands(self.known_island_names)

            if len(self.known_island_names) > old_known_count:
                self.known_bases = self.db.load_known_bases()
                self.log(f"Bases de recharge mises à jour: {len(self.known_bases)}", "info")
            elif not self.known_bases:
                self.known_bases = self.db.load_known_bases()

            if old_energy <= 0 and self.energy >= self.max_energy * 0.5:
                self.log("Énergie restaurée (remorquage?), récupération position...", "warn")
                result = self.api.move_ship("N")
                self.position = result["position"]
                self.energy = result["energy"]
                self.move_count += 1
                self.db.save_ship_position(self.position)
                self.backend.notify_ship_position(self.position)
                if result.get("discoveredCells"):
                    self.db.save_cells(result["discoveredCells"])
                    self.update_frontier(result["discoveredCells"])
                    self.backend.notify_cells(result["discoveredCells"])

            if self.energy >= self.max_energy * RECHARGE_THRESHOLD:
                self.state = "EXPLORING"
                self.current_target = None
                self.log(f"Rechargé! Énergie: {self.energy}/{self.max_energy}", "success")
            else:
                self.log(f"Recharge en cours... {self.energy}/{self.max_energy}")

        except Exception as e:
            self.log(f"Erreur recharge: {e}", "warn")

    def handle_rescue(self):
        try:
            taxes = self.api.get_taxes()
            due_taxes = [t for t in taxes if t.get("state") == "DUE"]

            if not due_taxes:
                self.log("Aucune taxe à payer, reprise de l'exploration", "success")
                self.state = "EXPLORING"
                self.current_target = None
                return

            for tax in due_taxes:
                tax_id = tax.get("id")
                tax_type = tax.get("type", "UNKNOWN")
                amount = tax.get("amount", 0)

                self.log(f"Paiement taxe {tax_type} (ID: {tax_id[:8]}...) - {amount} pièces", "warn")

                try:
                    self.api.pay_tax(tax_id)
                    self.log(f"Taxe {tax_type} payée!", "success")
                except Exception as e:
                    self.log(f"Échec paiement taxe: {e}", "error")
                    return

            self.log("Taxes payées, récupération de la position...", "info")
            time.sleep(1)

            try:
                result = self.api.move_ship("N")
                self.position = result["position"]
                self.energy = result["energy"]
                self.move_count += 1
                self.db.save_ship_position(self.position)
                self.backend.notify_ship_position(self.position)

                if result.get("discoveredCells"):
                    self.db.save_cells(result["discoveredCells"])
                    self.update_frontier(result["discoveredCells"])
                    self.backend.notify_cells(result["discoveredCells"])

                self.log(f"Position récupérée: ({self.position['x']}, {self.position['y']}), Énergie: {self.energy}", "success")

                if self.energy >= self.max_energy * RECHARGE_THRESHOLD:
                    self.state = "EXPLORING"
                    self.current_target = None
                else:
                    self.state = "RECHARGING"

            except Exception as e:
                self.log(f"Erreur après paiement: {e}", "error")
                time.sleep(2)

        except Exception as e:
            self.log(f"Erreur rescue: {e}", "error")

    def _check_for_rescue(self):
        try:
            taxes = self.api.get_taxes()
            due_taxes = [t for t in taxes if t.get("state") == "DUE"]
            if due_taxes:
                self.log(f"Taxes en attente détectées: {len(due_taxes)}", "warn")
                self.state = "RESCUE"
        except Exception:
            pass

    def tick(self):
        """
        Un tick = une action du bot selon son etat actuel.
        C'est le dispatch central de la machine a etats.
        Les erreurs sont gerees par type : detresse → RESCUE, rate limit → attendre,
        auth → stop, autre → verifier les taxes.
        """
        try:
            if self.state == "EXPLORING":
                self.handle_exploring()
            elif self.state == "RETURNING":
                self.handle_returning()
            elif self.state == "RECHARGING":
                self.handle_recharging()
            elif self.state == "RESCUE":
                self.handle_rescue()

        except Exception as e:
            error_msg = str(e).lower()

            if self._is_ship_in_distress_error(e):
                self.log(f"Bateau en détresse! Raison: {e}", "warn")
                self.state = "RESCUE"
            elif "too_fast" in error_msg or "trop rapide" in error_msg:
                self.log("Trop rapide, attente...", "warn")
            elif "401" in error_msg or "403" in error_msg:
                self.log("Erreur d'authentification!", "error")
                self.running = False
            else:
                self.log(f"Erreur: {e}", "error")
                self._check_for_rescue()

    def start(self):
        if self.running:
            self.log("Bot déjà en cours d'exécution", "warn")
            return

        if not self.initialize():
            self.log("Échec de l'initialisation", "error")
            return

        self.running = True
        self.start_time = datetime.utcnow().isoformat()

        if self.energy <= 0:
            self.state = "RECHARGING"
        elif not self.can_safely_explore():
            self.state = "RETURNING"
        else:
            self.state = "EXPLORING"

        self.log(f"Bot démarré en mode {self.state}", "success")

    def run_loop(self):
        """
        Boucle principale du bot — tourne dans un thread daemon.
        A chaque iteration : execute un tick (un mouvement ou une action),
        puis attend avant le prochain tick.
        En mode RECHARGING, on attend 5s car l'energie se regenere lentement.
        En mode EXPLORING, on attend TICK_INTERVAL (1s) pour explorer vite.
        """
        while self.running:
            self.tick()
            delay = 5.0 if self.state == "RECHARGING" else TICK_INTERVAL
            time.sleep(delay)

    def stop(self):
        self.running = False
        self.state = "IDLE"
        self.start_time = None
        self.log("Bot arrêté")

    def get_status(self) -> dict:
        uptime = 0
        if self.start_time:
            start = datetime.fromisoformat(self.start_time)
            uptime = int((datetime.utcnow() - start).total_seconds() * 1000)

        return {
            "running": self.running,
            "state": self.state,
            "position": self.position,
            "energy": self.energy,
            "maxEnergy": self.max_energy,
            "moveCount": self.move_count,
            "cellsDiscovered": self.cells_discovered,
            "exploredCount": len(self.explored_cells),
            "frontierCount": len(self.frontier_cells),
            "knownBases": len(self.known_bases),
            "islandsFound": len(self.islands_found),
            "currentTarget": self.current_target,
            "startTime": self.start_time,
            "uptime": uptime
        }
