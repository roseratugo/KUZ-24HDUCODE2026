import requests
from config import GAME_API, CODINGGAME_ID, BACKEND_API, GAME_ID


class GameAPIClient:
    def __init__(self):
        self.base_url = GAME_API
        self.headers = {
            "Content-Type": "application/json",
            "codinggame-id": CODINGGAME_ID
        }

    def _request(self, method: str, path: str, body: dict = None) -> dict:
        url = f"{self.base_url}{path}"

        try:
            if method == "GET":
                response = requests.get(url, headers=self.headers)
            elif method == "POST":
                response = requests.post(url, headers=self.headers, json=body)
            elif method == "PUT":
                response = requests.put(url, headers=self.headers, json=body)
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
        return self._request("GET", "/players/details")

    def move_ship(self, direction: str) -> dict:
        return self._request("POST", "/ship/move", {"direction": direction})

    def get_ship_position(self) -> dict:
        try:
            return self._request("GET", "/ship/position")
        except:
            return None

    def get_taxes(self) -> list:
        return self._request("GET", "/taxes")

    def pay_tax(self, tax_id: str) -> dict:
        return self._request("PUT", f"/taxes/{tax_id}", {})


class BackendAPIClient:
    def __init__(self):
        self.base_url = BACKEND_API
        self.game_id = GAME_ID

    def notify_ship_position(self, position: dict):
        try:
            requests.put(
                f"{self.base_url}/api/ship-position/{self.game_id}",
                json={
                    "x": position["x"],
                    "y": position["y"],
                    "type": position.get("type"),
                    "zone": position.get("zone")
                },
                timeout=3
            )
        except Exception:
            pass

    def notify_cells(self, cells: list):
        if not cells:
            return
        try:
            requests.post(
                f"{self.base_url}/api/cells/bulk",
                json={
                    "gameId": self.game_id,
                    "cells": cells
                },
                timeout=3
            )
        except Exception:
            pass
