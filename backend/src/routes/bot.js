import { Router } from 'express';
import bot from '../bot/explorerBot.js';

const router = Router();

// Start the bot
router.post('/start', async (req, res) => {
  try {
    const result = await bot.start();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Stop the bot
router.post('/stop', (req, res) => {
  const result = bot.stop();
  res.json(result);
});

// Pause the bot
router.post('/pause', (req, res) => {
  const result = bot.pause();
  res.json(result);
});

// Resume the bot
router.post('/resume', (req, res) => {
  const result = bot.resume();
  res.json(result);
});

// Get bot status
router.get('/status', (req, res) => {
  res.json(bot.getStatus());
});

// Get bot logs
router.get('/logs', (req, res) => {
  const since = parseInt(req.query.since) || 0;
  res.json(bot.getLogs(since));
});

// Clear bot logs
router.delete('/logs', (req, res) => {
  bot.clearLogs();
  res.json({ success: true });
});

export default router;
