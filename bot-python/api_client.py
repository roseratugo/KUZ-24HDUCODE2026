import requests
from config import GAME_API, CODINGGAME_ID


class GameAPIClient:
    """Client pour l'API du jeu"""

    def __init__(self):
        self.base_url = GAME_API
        self.headers = {
            "Content-Type": "application/json",
            "codinggame-id": CODINGGAME_ID
        }

    def _request(self, method: str, path: str, body: dict = None) -> dict:
        """Effectue une requête HTTP vers l'API"""
        url = f"{self.base_url}{path}"

        try:
            if method == "GET":
                response = requests.get(url, headers=self.headers)
            elif method == "POST":
                response = requests.post(url, headers=self.headers, json=body)
            else:
                raise ValueError(f"Méthode non supportée: {method}")

            response.raise_for_status()
            return response.json()

        except requests.exceptions.HTTPError as e:
            error_msg = f"API {response.status_code}"
            try:
                err_data = response.json()
                error_msg = err_data.get("message") or err_data.get("codeError") or error_msg
            except:
                pass
            raise Exception(error_msg) from e

        except requests.exceptions.RequestException as e:
            raise Exception(f"Erreur réseau: {str(e)}") from e

    def get_player_details(self) -> dict:
        """Récupère les détails du joueur (bateau, énergie, îles connues)"""
        return self._request("GET", "/players/details")

    def move_ship(self, direction: str) -> dict:
        """
        Déplace le bateau dans une direction.

        Directions valides: N, S, E, W, NE, NW, SE, SW

        Retourne:
        {
            "position": {"x": int, "y": int, "type": str, "zone": str},
            "energy": int,
            "discoveredCells": [{"x": int, "y": int, "type": str, "zone": str, "island": {...}?}]
        }
        """
        return self._request("POST", "/ship/move", {"direction": direction})

    def get_ship_position(self) -> dict:
        """Récupère la position actuelle du bateau (si disponible)"""
        try:
            return self._request("GET", "/ship/position")
        except:
            return None
