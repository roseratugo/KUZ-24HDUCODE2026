import express from 'express';
import Move from '../models/Move.js';

const router = express.Router();

router.get('/:gameId', async (req, res) => {
  try {
    const moves = await Move.find({ gameId: req.params.gameId })
      .sort({ timestamp: -1 })
      .limit(500);
    res.json(moves);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:gameId/recent/:limit', async (req, res) => {
  try {
    const limit = parseInt(req.params.limit) || 50;
    const moves = await Move.find({ gameId: req.params.gameId })
      .sort({ timestamp: -1 })
      .limit(limit);
    res.json(moves);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const moveData = {
      gameId: req.body.gameId,
      shipId: req.body.shipId,
      direction: req.body.direction,
      fromPosition: req.body.fromPosition,
      toPosition: req.body.toPosition,
      energyBefore: req.body.energyBefore,
      energyAfter: req.body.energyAfter,
      cellsDiscovered: req.body.cellsDiscovered || 0,
      timestamp: req.body.timestamp || new Date()
    };

    const move = new Move(moveData);
    await move.save();

    res.status(201).json(move);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:gameId/stats', async (req, res) => {
  try {
    const stats = await Move.aggregate([
      { $match: { gameId: req.params.gameId } },
      {
        $group: {
          _id: '$gameId',
          totalMoves: { $sum: 1 },
          totalCellsDiscovered: { $sum: '$cellsDiscovered' },
          directionCounts: {
            $push: '$direction'
          },
          firstMove: { $min: '$timestamp' },
          lastMove: { $max: '$timestamp' }
        }
      }
    ]);

    if (stats.length === 0) {
      return res.json({
        totalMoves: 0,
        totalCellsDiscovered: 0,
        directionCounts: {},
        firstMove: null,
        lastMove: null
      });
    }

    const directionCounts = {};
    stats[0].directionCounts.forEach(dir => {
      directionCounts[dir] = (directionCounts[dir] || 0) + 1;
    });

    res.json({
      totalMoves: stats[0].totalMoves,
      totalCellsDiscovered: stats[0].totalCellsDiscovered,
      directionCounts,
      firstMove: stats[0].firstMove,
      lastMove: stats[0].lastMove
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:gameId', async (req, res) => {
  try {
    const result = await Move.deleteMany({ gameId: req.params.gameId });
    res.json({ deleted: result.deletedCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
