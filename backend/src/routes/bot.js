/**
 * Proxy vers le bot Python
 *
 * Le bot d'exploration tourne dans un container Docker separe (bot-python:3002).
 * Le dashboard (frontend) ne peut pas contacter le bot directement car il est
 * dans un reseau Docker interne.
 *
 * Ce fichier fait office de "proxy" : il recoit les requetes du dashboard
 * et les retransmet au bot Python, puis retourne la reponse.
 *
 * Dashboard → POST /api/bot/start → Backend → POST /bot/start → Bot Python
 *
 * Endpoints :
 * POST   /api/bot/start   → demarrer le bot
 * POST   /api/bot/stop    → arreter le bot
 * POST   /api/bot/pause   → mettre en pause
 * POST   /api/bot/resume  → reprendre
 * GET    /api/bot/status   → etat actuel du bot
 * GET    /api/bot/logs     → recuperer les logs
 * DELETE /api/bot/logs     → effacer les logs
 */

import { Router } from 'express';

const router = Router();

// URL interne du bot Python dans le reseau Docker
const BOT_PYTHON_URL = process.env.BOT_PYTHON_URL || 'http://bot-python:3002';

/**
 * Fonction utilitaire qui retransmet une requete HTTP vers le bot Python
 * @param {string} method - GET, POST, DELETE
 * @param {string} path   - chemin sur le bot (ex: /bot/start)
 * @param {object} body   - corps de la requete (optionnel)
 * @returns {object} reponse JSON du bot
 */
async function proxyToBot(method, path, body = null) {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${BOT_PYTHON_URL}${path}`, options);
  return response.json();
}

router.post('/start', async (req, res) => {
  try {
    const result = await proxyToBot('POST', '/bot/start');
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/stop', async (req, res) => {
  try {
    const result = await proxyToBot('POST', '/bot/stop');
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/pause', async (req, res) => {
  try {
    const result = await proxyToBot('POST', '/bot/pause');
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/resume', async (req, res) => {
  try {
    const result = await proxyToBot('POST', '/bot/resume');
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/status', async (req, res) => {
  try {
    const result = await proxyToBot('GET', '/bot/status');
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Le parametre ?since= permet de ne recuperer que les logs apres un certain timestamp
// pour eviter de retelecharger tout l'historique a chaque poll
router.get('/logs', async (req, res) => {
  try {
    const since = req.query.since || 0;
    const result = await proxyToBot('GET', `/bot/logs?since=${since}`);
    res.json(result.logs || []);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/logs', async (req, res) => {
  try {
    const result = await proxyToBot('DELETE', '/bot/logs');
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
