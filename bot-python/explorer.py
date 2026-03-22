import time
from datetime import datetime
from typing import Optional, Tuple, Set, List
from api_client import GameAPIClient
from database import Database
from config import SAFETY_BUFFER, TICK_INTERVAL, RECHARGE_THRESHOLD


class SmartExplorer:
    """Bot d'exploration intelligent avec gestion de l'énergie"""

    # 8 directions de voisinage
    NEIGHBORS = [
        (-1, -1), (0, -1), (1, -1),
        (-1, 0),          (1, 0),
        (-1, 1),  (0, 1),  (1, 1)
    ]

    MAX_LOGS = 500

    def __init__(self):
        self.api = GameAPIClient()
        self.db = Database()

        # État du bot
        self.running = False
        self.state = "IDLE"  # IDLE, EXPLORING, RETURNING, RECHARGING

        # Position et énergie
        self.position: Optional[dict] = None
        self.energy = 0
        self.max_energy = 100

        # Données d'exploration
        self.explored_cells: Set[Tuple[int, int]] = set()
        self.frontier_cells: Set[Tuple[int, int]] = set()
        self.known_bases: List[Tuple[int, int]] = []
        self.known_island_names: Set[str] = set()

        # Cible actuelle
        self.current_target: Optional[Tuple[int, int]] = None

        # Stats
        self.move_count = 0
        self.cells_discovered = 0
        self.islands_found: Set[str] = set()
        self.start_time: Optional[str] = None

        # Logs stockés
        self.logs: List[dict] = []

    def log(self, message: str, level: str = "info"):
        """Log un message et le stocke"""
        timestamp = datetime.utcnow().isoformat()
        entry = {
            "id": len(self.logs),
            "timestamp": timestamp,
            "message": message,
            "type": level
        }
        self.logs.append(entry)

        # Limiter le nombre de logs
        if len(self.logs) > self.MAX_LOGS:
            self.logs.pop(0)

        # Afficher dans la console
        prefix = {"info": "ℹ️", "success": "✅", "warn": "⚠️", "error": "❌"}.get(level, "")
        print(f"[{time.strftime('%H:%M:%S')}] {prefix} {message}")

    def get_logs(self, since: int = 0) -> List[dict]:
        """Récupère les logs depuis un certain ID"""
        return [log for log in self.logs if log["id"] >= since]

    def clear_logs(self):
        """Efface tous les logs"""
        self.logs = []

    # ========================
    # DISTANCE & NAVIGATION
    # ========================

    def chebyshev(self, a: Tuple[int, int], b: Tuple[int, int]) -> int:
        """Distance de Chebyshev (diagonale = 1)"""
        return max(abs(a[0] - b[0]), abs(a[1] - b[1]))

    def get_nearest_base(self) -> Optional[Tuple[int, int]]:
        """Trouve la base KNOWN la plus proche"""
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

    def distance_to_nearest_base(self) -> int:
        """Distance vers la base la plus proche"""
        nearest = self.get_nearest_base()
        if not nearest or not self.position:
            return float("inf")
        return self.chebyshev((self.position["x"], self.position["y"]), nearest)

    def direction_toward(self, target: Tuple[int, int]) -> str:
        """Calcule la direction vers une cible"""
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

    # ========================
    # GESTION DES FRONTIÈRES
    # ========================

    def build_frontier_from_explored(self):
        """Reconstruit la frontière à partir des cellules explorées"""
        self.frontier_cells.clear()

        for (x, y) in self.explored_cells:
            for (dx, dy) in self.NEIGHBORS:
                neighbor = (x + dx, y + dy)
                if neighbor not in self.explored_cells:
                    # Cette cellule explorée a un voisin inconnu → frontière
                    self.frontier_cells.add((x, y))
                    break

        self.log(f"Frontière reconstruite: {len(self.frontier_cells)} cellules")

    def update_frontier(self, new_cells: list):
        """Met à jour la frontière après découverte de nouvelles cellules"""
        for cell in new_cells:
            coord = (cell["x"], cell["y"])
            self.explored_cells.add(coord)
            self.frontier_cells.discard(coord)  # Plus une frontière

            # Les voisins non explorés font de cette cellule une potentielle frontière
            has_unknown_neighbor = False
            for (dx, dy) in self.NEIGHBORS:
                neighbor = (coord[0] + dx, coord[1] + dy)
                if neighbor not in self.explored_cells:
                    has_unknown_neighbor = True
                    break

            if has_unknown_neighbor:
                self.frontier_cells.add(coord)

        # Nettoyer les anciennes frontières qui n'en sont plus
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
        """Compte le nombre de voisins inconnus d'une cellule"""
        count = 0
        for (dx, dy) in self.NEIGHBORS:
            neighbor = (cell[0] + dx, cell[1] + dy)
            if neighbor not in self.explored_cells:
                count += 1
        return count

    # ========================
    # CHOIX DE LA CIBLE
    # ========================

    def choose_best_frontier(self) -> Optional[Tuple[int, int]]:
        """Choisit la meilleure frontière atteignable"""
        if not self.frontier_cells or not self.position:
            return None

        pos = (self.position["x"], self.position["y"])
        nearest_base = self.get_nearest_base()

        candidates = []

        for frontier in self.frontier_cells:
            dist_to_frontier = self.chebyshev(pos, frontier)

            # Distance de la frontière vers la base la plus proche (pour le retour)
            if nearest_base:
                dist_to_base = self.chebyshev(frontier, nearest_base)
            else:
                dist_to_base = 0  # Pas de base connue, on explore quand même

            total_cost = dist_to_frontier + dist_to_base + SAFETY_BUFFER

            # Vérifie si on a assez d'énergie
            if total_cost > self.energy:
                continue

            # Calcul du score
            score = 0

            # 1. Favorise les frontières PROCHES
            score += 100 / (dist_to_frontier + 1)

            # 2. Favorise les frontières avec beaucoup de voisins inconnus
            unknown_count = self.count_unknown_neighbors(frontier)
            score += unknown_count * 15

            # 3. Pénalise légèrement les frontières loin de la base
            if nearest_base:
                score -= dist_to_base * 0.5

            candidates.append((frontier, score, dist_to_frontier))

        if not candidates:
            return None

        # Trie par score décroissant
        candidates.sort(key=lambda x: x[1], reverse=True)
        best = candidates[0]
        self.log(f"Cible choisie: {best[0]} (score={best[1]:.1f}, dist={best[2]})")
        return best[0]

    # ========================
    # GESTION DE L'ÉNERGIE
    # ========================

    def can_safely_explore(self) -> bool:
        """Vérifie si on peut explorer en sécurité"""
        dist_to_base = self.distance_to_nearest_base()
        if dist_to_base == float("inf"):
            # Pas de base connue, on explore tant qu'on a de l'énergie
            return self.energy > SAFETY_BUFFER
        return self.energy > dist_to_base + SAFETY_BUFFER

    def should_return_to_base(self) -> bool:
        """Vérifie si on doit retourner à la base"""
        return not self.can_safely_explore()

    # ========================
    # INITIALISATION
    # ========================

    def initialize(self) -> bool:
        """Initialise le bot avec les données existantes"""
        self.log("Initialisation du bot...")

        try:
            # 1. Récupérer les détails du joueur
            details = self.api.get_player_details()

            if not details.get("ship"):
                self.log("Pas de bateau! Construis un bateau d'abord.", "error")
                return False

            # Stats du bateau
            ship = details["ship"]
            self.energy = ship.get("availableMove", 0)
            self.max_energy = ship.get("level", {}).get("maxMovement", 100)

            # Îles connues depuis l'API
            self.known_island_names.clear()
            for disc in details.get("discoveredIslands", []):
                if disc.get("islandState") == "KNOWN":
                    island_name = disc.get("island", {}).get("name")
                    if island_name:
                        self.known_island_names.add(island_name)

            self.log(f"Énergie: {self.energy}/{self.max_energy}")
            self.log(f"Îles KNOWN: {len(self.known_island_names)}")

            # 2. Synchroniser les îles en DB
            if self.known_island_names:
                self.db.sync_known_islands(self.known_island_names)

            # 3. Charger les cellules explorées depuis MongoDB
            self.explored_cells = self.db.load_explored_cells()
            self.log(f"Cellules explorées chargées: {len(self.explored_cells)}")

            # 4. Charger les bases KNOWN
            self.known_bases = self.db.load_known_bases()
            self.log(f"Bases de recharge: {len(self.known_bases)}")

            # 5. Charger la position depuis MongoDB
            self.position = self.db.load_ship_position()
            if self.position:
                self.log(f"Position chargée: ({self.position['x']}, {self.position['y']})")
            else:
                # Faire un mouvement initial pour découvrir la position
                self.log("Position inconnue, mouvement initial...")
                if self.energy <= 0:
                    self.log("Pas d'énergie pour le mouvement initial!", "error")
                    return False

                result = self.api.move_ship("N")
                self.position = result["position"]
                self.energy = result["energy"]
                self.move_count += 1
                self.db.save_ship_position(self.position)

                if result.get("discoveredCells"):
                    self.db.save_cells(result["discoveredCells"])
                    self.update_frontier(result["discoveredCells"])

                self.log(f"Position initiale: ({self.position['x']}, {self.position['y']})")

            # 6. Construire la frontière
            self.build_frontier_from_explored()

            return True

        except Exception as e:
            self.log(f"Erreur d'initialisation: {e}", "error")
            return False

    # ========================
    # MOUVEMENT
    # ========================

    def do_move(self, direction: str) -> Optional[dict]:
        """Effectue un mouvement"""
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

            # Mise à jour position et énergie
            self.position = result["position"]
            self.energy = result["energy"]

            # Sauvegarder la position
            self.db.save_ship_position(self.position)

            # Traiter les cellules découvertes
            cells = result.get("discoveredCells", [])
            self.cells_discovered += len(cells)

            for cell in cells:
                island = cell.get("island")
                if island:
                    island_name = island.get("name")
                    if island_name and island_name not in self.islands_found:
                        self.islands_found.add(island_name)
                        is_known = island_name in self.known_island_names
                        status = "KNOWN" if is_known else "DISCOVERED"
                        self.log(f"Île {status}: {island_name}", "success")
                        self.db.save_island(island)

                        # Si l'île est KNOWN, ajouter ses cellules SAND comme bases
                        if is_known and cell.get("type") == "SAND":
                            base = (cell["x"], cell["y"])
                            if base not in self.known_bases:
                                self.known_bases.append(base)

            # Mettre à jour la frontière
            self.update_frontier(cells)

            # Sauvegarder en DB
            self.db.save_cells(cells)
            self.db.save_move(
                direction, from_pos, self.position,
                energy_before, self.energy, len(cells)
            )

            return result

        except Exception as e:
            self.log(f"Erreur mouvement: {e}", "error")
            raise

    # ========================
    # ÉTATS DU BOT
    # ========================

    def handle_exploring(self):
        """Gère l'état EXPLORING"""
        # Vérifier si on doit rentrer
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

            # Pas de base accessible
            if self.energy <= 0:
                self.state = "RECHARGING"
                self.log("Plus d'énergie! Attente de remorquage...", "warn")
                return

        # Choisir une cible si nécessaire
        if not self.current_target:
            self.current_target = self.choose_best_frontier()

        if not self.current_target:
            self.log("Aucune frontière atteignable!", "warn")
            # Essayer de retourner à la base
            if self.known_bases:
                self.state = "RETURNING"
            return

        # Se déplacer vers la cible
        pos = (self.position["x"], self.position["y"])
        if pos == self.current_target:
            # Arrivé à la cible, en choisir une nouvelle
            self.current_target = self.choose_best_frontier()
            if not self.current_target:
                return

        direction = self.direction_toward(self.current_target)
        self.do_move(direction)

    def handle_returning(self):
        """Gère l'état RETURNING (retour à la base)"""
        nearest_base = self.get_nearest_base()

        if not nearest_base:
            self.log("Pas de base connue!", "error")
            self.state = "RECHARGING"
            return

        pos = (self.position["x"], self.position["y"])
        dist = self.chebyshev(pos, nearest_base)

        # Arrivé à la base
        if dist == 0:
            self.state = "RECHARGING"
            self.log(f"Arrivé à la base ({pos[0]}, {pos[1]})", "success")
            return

        # Se déplacer vers la base
        direction = self.direction_toward(nearest_base)
        self.do_move(direction)

        # Vérifier si on est sur du SAND
        if self.position.get("type") == "SAND":
            self.state = "RECHARGING"
            self.log("Sur une île, recharge en cours...", "success")

    def handle_recharging(self):
        """Gère l'état RECHARGING"""
        try:
            # Récupérer les détails pour voir l'énergie actuelle
            details = self.api.get_player_details()
            old_energy = self.energy
            self.energy = details["ship"].get("availableMove", self.energy)
            self.max_energy = details["ship"].get("level", {}).get("maxMovement", self.max_energy)

            # Mettre à jour les îles KNOWN
            for disc in details.get("discoveredIslands", []):
                if disc.get("islandState") == "KNOWN":
                    island_name = disc.get("island", {}).get("name")
                    if island_name and island_name not in self.known_island_names:
                        self.known_island_names.add(island_name)
                        self.log(f"Nouvelle île validée: {island_name}", "success")

            # Recharger les bases
            self.known_bases = self.db.load_known_bases()

            # Si énergie restaurée subitement (remorquage)
            if old_energy <= 0 and self.energy >= self.max_energy * 0.5:
                self.log("Énergie restaurée (remorquage?), récupération position...", "warn")
                result = self.api.move_ship("N")
                self.position = result["position"]
                self.energy = result["energy"]
                self.move_count += 1
                self.db.save_ship_position(self.position)
                if result.get("discoveredCells"):
                    self.db.save_cells(result["discoveredCells"])
                    self.update_frontier(result["discoveredCells"])

            # Vérifier si rechargé
            if self.energy >= self.max_energy * RECHARGE_THRESHOLD:
                self.state = "EXPLORING"
                self.current_target = None  # Reset la cible
                self.log(f"Rechargé! Énergie: {self.energy}/{self.max_energy}", "success")
            else:
                self.log(f"Recharge en cours... {self.energy}/{self.max_energy}")

        except Exception as e:
            self.log(f"Erreur recharge: {e}", "warn")

    # ========================
    # BOUCLE PRINCIPALE
    # ========================

    def tick(self):
        """Exécute un tick du bot"""
        try:
            if self.state == "EXPLORING":
                self.handle_exploring()
            elif self.state == "RETURNING":
                self.handle_returning()
            elif self.state == "RECHARGING":
                self.handle_recharging()

        except Exception as e:
            error_msg = str(e).lower()

            if "immobili" in error_msg or "panne" in error_msg or "rescue" in error_msg:
                self.log("Bateau immobilisé! Attente remorquage...", "warn")
                self.state = "RECHARGING"
            elif "too_fast" in error_msg or "trop rapide" in error_msg:
                self.log("Trop rapide, attente...", "warn")
            elif "401" in error_msg or "403" in error_msg:
                self.log("Erreur d'authentification!", "error")
                self.running = False
            else:
                self.log(f"Erreur: {e}", "error")

    def start(self):
        """Démarre le bot"""
        if self.running:
            self.log("Bot déjà en cours d'exécution", "warn")
            return

        if not self.initialize():
            self.log("Échec de l'initialisation", "error")
            return

        self.running = True
        self.start_time = datetime.utcnow().isoformat()

        # Déterminer l'état initial
        if self.energy <= 0:
            self.state = "RECHARGING"
        elif not self.can_safely_explore():
            self.state = "RETURNING"
        else:
            self.state = "EXPLORING"

        self.log(f"Bot démarré en mode {self.state}", "success")

    def run_loop(self):
        """Boucle principale (appelée dans un thread séparé)"""
        while self.running:
            self.tick()

            # Délai entre les ticks
            delay = 5.0 if self.state == "RECHARGING" else TICK_INTERVAL
            time.sleep(delay)

    def stop(self):
        """Arrête le bot"""
        self.running = False
        self.state = "IDLE"
        self.start_time = None
        self.log("Bot arrêté")

    def get_status(self) -> dict:
        """Retourne le statut du bot"""
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
