"""
Serveur Flask — API de controle du bot d'exploration.

Ce fichier expose une API REST sur le port 3002 qui permet au dashboard
de controler le bot (start/stop/pause/resume) et de recuperer son etat et ses logs.

Le bot (SmartExplorer) tourne dans un thread daemon separe du serveur Flask.
Un thread daemon est automatiquement arrete quand le processus principal s'arrete.

Architecture :
  Dashboard → Backend (proxy /api/bot) → Flask (port 3002) → SmartExplorer (thread)
"""

#!/usr/bin/env python3

import threading
from flask import Flask, jsonify, request
from flask_cors import CORS
from explorer import SmartExplorer

app = Flask(__name__)
# CORS necessaire car le backend Node.js fait des requetes cross-origin vers ce service
CORS(app)

# Instance unique du bot — partagee entre toutes les routes Flask
bot = SmartExplorer()
# Reference au thread du bot pour pouvoir le surveiller
bot_thread = None


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "service": "bot-python"})


@app.route("/bot/status", methods=["GET"])
def get_status():
    """Retourne l'etat complet du bot : position, energie, stats, frontiere, etc."""
    return jsonify(bot.get_status())


@app.route("/bot/logs", methods=["GET"])
def get_logs():
    """
    Recupere les logs du bot. Le parametre ?since= permet de ne recuperer
    que les logs apres un certain ID pour eviter de retelecharger tout l'historique.
    Le dashboard poll cet endpoint toutes les 2 secondes.
    """
    since = request.args.get("since", 0, type=int)
    logs = bot.get_logs(since)
    return jsonify({"logs": logs})


@app.route("/bot/logs", methods=["DELETE"])
def clear_logs():
    bot.clear_logs()
    return jsonify({"success": True, "message": "Logs effacés"})


@app.route("/bot/start", methods=["POST"])
def start_bot():
    """
    Demarre le bot d'exploration.

    1. Verifie que le bot n'est pas deja en cours
    2. Appelle bot.start() qui initialise la connexion API + charge les donnees MongoDB
    3. Lance la boucle d'exploration dans un thread daemon separe
       (daemon=True = le thread s'arrete automatiquement si Flask s'arrete)
    """
    global bot_thread

    if bot.running:
        return jsonify({"success": False, "message": "Bot déjà en cours d'exécution"})

    try:
        bot.start()

        if not bot.running:
            return jsonify({"success": False, "message": "Échec de l'initialisation"})

        # Le bot tourne dans son propre thread pour ne pas bloquer le serveur Flask
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
    """Arrete le bot. Le flag bot.running=False fait sortir la boucle run_loop()."""
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
    """
    Met le bot en pause. On met running=False ce qui fait sortir la boucle,
    mais on garde l'etat PAUSED pour pouvoir reprendre.
    """
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
    """
    Reprend le bot apres une pause.
    On relance un nouveau thread car l'ancien est sorti de sa boucle.
    """
    global bot_thread

    if bot.state != "PAUSED":
        return jsonify({"success": False, "message": "Bot non en pause"})

    bot.running = True
    bot.state = "EXPLORING"
    bot.log("Bot repris")

    # Nouveau thread necessaire car l'ancien a termine quand running est passe a False
    bot_thread = threading.Thread(target=bot.run_loop, daemon=True)
    bot_thread.start()

    return jsonify({
        "success": True,
        "message": "Bot repris",
        "status": bot.get_status()
    })


def main():
    print("=" * 50)
    print("KUZ Smart Explorer Bot - API Server")
    print("=" * 50)
    # host="0.0.0.0" = ecoute sur toutes les interfaces (necessaire en Docker)
    app.run(host="0.0.0.0", port=3002, debug=False)


if __name__ == "__main__":
    main()
