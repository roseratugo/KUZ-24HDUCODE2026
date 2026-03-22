#!/usr/bin/env python3
"""
Bot d'exploration intelligent pour KUZ
API HTTP pour contrôler le bot depuis l'interface
"""

import threading
from flask import Flask, jsonify, request
from flask_cors import CORS
from explorer import SmartExplorer

app = Flask(__name__)
CORS(app)

# Instance unique du bot
bot = SmartExplorer()
bot_thread = None


@app.route("/health", methods=["GET"])
def health():
    """Health check"""
    return jsonify({"status": "ok", "service": "bot-python"})


@app.route("/bot/status", methods=["GET"])
def get_status():
    """Récupère le statut du bot"""
    return jsonify(bot.get_status())


@app.route("/bot/logs", methods=["GET"])
def get_logs():
    """Récupère les logs du bot"""
    since = request.args.get("since", 0, type=int)
    logs = bot.get_logs(since)
    return jsonify({"logs": logs})


@app.route("/bot/logs", methods=["DELETE"])
def clear_logs():
    """Efface les logs du bot"""
    bot.clear_logs()
    return jsonify({"success": True, "message": "Logs effacés"})


@app.route("/bot/start", methods=["POST"])
def start_bot():
    """Démarre le bot"""
    global bot_thread

    if bot.running:
        return jsonify({"success": False, "message": "Bot déjà en cours d'exécution"})

    try:
        # Initialiser et démarrer
        bot.start()

        if not bot.running:
            return jsonify({"success": False, "message": "Échec de l'initialisation"})

        # Lancer la boucle dans un thread séparé
        bot_thread = threading.Thread(target=bot.run_loop, daemon=True)
        bot_thread.start()

        return jsonify({
            "success": True,
            "message": f"Bot démarré en mode {bot.state}",
            "status": bot.get_status()
        })

    except Exception as e:
        return jsonify({"success": False, "message": str(e)})


@app.route("/bot/stop", methods=["POST"])
def stop_bot():
    """Arrête le bot"""
    global bot_thread

    if not bot.running:
        return jsonify({"success": False, "message": "Bot non démarré"})

    bot.stop()
    bot_thread = None

    return jsonify({
        "success": True,
        "message": "Bot arrêté",
        "status": bot.get_status()
    })


@app.route("/bot/pause", methods=["POST"])
def pause_bot():
    """Met le bot en pause (arrête temporairement)"""
    if not bot.running:
        return jsonify({"success": False, "message": "Bot non démarré"})

    bot.running = False
    bot.state = "PAUSED"
    bot.log("Bot en pause")

    return jsonify({
        "success": True,
        "message": "Bot en pause",
        "status": bot.get_status()
    })


@app.route("/bot/resume", methods=["POST"])
def resume_bot():
    """Reprend le bot après une pause"""
    global bot_thread

    if bot.state != "PAUSED":
        return jsonify({"success": False, "message": "Bot non en pause"})

    bot.running = True
    bot.state = "EXPLORING"
    bot.log("Bot repris")

    # Relancer la boucle
    bot_thread = threading.Thread(target=bot.run_loop, daemon=True)
    bot_thread.start()

    return jsonify({
        "success": True,
        "message": "Bot repris",
        "status": bot.get_status()
    })


def main():
    print("=" * 50)
    print("🚢 KUZ Smart Explorer Bot - API Server")
    print("=" * 50)
    print("Endpoints disponibles:")
    print("  GET  /health      - Health check")
    print("  GET  /bot/status  - Statut du bot")
    print("  GET  /bot/logs    - Logs du bot")
    print("  POST /bot/start   - Démarrer le bot")
    print("  POST /bot/stop    - Arrêter le bot")
    print("  POST /bot/pause   - Mettre en pause")
    print("  POST /bot/resume  - Reprendre")
    print("=" * 50)

    app.run(host="0.0.0.0", port=3002, debug=False)


if __name__ == "__main__":
    main()
