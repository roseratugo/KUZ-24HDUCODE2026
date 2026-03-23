import { Router } from 'express';

const router = Router();

const BOT_PYTHON_URL = process.env.BOT_PYTHON_URL || 'http://bot-python:3002';

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
