"""
Clients HTTP du bot — API du jeu + notre backend.

Deux classes distinctes pour deux APIs differentes :

1. GameAPIClient : appelle l'API EXTERNE du jeu 3026 (deplacer le bateau, infos joueur, taxes)
   → Source de verite pour l'etat du jeu
   → Authentification par token JWT dans le header "codinggame-id"

2. BackendAPIClient : notifie NOTRE backend Node.js (positions, cellules)
   → Permet aux frontends de recevoir les mises a jour en temps reel via WebSocket
   → Fire-and-forget : les erreurs sont ignorees (le bot ne doit pas crasher
     si le backend est down)
"""

import requests
from config import GAME_API, CODINGGAME_ID, BACKEND_API, GAME_ID


class GameAPIClient:
    """
    Client pour l'API du jeu 3026 (serveur de l'organisateur sur AWS).
    Toutes les actions du jeu passent par cette API : deplacements, infos joueur, taxes.
    """

    def __init__(self):
        self.base_url = GAME_API
        self.headers = {
            "Content-Type": "application/json",
            "codinggame-id": CODINGGAME_ID
        }

    def _request(self, method: str, path: str, body: dict = None) -> dict:
        """
        Methode generique pour les appels HTTP.
        Gere les erreurs HTTP en extrayant le message d'erreur du JSON de reponse
        (l'API du jeu renvoie des messages comme "SHIP_IN_DISTRESS" ou "TOO_FAST_TOO_FURIOUS").
        """
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

            # raise_for_status() leve une HTTPError si le status code est >= 400
            response.raise_for_status()
            return response.json()

        except requests.exceptions.HTTPError as e:
            # Extrait le message d'erreur du JSON de reponse pour un meilleur diagnostic
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
        """Infos du joueur : nom, or, bateau (energie, niveau), iles decouvertes"""
        return self._request("GET", "/players/details")

    def move_ship(self, direction: str) -> dict:
        """
        Deplace le bateau dans une direction (N, NE, E, SE, S, SW, W, NW).
        Retourne : position, energy, discoveredCells[]
        """
        return self._request("POST", "/ship/move", {"direction": direction})

    def get_ship_position(self) -> dict:
        """Position actuelle du bateau (peut echouer si le bateau n'est pas construit)"""
        try:
            return self._request("GET", "/ship/position")
        except:
            return None

    def get_taxes(self) -> list:
        """Liste des taxes (amendes) en attente — a payer pour debloquer le bateau"""
        return self._request("GET", "/taxes")

    def pay_tax(self, tax_id: str) -> dict:
        """Paie une taxe par son ID — necessaire quand le bateau est en detresse"""
        return self._request("PUT", f"/taxes/{tax_id}", {})


class BackendAPIClient:
    """
    Client pour notre backend Node.js (port 3001).

    Envoie des notifications "fire-and-forget" pour que les frontends
    recoivent les mises a jour en temps reel via WebSocket.

    Les erreurs sont silencieusement ignorees (except: pass) car :
    - Le bot doit continuer a explorer meme si le backend est down
    - Les donnees sont aussi persistees directement en MongoDB
    - Le timeout court (3s) evite de bloquer le bot
    """

    def __init__(self):
        self.base_url = BACKEND_API
        self.game_id = GAME_ID

    def notify_ship_position(self, position: dict):
        """
        Notifie le backend de la nouvelle position du bateau.
        Le backend fera un broadcast WebSocket "ship:position" aux frontends.
        """
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
        """
        Envoie les cellules decouvertes au backend (bulk upsert).
        Le backend fera un broadcast WebSocket "cells:update" aux frontends.
        """
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
