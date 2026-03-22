import { Router } from 'express';

const router = Router();

// URL du bot Python (dans Docker, utilise le nom du service)
const BOT_PYTHON_URL = process.env.BOT_PYTHON_URL || 'http://bot-python:3002';

// Helper pour faire des requêtes vers le bot Python
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

// Start the bot
router.post('/start', async (req, res) => {
  try {
    const result = await proxyToBot('POST', '/bot/start');
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Stop the bot
router.post('/stop', async (req, res) => {
  try {
    const result = await proxyToBot('POST', '/bot/stop');
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Pause the bot
router.post('/pause', async (req, res) => {
  try {
    const result = await proxyToBot('POST', '/bot/pause');
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Resume the bot
router.post('/resume', async (req, res) => {
  try {
    const result = await proxyToBot('POST', '/bot/resume');
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get bot status
router.get('/status', async (req, res) => {
  try {
    const result = await proxyToBot('GET', '/bot/status');
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get bot logs
router.get('/logs', async (req, res) => {
  try {
    const since = req.query.since || 0;
    const result = await proxyToBot('GET', `/bot/logs?since=${since}`);
    res.json(result.logs || []);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Clear bot logs
router.delete('/logs', async (req, res) => {
  try {
    const result = await proxyToBot('DELETE', '/bot/logs');
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
