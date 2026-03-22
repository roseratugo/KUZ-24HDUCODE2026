import os
from dotenv import load_dotenv

load_dotenv()

# Game API
GAME_API = "http://ec2-15-237-116-133.eu-west-3.compute.amazonaws.com:8443"
CODINGGAME_ID = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJjb2RpbmdnYW1lIiwic3ViIjoiZTQ2MmE1ZWItOWQxNi00M2Q2LTg4MTYtMzc2N2MzMzZiZjczIiwicm9sZXMiOlsiVVNFUiJdfQ.i4gq-3ey6r0m1BOQjGTcjhvONZe9UXmPJo8ojcMf-7k"

# MongoDB
MONGO_URI = os.getenv("MONGO_URI", "mongodb://mongodb:27017/kuz")
GAME_ID = os.getenv("GAME_ID", "kuz-default")

# Backend API (for WebSocket broadcasts)
BACKEND_API = os.getenv("BACKEND_API", "http://backend:3001")

# Bot settings
SAFETY_BUFFER = 5  # Marge de sécurité en énergie
TICK_INTERVAL = 1.0  # Secondes entre chaque tick
RECHARGE_THRESHOLD = 0.8  # Reprendre exploration à 80% énergie
