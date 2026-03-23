from pymongo import MongoClient, UpdateOne
from config import MONGO_URI, GAME_ID
from datetime import datetime


class Database:
    def __init__(self):
        self.client = MongoClient(MONGO_URI)
        self.db = self.client.get_database()
        self.cells = self.db.cells
        self.islands = self.db.islands
        self.moves = self.db.moves
        self.ship_positions = self.db.shippositions

    def load_explored_cells(self) -> set:
        explored = set()
        cursor = self.cells.find(
            {"gameId": GAME_ID},
            {"x": 1, "y": 1, "_id": 0}
        )
        for cell in cursor:
            explored.add((cell["x"], cell["y"]))
        return explored

    def load_known_bases(self) -> list:
        bases = []

        known_islands = self.islands.find(
            {"gameId": GAME_ID, "state": "KNOWN"},
            {"name": 1, "islandId": 1, "_id": 0}
        )
        known_names = [island.get("name") for island in known_islands]

        if known_names:
            sand_cells = self.cells.find({
                "gameId": GAME_ID,
                "type": "SAND",
                "island.name": {"$in": known_names}
            })
            for cell in sand_cells:
                bases.append((cell["x"], cell["y"]))

        return bases

    def load_ship_position(self) -> dict:
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
        self.islands.update_many(
            {"gameId": GAME_ID, "name": {"$in": list(known_island_names)}},
            {"$set": {"state": "KNOWN"}}
        )

    def close(self):
        self.client.close()
