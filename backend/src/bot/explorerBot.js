import Cell from '../models/Cell.js';
import Island from '../models/Island.js';
import Move from '../models/Move.js';
import { broadcast } from '../ws.js';

const GAME_API = 'http://ec2-15-237-116-133.eu-west-3.compute.amazonaws.com:8443';
const CODINGGAME_ID = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJjb2RpbmdnYW1lIiwic3ViIjoiZTQ2MmE1ZWItOWQxNi00M2Q2LTg4MTYtMzc2N2MzMzZiZjczIiwicm9sZXMiOlsiVVNFUiJdfQ.i4gq-3ey6r0m1BOQjGTcjhvONZe9UXmPJo8ojcMf-7k';
const GAME_ID = process.env.GAME_ID || 'kuz-default';
const SAFETY_BUFFER = 3;

class ExplorerBot {
  constructor() {
    this.running = false;
    this.paused = false;
    this.state = 'IDLE';
    this.position = null;
    this.energy = 0;
    this.maxEnergy = 15;
    this.speed = 5000;
    this.visibilityRange = 1;

    // Known island cells where we can recharge
    this.knownIslandCells = [];
    this.homeIslandCells = [];
    this.startPosition = null;

    // Exploration tracking
    this.visitedPositions = new Set();
    this.discoveredCellsCount = 0;
    this.islandsFound = 0;
    this.moveCount = 0;

    // Spiral state
    this.spiralDirections = ['E', 'S', 'W', 'N'];
    this.spiralDirIndex = 0;
    this.spiralLeg = 1;
    this.spiralStepsDone = 0;
    this.spiralLegsCompleted = 0;

    // Logs
    this.logs = [];
    this.maxLogs = 500;

    this.timer = null;
    this.startTime = null;
  }

  // --- Logging ---
  log(message, type = 'info') {
    const entry = {
      id: this.logs.length,
      timestamp: new Date().toISOString(),
      message,
      type
    };
    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) this.logs.shift();
    console.log(`[Bot:${type}] ${message}`);

    // Broadcast to frontend via WebSocket
    broadcast('bot:log', entry);
  }

  // --- Game API calls ---
  async apiCall(method, path, body = null) {
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'codinggame-id': CODINGGAME_ID
      }
    };
    if (body) options.body = JSON.stringify(body);

    const res = await fetch(`${GAME_API}${path}`, options);
    if (!res.ok) {
      let errorMsg = `API ${method} ${path} failed (${res.status})`;
      try {
        const errData = await res.json();
        errorMsg += `: ${errData.message || JSON.stringify(errData)}`;
      } catch { /* ignore parse errors */ }
      throw new Error(errorMsg);
    }
    return res.json();
  }

  async getPlayerDetails() {
    return this.apiCall('GET', '/players/details');
  }

  async moveShip(direction) {
    return this.apiCall('POST', '/ship/move', { direction });
  }

  // --- Distance & Navigation ---

  // Chebyshev distance (diagonal moves cost 1)
  chebyshev(a, b) {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  }

  // Find nearest known island cell
  findNearestRechargePoint() {
    const allRecharge = [...this.homeIslandCells, ...this.knownIslandCells];
    if (allRecharge.length === 0 && this.startPosition) {
      return this.startPosition;
    }

    let nearest = null;
    let minDist = Infinity;
    for (const cell of allRecharge) {
      const dist = this.chebyshev(this.position, cell);
      if (dist < minDist) {
        minDist = dist;
        nearest = cell;
      }
    }
    return nearest;
  }

  distanceToNearestRecharge() {
    const nearest = this.findNearestRechargePoint();
    if (!nearest) return Infinity;
    return this.chebyshev(this.position, nearest);
  }

  // Get best direction to move toward a target
  directionToward(target) {
    const dx = target.x - this.position.x;
    const dy = target.y - this.position.y;

    // Map dx/dy to direction string
    let dirY = '';
    let dirX = '';
    if (dy < 0) dirY = 'N';
    if (dy > 0) dirY = 'S';
    if (dx > 0) dirX = 'E';
    if (dx < 0) dirX = 'W';

    const combined = dirY + dirX;
    return combined || 'N';
  }

  // --- Spiral Exploration ---
  getNextSpiralDirection() {
    // Spiral: E(1), S(1), W(2), N(2), E(3), S(3), W(4), N(4), ...
    if (this.spiralStepsDone >= this.spiralLeg) {
      this.spiralStepsDone = 0;
      this.spiralDirIndex = (this.spiralDirIndex + 1) % 4;
      this.spiralLegsCompleted++;

      // Increase leg length every 2 direction changes
      if (this.spiralLegsCompleted % 2 === 0) {
        this.spiralLeg++;
      }
    }

    this.spiralStepsDone++;

    // Scale by visibility range for efficient coverage
    const baseDir = this.spiralDirections[this.spiralDirIndex];
    return baseDir;
  }

  resetSpiral() {
    this.spiralDirIndex = 0;
    this.spiralLeg = Math.max(1, this.visibilityRange * 2);
    this.spiralStepsDone = 0;
    this.spiralLegsCompleted = 0;
  }

  // --- Energy Management ---
  canSafelyExplore() {
    const distToRecharge = this.distanceToNearestRecharge();
    return this.energy > distToRecharge + SAFETY_BUFFER;
  }

  // --- DB Persistence ---
  async saveCellsToDB(cells) {
    if (!cells || cells.length === 0) return;

    const ops = cells.map(cell => ({
      updateOne: {
        filter: { gameId: GAME_ID, x: cell.x, y: cell.y },
        update: {
          $set: {
            type: cell.type,
            zone: cell.zone,
            island: cell.island || null,
            state: 'SEEN',
            lastSeenAt: new Date()
          },
          $setOnInsert: {
            gameId: GAME_ID,
            discoveredAt: new Date()
          }
        },
        upsert: true
      }
    }));

    try {
      await Cell.bulkWrite(ops);
    } catch (err) {
      console.error('Failed to save cells to DB:', err.message);
    }
  }

  async saveMoveToDB(direction, from, to, energyBefore, energyAfter, cellsDiscovered) {
    try {
      await Move.create({
        gameId: GAME_ID,
        direction,
        fromPosition: from,
        toPosition: to,
        energyBefore,
        energyAfter,
        cellsDiscovered: cellsDiscovered || 0,
        timestamp: new Date()
      });
    } catch (err) {
      console.error('Failed to save move to DB:', err.message);
    }
  }

  async saveIslandToDB(island) {
    try {
      await Island.findOneAndUpdate(
        { gameId: GAME_ID, islandId: island.id },
        {
          $set: {
            name: island.name,
            bonusQuotient: island.bonusQuotient,
            state: 'DISCOVERED'
          },
          $setOnInsert: {
            gameId: GAME_ID,
            islandId: island.id,
            cells: [],
            discoveredAt: new Date()
          }
        },
        { upsert: true }
      );
    } catch (err) {
      console.error('Failed to save island to DB:', err.message);
    }
  }

  // --- Initialization ---
  async initialize() {
    this.log('Initializing bot...');

    const details = await this.getPlayerDetails();

    if (!details.ship) {
      this.log('No ship found! Build a ship first.', 'error');
      return false;
    }

    this.position = details.ship.currentPosition;
    this.energy = details.ship.availableMove;
    this.maxEnergy = details.ship.level?.maxMovement || 15;
    this.speed = details.ship.level?.speed || 5000;
    this.visibilityRange = details.ship.level?.visibilityRange || 1;
    this.startPosition = { ...this.position };

    // Collect home island cells
    this.homeIslandCells = [];
    if (details.home?.cells) {
      details.home.cells.forEach(c => {
        this.homeIslandCells.push({ x: c.x, y: c.y });
      });
    }
    // If no home cells found, use nearby SAND cells from DB
    if (this.homeIslandCells.length === 0) {
      try {
        const homeCells = await Cell.find({
          gameId: GAME_ID,
          type: 'SAND',
          x: { $gte: this.position.x - 5, $lte: this.position.x + 5 },
          y: { $gte: this.position.y - 5, $lte: this.position.y + 5 }
        });
        homeCells.forEach(c => this.homeIslandCells.push({ x: c.x, y: c.y }));
      } catch (err) {
        console.error('Failed to load home cells from DB:', err.message);
      }
    }
    // Fallback: use start position
    if (this.homeIslandCells.length === 0) {
      this.homeIslandCells.push({ ...this.position });
    }

    // Collect known island cells (validated discoveries)
    this.knownIslandCells = [];
    if (details.discoveredIslands) {
      for (const { island, islandState } of details.discoveredIslands) {
        if (islandState === 'KNOWN') {
          // Try to find island cells from DB
          try {
            const islandCells = await Cell.find({
              gameId: GAME_ID,
              'island.id': island.id,
              type: 'SAND'
            });
            islandCells.forEach(c => {
              this.knownIslandCells.push({ x: c.x, y: c.y });
            });
          } catch (err) {
            // Ignore
          }
        }
      }
    }

    // Load visited positions from DB
    try {
      const allCells = await Cell.find({ gameId: GAME_ID }, { x: 1, y: 1 });
      allCells.forEach(c => this.visitedPositions.add(`${c.x},${c.y}`));
    } catch (err) {
      // Ignore
    }

    this.resetSpiral();

    this.log(`Position: (${this.position.x}, ${this.position.y})`);
    this.log(`Energy: ${this.energy}/${this.maxEnergy}`);
    this.log(`Ship speed: ${this.speed}ms, Visibility: ${this.visibilityRange}`);
    this.log(`Home cells: ${this.homeIslandCells.length}, Known island cells: ${this.knownIslandCells.length}`);
    this.log(`Already visited: ${this.visitedPositions.size} positions`);

    return true;
  }

  // --- Main Loop ---
  async tick() {
    if (!this.running || this.paused) return;

    try {
      switch (this.state) {
        case 'EXPLORING':
          await this.handleExploring();
          break;
        case 'RETURNING':
          await this.handleReturning();
          break;
        case 'RECHARGING':
          await this.handleRecharging();
          break;
        default:
          break;
      }
    } catch (err) {
      this.log(`Error: ${err.message}`, 'error');

      // Handle specific errors
      const msg = err.message.toLowerCase();
      if (msg.includes('immobili') || msg.includes('panne') || msg.includes('rescue') || msg.includes('remorqu')) {
        this.log('Ship is immobilized! Waiting for rescue...', 'warn');
        this.state = 'RECHARGING';
      } else if (msg.includes('cooldown') || msg.includes('attendre') || msg.includes('wait')) {
        this.log('Cooldown active, waiting...', 'warn');
        // Will retry on next tick
      } else if (msg.includes('401') || msg.includes('403')) {
        this.log('Authentication error! Stopping bot.', 'error');
        this.stop();
        return;
      }
    }

    if (this.running && !this.paused) {
      const delay = this.state === 'RECHARGING' ? this.speed * 2 : this.speed + 500;
      this.timer = setTimeout(() => this.tick(), delay);
    }
  }

  async handleExploring() {
    if (!this.canSafelyExplore()) {
      this.state = 'RETURNING';
      const nearest = this.findNearestRechargePoint();
      const dist = nearest ? this.chebyshev(this.position, nearest) : '?';
      this.log(`Energy low (${this.energy}), returning to recharge. Distance: ${dist}`, 'warn');
      return this.handleReturning();
    }

    const direction = this.getNextSpiralDirection();
    await this.doMove(direction);
  }

  async handleReturning() {
    const target = this.findNearestRechargePoint();
    if (!target) {
      this.log('No recharge point found! Stopping.', 'error');
      this.stop();
      return;
    }

    const dist = this.chebyshev(this.position, target);

    // Check if we're on or very near the island
    if (dist <= 1 && this.position.type === 'SAND') {
      this.state = 'RECHARGING';
      this.log(`On island cell at (${this.position.x}, ${this.position.y}). Validating discoveries and recharging...`);
      // Fetch details to trigger validation
      await this.refreshState();
      return;
    }

    if (dist === 0) {
      this.state = 'RECHARGING';
      this.log('At recharge point. Recharging...');
      await this.refreshState();
      return;
    }

    const direction = this.directionToward(target);
    await this.doMove(direction);
  }

  async handleRecharging() {
    await this.refreshState();

    if (this.energy >= this.maxEnergy * 0.8) {
      this.state = 'EXPLORING';
      this.resetSpiral();
      this.log(`Recharged! Energy: ${this.energy}/${this.maxEnergy}. Resuming exploration.`, 'success');
    } else {
      this.log(`Recharging... Energy: ${this.energy}/${this.maxEnergy}`);
    }
  }

  async refreshState() {
    const details = await this.getPlayerDetails();
    this.energy = details.ship.availableMove;
    this.maxEnergy = details.ship.level?.maxMovement || this.maxEnergy;
    this.position = details.ship.currentPosition || this.position;

    // Update known islands from validated discoveries
    if (details.discoveredIslands) {
      for (const { island, islandState } of details.discoveredIslands) {
        if (islandState === 'KNOWN') {
          try {
            const islandCells = await Cell.find({
              gameId: GAME_ID,
              'island.id': island.id,
              type: 'SAND'
            });
            for (const c of islandCells) {
              const key = `${c.x},${c.y}`;
              if (!this.knownIslandCells.find(k => `${k.x},${k.y}` === key)) {
                this.knownIslandCells.push({ x: c.x, y: c.y });
              }
            }
            // Update island state in DB
            await Island.findOneAndUpdate(
              { gameId: GAME_ID, islandId: island.id },
              { $set: { state: 'KNOWN' } }
            );
          } catch (err) { /* ignore */ }
        }
      }
    }

    // Broadcast status update
    broadcast('bot:status', this.getStatus());
  }

  async doMove(direction) {
    const fromPosition = { ...this.position };
    const energyBefore = this.energy;

    this.log(`Moving ${direction} from (${this.position.x}, ${this.position.y}) [energy: ${this.energy}]`);

    const result = await this.moveShip(direction);
    this.moveCount++;

    this.position = result.position;
    this.energy = result.energy;
    this.visitedPositions.add(`${result.position.x},${result.position.y}`);

    // Process discovered cells
    if (result.discoveredCells && result.discoveredCells.length > 0) {
      this.discoveredCellsCount += result.discoveredCells.length;

      // Check for island discoveries
      for (const cell of result.discoveredCells) {
        this.visitedPositions.add(`${cell.x},${cell.y}`);
        if (cell.island) {
          this.islandsFound++;
          this.log(`Island discovered: "${cell.island.name}" at (${cell.x}, ${cell.y})!`, 'success');
          await this.saveIslandToDB(cell.island);
        }
      }

      // Save cells to DB (async, don't wait)
      this.saveCellsToDB(result.discoveredCells);

      // Broadcast cell updates for live map
      broadcast('cells:update', { cells: result.discoveredCells });
    }

    // Save move to DB
    this.saveMoveToDB(
      direction, fromPosition, result.position,
      energyBefore, result.energy,
      result.discoveredCells?.length || 0
    );

    // Broadcast position update
    broadcast('ship:position', { position: result.position });
    broadcast('bot:status', this.getStatus());

    return result;
  }

  // --- Control ---
  async start() {
    if (this.running) {
      return { success: false, message: 'Bot is already running' };
    }

    try {
      const initialized = await this.initialize();
      if (!initialized) {
        return { success: false, message: 'Failed to initialize bot' };
      }

      this.running = true;
      this.paused = false;
      this.startTime = new Date().toISOString();

      // Determine initial state based on energy
      if (this.energy > SAFETY_BUFFER + this.distanceToNearestRecharge()) {
        this.state = 'EXPLORING';
      } else if (this.energy === 0) {
        this.state = 'RECHARGING';
      } else {
        this.state = 'RETURNING';
      }

      this.log(`Bot started in ${this.state} mode`, 'success');
      broadcast('bot:status', this.getStatus());

      // Start the main loop
      this.timer = setTimeout(() => this.tick(), 1000);

      return { success: true, message: `Bot started in ${this.state} mode` };
    } catch (err) {
      this.log(`Failed to start: ${err.message}`, 'error');
      return { success: false, message: err.message };
    }
  }

  stop() {
    this.running = false;
    this.paused = false;
    this.state = 'IDLE';
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.log('Bot stopped');
    broadcast('bot:status', this.getStatus());
    return { success: true, message: 'Bot stopped' };
  }

  pause() {
    if (!this.running) return { success: false, message: 'Bot is not running' };
    this.paused = true;
    this.log('Bot paused');
    broadcast('bot:status', this.getStatus());
    return { success: true, message: 'Bot paused' };
  }

  resume() {
    if (!this.running) return { success: false, message: 'Bot is not running' };
    if (!this.paused) return { success: false, message: 'Bot is not paused' };
    this.paused = false;
    this.log('Bot resumed');
    broadcast('bot:status', this.getStatus());

    // Restart tick loop
    this.timer = setTimeout(() => this.tick(), 1000);

    return { success: true, message: 'Bot resumed' };
  }

  getStatus() {
    return {
      running: this.running,
      paused: this.paused,
      state: this.state,
      position: this.position,
      energy: this.energy,
      maxEnergy: this.maxEnergy,
      speed: this.speed,
      visibilityRange: this.visibilityRange,
      moveCount: this.moveCount,
      cellsDiscovered: this.discoveredCellsCount,
      islandsFound: this.islandsFound,
      knownRechargePoints: this.homeIslandCells.length + this.knownIslandCells.length,
      visitedPositions: this.visitedPositions.size,
      startTime: this.startTime,
      uptime: this.startTime ? Date.now() - new Date(this.startTime).getTime() : 0
    };
  }

  getLogs(since = 0) {
    return this.logs.filter(l => l.id >= since);
  }

  clearLogs() {
    this.logs = [];
  }
}

// Singleton instance
const bot = new ExplorerBot();
export default bot;
