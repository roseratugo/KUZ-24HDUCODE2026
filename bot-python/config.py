"""
Configuration du bot d'exploration.

Toutes les constantes et URLs utilisees par le bot.
Les variables d'environnement permettent de configurer le bot
sans modifier le code (utile en Docker).
"""

import os
from dotenv import load_dotenv

load_dotenv()

# URL de l'API du jeu 3026 (serveur de l'organisateur sur AWS)
GAME_API = "http://ec2-15-237-116-133.eu-west-3.compute.amazonaws.com:8443"
# Token JWT d'authentification fourni par l'organisateur
CODINGGAME_ID = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJjb2RpbmdnYW1lIiwic3ViIjoiZTQ2MmE1ZWItOWQxNi00M2Q2LTg4MTYtMzc2N2MzMzZiZjczIiwicm9sZXMiOlsiVVNFUiJdfQ.i4gq-3ey6r0m1BOQjGTcjhvONZe9UXmPJo8ojcMf-7k"

# MongoDB : stocke les cellules explorees, iles, mouvements et positions
MONGO_URI = os.getenv("MONGO_URI", "mongodb://mongodb:27017/kuz")
# Identifiant de la partie en cours (permet d'isoler les donnees entre parties)
GAME_ID = os.getenv("GAME_ID", "kuz-default")

# URL de notre backend Node.js (pour notifier les positions et cellules en temps reel)
BACKEND_API = os.getenv("BACKEND_API", "http://backend:3001")

# --- Parametres de l'algorithme d'exploration ---

# Marge de securite en points d'energie : le bot garde toujours cette reserve
# pour pouvoir rentrer a la base meme en cas de detour imprevue
SAFETY_BUFFER = 5
# Delai entre chaque mouvement en secondes (1.0 = 1 mouvement par seconde)
TICK_INTERVAL = 1.0
# Seuil de recharge : le bot reprend l'exploration quand l'energie atteint
# ce pourcentage du maximum (0.8 = 80%)
RECHARGE_THRESHOLD = 0.8
