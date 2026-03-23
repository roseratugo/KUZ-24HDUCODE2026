"""
Acces direct a MongoDB via PyMongo.

Le bot persiste toutes ses donnees en MongoDB pour :
1. Reprendre l'exploration apres un redemarrage (cellules explorees, position)
2. Alimenter les frontends via le backend (qui lit la meme base)
3. Garder un historique complet des mouvements

Collections utilisees :
- cells         : toutes les cellules decouvertes (SEA, SAND)
- islands       : iles decouvertes avec leur etat (DISCOVERED/KNOWN)
- moves         : historique de chaque deplacement du bateau
- shippositions : position actuelle du bateau (un seul document, upsert)

Le bulk_write pour les cellules utilise le meme pattern que le backend Node.js :
- $set met a jour les champs a chaque passage (type, zone, lastSeenAt)
- $setOnInsert cree les champs initiaux seulement au premier insert (gameId, discoveredAt)
- upsert=True cree le document s'il n'existe pas
"""

from pymongo import MongoClient, UpdateOne
from config import MONGO_URI, GAME_ID
from datetime import datetime


class Database:
    def __init__(self):
        self.client = MongoClient(MONGO_URI)
        # get_database() retourne la base specifiee dans l'URI (ex: "kuz" dans mongodb://...27017/kuz)
        self.db = self.client.get_database()
        self.cells = self.db.cells
        self.islands = self.db.islands
        self.moves = self.db.moves
        self.ship_positions = self.db.shippositions

    def load_explored_cells(self) -> set:
        """
        Charge toutes les coordonnees des cellules deja explorees.
        Retourne un set de tuples (x, y) pour des lookups O(1).
        On ne charge que x et y (projection) pour minimiser la memoire.
        """
        explored = set()
        cursor = self.cells.find(
            {"gameId": GAME_ID},
            {"x": 1, "y": 1, "_id": 0}  # Projection : seulement x et y
        )
        for cell in cursor:
            explored.add((cell["x"], cell["y"]))
        return explored

    def load_known_bases(self) -> list:
        """
        Charge les bases de recharge = cellules SAND des iles KNOWN.

        Dans le jeu, l'energie du bateau se regenere quand il est sur une ile validee (KNOWN).
        On recupere d'abord les noms des iles KNOWN, puis on cherche toutes les cellules SAND
        qui appartiennent a ces iles. Chaque cellule SAND est une base de recharge potentielle.
        """
        bases = []

        # Etape 1 : recuperer les noms des iles validees
        known_islands = self.islands.find(
            {"gameId": GAME_ID, "state": "KNOWN"},
            {"name": 1, "islandId": 1, "_id": 0}
        )
        known_names = [island.get("name") for island in known_islands]

        if known_names:
            # Etape 2 : trouver les cellules SAND de ces iles
            # $in : le nom de l'ile de la cellule est dans la liste des iles KNOWN
            sand_cells = self.cells.find({
                "gameId": GAME_ID,
                "type": "SAND",
                "island.name": {"$in": known_names}
            })
            for cell in sand_cells:
                bases.append((cell["x"], cell["y"]))

        return bases

    def load_ship_position(self) -> dict:
        """Charge la derniere position connue du bateau (un seul document par partie)."""
        pos = self.ship_positions.find_one({"gameId": GAME_ID})
        if pos:
            return {
                "x": pos["x"],
                "y": pos["y"],
                "type": pos.get("type"),
                "zone": pos.get("zone")
            }
        return None

    def save_ship_position(self, position: dict):
        """
        Sauvegarde la position du bateau (upsert : cree ou met a jour).
        Un seul document par partie grace au filtre sur gameId.
        """
        self.ship_positions.update_one(
            {"gameId": GAME_ID},
            {"$set": {
                "x": position["x"],
                "y": position["y"],
                "type": position.get("type"),
                "zone": position.get("zone")
            }},
            upsert=True
        )

    def save_cells(self, cells: list):
        """
        Sauvegarde les cellules decouvertes en masse (bulk upsert).

        Meme pattern que le backend Node.js :
        - Une seule requete MongoDB pour N cellules (bulk_write)
        - upsert=True : cree si n'existe pas, met a jour sinon
        - $set : champs mis a jour a chaque passage
        - $setOnInsert : champs crees seulement au premier insert
        """
        if not cells:
            return

        operations = []
        for cell in cells:
            operations.append(UpdateOne(
                {"gameId": GAME_ID, "x": cell["x"], "y": cell["y"]},
                {
                    "$set": {
                        "type": cell["type"],
                        "zone": cell.get("zone"),
                        "island": cell.get("island"),
                        "state": "SEEN",
                        "lastSeenAt": datetime.utcnow()
                    },
                    "$setOnInsert": {
                        "gameId": GAME_ID,
                        "discoveredAt": datetime.utcnow()
                    }
                },
                upsert=True
            ))

        if operations:
            self.cells.bulk_write(operations)

    def save_island(self, island: dict):
        """Sauvegarde une ile decouverte (upsert sur gameId + islandId)."""
        self.islands.update_one(
            {"gameId": GAME_ID, "islandId": island.get("id")},
            {
                "$set": {
                    "name": island.get("name"),
                    "bonusQuotient": island.get("bonusQuotient", 0)
                },
                "$setOnInsert": {
                    "gameId": GAME_ID,
                    "islandId": island.get("id"),
                    "state": "DISCOVERED",
                    "discoveredAt": datetime.utcnow()
                }
            },
            upsert=True
        )

    def save_move(self, direction: str, from_pos: dict, to_pos: dict,
                  energy_before: int, energy_after: int, cells_count: int):
        """Enregistre un deplacement dans l'historique (insert simple, pas d'upsert)."""
        self.moves.insert_one({
            "gameId": GAME_ID,
            "direction": direction,
            "fromPosition": from_pos,
            "toPosition": to_pos,
            "energyBefore": energy_before,
            "energyAfter": energy_after,
            "cellsDiscovered": cells_count,
            "timestamp": datetime.utcnow()
        })

    def sync_known_islands(self, known_island_names: set):
        """
        Met a jour l'etat des iles validees (DISCOVERED → KNOWN).
        Appele quand l'API du joueur confirme qu'une ile est KNOWN.
        $in : met a jour toutes les iles dont le nom est dans le set.
        """
        self.islands.update_many(
            {"gameId": GAME_ID, "name": {"$in": list(known_island_names)}},
            {"$set": {"state": "KNOWN"}}
        )

    def close(self):
        self.client.close()
