import Cell from '../models/Cell.js';
import Island from '../models/Island.js';
import Move from '../models/Move.js';
import ShipPosition from '../models/ShipPosition.js';
import { broadcast } from '../ws.js';

const GAME_API = 'http://ec2-15-237-116-133.eu-west-3.compute.amazonaws.com:8443';
const CODINGGAME_ID = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJjb2RpbmdnYW1lIiwic3ViIjoiZTQ2MmE1ZWItOWQxNi00M2Q2LTg4MTYtMzc2N2MzMzZiZjczIiwicm9sZXMiOlsiVVNFUiJdfQ.i4gq-3ey6r0m1BOQjGTcjhvONZe9UXmPJo8ojcMf-7k';
const GAME_ID = process.env.GAME_ID || 'kuz-default';
const SAFETY_BUFFER = 4;

class ExplorerBot {
  constructor() {
    this.running = false;
    this.paused = false;
    this.state = 'IDLE';
    this.position = null;    // {x, y, type, zone}
    this.energy = 0;
    this.maxEnergy = 100;
    this.speed = 800;        // ms cooldown between moves
    this.visibilityRange = 4;

    // Recharge points: SAND cells of KNOWN islands
    this.rechargePoints = [];
    // Home island name (from API)
    this.homeIslandName = null;
    // Names of KNOWN islands (from API)
    this.knownIslandNames = new Set();

    // Stats
    this.visitedPositions = new Set();
    this.discoveredCellsCount = 0;
    this.islandsFound = new Set();  // unique island names
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

  // ========================
  // LOGGING
  // ========================
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
    broadcast('bot:log', entry);
  }

  // ========================
  // GAME API
  // ========================
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
      let errorMsg = `API ${res.status}`;
      try {
        const errData = await res.json();
        errorMsg = errData.message || errData.codeError || errorMsg;
      } catch { /* ignore */ }
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

  // ========================
  // DISTANCE & NAVIGATION
  // ========================

  // Chebyshev distance (diagonal = 1 move)
  chebyshev(a, b) {
    if (!a || !b) return Infinity;
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  }

  findNearestRechargePoint() {
    if (this.rechargePoints.length === 0) return null;
    if (!this.position) return null;

    let nearest = null;
    let minDist = Infinity;
    for (const cell of this.rechargePoints) {
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

  // Best direction to move toward target
  directionToward(target) {
    if (!this.position || !target) return 'N';
    const dx = target.x - this.position.x;
    const dy = target.y - this.position.y;

    let dir = '';
    if (dy < 0) dir += 'N';
    if (dy > 0) dir += 'S';
    if (dx > 0) dir += 'E';
    if (dx < 0) dir += 'W';

    return dir || 'N';
  }

  // ========================
  // SPIRAL EXPLORATION
  // ========================
  getNextSpiralDirection() {
    if (this.spiralStepsDone >= this.spiralLeg) {
      this.spiralStepsDone = 0;
      this.spiralDirIndex = (this.spiralDirIndex + 1) % 4;
      this.spiralLegsCompleted++;
      if (this.spiralLegsCompleted % 2 === 0) {
        this.spiralLeg++;
      }
    }
    this.spiralStepsDone++;
    return this.spiralDirections[this.spiralDirIndex];
  }

  resetSpiral() {
    this.spiralDirIndex = 0;
    this.spiralLeg = Math.max(1, this.visibilityRange * 2);
    this.spiralStepsDone = 0;
    this.spiralLegsCompleted = 0;
  }

  // ========================
  // ENERGY MANAGEMENT
  // ========================
  canSafelyExplore() {
    if (!this.position) return false;
    const dist = this.distanceToNearestRecharge();
    if (dist === Infinity) return this.energy > SAFETY_BUFFER;
    return this.energy > dist + SAFETY_BUFFER;
  }

  // ========================
  // DB PERSISTENCE
  // ========================
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
          $setOnInsert: { gameId: GAME_ID, discoveredAt: new Date() }
        },
        upsert: true
      }
    }));
    try { await Cell.bulkWrite(ops); } catch (err) {
      console.error('DB save cells error:', err.message);
    }
  }

  async saveMoveToDB(direction, from, to, energyBefore, energyAfter, cellsCount) {
    try {
      await Move.create({
        gameId: GAME_ID, direction,
        fromPosition: from, toPosition: to,
        energyBefore, energyAfter,
        cellsDiscovered: cellsCount || 0,
        timestamp: new Date()
      });
    } catch (err) {
      console.error('DB save move error:', err.message);
    }
  }

  async saveIslandToDB(island) {
    try {
      await Island.findOneAndUpdate(
        { gameId: GAME_ID, islandId: island.id },
        {
          $set: { name: island.name, bonusQuotient: island.bonusQuotient || 0 },
          $setOnInsert: { gameId: GAME_ID, islandId: island.id, state: 'DISCOVERED', cells: [], discoveredAt: new Date() }
        },
        { upsert: true }
      );
    } catch (err) {
      console.error('DB save island error:', err.message);
    }
  }

  async savePositionToDB(pos) {
    if (!pos) return;
    try {
      await ShipPosition.findOneAndUpdate(
        { gameId: GAME_ID },
        { $set: { x: pos.x, y: pos.y, type: pos.type, zone: pos.zone } },
        { upsert: true }
      );
    } catch (err) {
      console.error('DB save position error:', err.message);
    }
  }

  // ========================
  // LOAD RECHARGE POINTS FROM DB
  // ========================
  async loadRechargePoints() {
    this.rechargePoints = [];

    try {
      // Strategy 1: Find SAND cells whose island.name matches a KNOWN island from API
      if (this.knownIslandNames.size > 0) {
        const knownNames = Array.from(this.knownIslandNames);
        const sandCells = await Cell.find({
          gameId: GAME_ID,
          type: 'SAND',
          'island.name': { $in: knownNames }
        });
        sandCells.forEach(c => {
          this.rechargePoints.push({ x: c.x, y: c.y });
        });
      }

      // Strategy 2: Also add SAND cells from KNOWN islands in local DB (by id)
      if (this.rechargePoints.length === 0) {
        const knownIslandDocs = await Island.find({ gameId: GAME_ID, state: 'KNOWN' });
        if (knownIslandDocs.length > 0) {
          const ids = knownIslandDocs.map(i => i.islandId);
          const sandCells = await Cell.find({
            gameId: GAME_ID,
            type: 'SAND',
            'island.id': { $in: ids }
          });
          sandCells.forEach(c => {
            this.rechargePoints.push({ x: c.x, y: c.y });
          });
        }
      }

      // Strategy 3: Fallback - use ALL SAND cells in DB (any island is better than none)
      if (this.rechargePoints.length === 0) {
        const allSand = await Cell.find({ gameId: GAME_ID, type: 'SAND' });
        allSand.forEach(c => {
          this.rechargePoints.push({ x: c.x, y: c.y });
        });
      }

      this.log(`Loaded ${this.rechargePoints.length} recharge points from DB`);
    } catch (err) {
      this.log(`Failed to load recharge points: ${err.message}`, 'error');
    }
  }

  // ========================
  // INITIALIZATION
  // ========================
  async initialize() {
    this.log('Initializing bot...');

    // 1. Get player details from game API
    const details = await this.getPlayerDetails();

    if (!details.ship) {
      this.log('No ship found! Build a ship first.', 'error');
      return false;
    }

    // Ship stats (no position in player details!)
    this.energy = details.ship.availableMove ?? 0;
    this.maxEnergy = details.ship.level?.maxMovement || 100;
    this.speed = details.ship.level?.speed || 800;
    this.visibilityRange = details.ship.level?.visibilityRange || 1;

    // Home island name
    this.homeIslandName = details.home?.name || null;

    // Known island names from API
    this.knownIslandNames = new Set();
    if (details.discoveredIslands) {
      for (const { island, islandState } of details.discoveredIslands) {
        if (islandState === 'KNOWN') {
          this.knownIslandNames.add(island.name);
        }
      }
    }

    // 2. Load position from MongoDB (player details doesn't have it)
    try {
      const savedPos = await ShipPosition.findOne({ gameId: GAME_ID });
      if (savedPos) {
        this.position = { x: savedPos.x, y: savedPos.y, type: savedPos.type, zone: savedPos.zone };
        this.log(`Position loaded from DB: (${this.position.x}, ${this.position.y})`);
      }
    } catch (err) {
      this.log(`Failed to load position from DB: ${err.message}`, 'warn');
    }

    // 3. If no position, do an initial move to discover our position
    if (!this.position) {
      this.log('No position in DB. Making initial move to discover position...');
      if (this.energy <= 0) {
        this.log('No energy to make initial move! Wait for recharge.', 'error');
        return false;
      }
      try {
        const moveResult = await this.moveShip('N');
        this.position = { x: moveResult.position.x, y: moveResult.position.y, type: moveResult.position.type, zone: moveResult.position.zone };
        this.energy = moveResult.energy;
        this.moveCount++;
        await this.savePositionToDB(this.position);
        if (moveResult.discoveredCells) {
          await this.saveCellsToDB(moveResult.discoveredCells);
        }
        this.log(`Initial move done. Position: (${this.position.x}, ${this.position.y}), Energy: ${this.energy}`);
      } catch (err) {
        this.log(`Initial move failed: ${err.message}`, 'error');
        return false;
      }
    }

    // 4. Sync island states: mark DB islands as KNOWN if the API says so
    try {
      const dbIslands = await Island.find({ gameId: GAME_ID });
      for (const dbIsland of dbIslands) {
        if (this.knownIslandNames.has(dbIsland.name) && dbIsland.state !== 'KNOWN') {
          dbIsland.state = 'KNOWN';
          await dbIsland.save();
          this.log(`Island "${dbIsland.name}" synced to KNOWN`);
        }
      }
    } catch (err) {
      // non-critical
    }

    // 5. Load recharge points from DB
    await this.loadRechargePoints();

    // 6. Load visited positions
    try {
      const allCells = await Cell.find({ gameId: GAME_ID }, { x: 1, y: 1 });
      allCells.forEach(c => this.visitedPositions.add(`${c.x},${c.y}`));
    } catch (err) { /* ignore */ }

    this.resetSpiral();

    this.log(`Energy: ${this.energy}/${this.maxEnergy}, Speed: ${this.speed}ms, Visibility: ${this.visibilityRange}`);
    this.log(`Known islands: ${this.knownIslandNames.size}, Recharge points: ${this.rechargePoints.length}`);
    this.log(`Already visited: ${this.visitedPositions.size} cells`);

    return true;
  }

  // ========================
  // MAIN LOOP
  // ========================
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
      }
    } catch (err) {
      this.log(`Error: ${err.message}`, 'error');

      const msg = err.message.toLowerCase();
      if (msg.includes('immobili') || msg.includes('panne') || msg.includes('rescue') || msg.includes('remorqu')) {
        this.log('Ship immobilized! Waiting for rescue...', 'warn');
        this.state = 'RECHARGING';
      } else if (msg.includes('too_fast') || msg.includes('trop rapide')) {
        // Just wait, next tick will handle it
      } else if (msg.includes('401') || msg.includes('403')) {
        this.log('Auth error! Stopping.', 'error');
        this.stop();
        return;
      }
    }

    if (this.running && !this.paused) {
      const delay = this.state === 'RECHARGING' ? 5000 : this.speed + 300;
      this.timer = setTimeout(() => this.tick(), delay);
    }
  }

  async handleExploring() {
    if (!this.canSafelyExplore()) {
      const target = this.findNearestRechargePoint();
      if (target && this.chebyshev(this.position, target) <= this.energy) {
        // Recharge point reachable - go there
        this.state = 'RETURNING';
        this.log(`Energy low (${this.energy}), returning to recharge (dist: ${this.chebyshev(this.position, target)})`, 'warn');
        return;
      }
      // Recharge point too far or none - keep exploring, game will tow us when at 0
      if (this.energy <= 0) {
        this.state = 'RECHARGING';
        this.log('No energy! Waiting for tow...', 'warn');
        return;
      }
    }

    const direction = this.getNextSpiralDirection();
    await this.doMove(direction);
  }

  async handleReturning() {
    if (!this.position) {
      this.log('Position unknown, cannot return!', 'error');
      this.stop();
      return;
    }

    const target = this.findNearestRechargePoint();
    if (!target) {
      this.log('No recharge point. Waiting for tow...', 'warn');
      this.state = 'RECHARGING';
      return;
    }

    const dist = this.chebyshev(this.position, target);

    // Arrived at or very near recharge point
    if (dist <= 1) {
      if (this.position.type === 'SAND') {
        this.state = 'RECHARGING';
        this.log(`Arrived on island at (${this.position.x}, ${this.position.y}). Recharging...`, 'success');
        return;
      }
      const direction = this.directionToward(target);
      await this.doMove(direction);
      if (this.position && this.position.type === 'SAND') {
        this.state = 'RECHARGING';
        this.log(`Docked on island. Recharging...`, 'success');
      }
      return;
    }

    const direction = this.directionToward(target);
    await this.doMove(direction);
  }

  async handleRecharging() {
    // Poll player details to check energy
    try {
      const details = await this.getPlayerDetails();
      const oldEnergy = this.energy;
      this.energy = details.ship.availableMove ?? this.energy;
      this.maxEnergy = details.ship.level?.maxMovement || this.maxEnergy;

      // If energy jumped to full, ship was likely towed back to home
      if (oldEnergy <= 0 && this.energy >= this.maxEnergy * 0.5) {
        this.log('Energy restored! Ship was likely towed. Resetting position...', 'warn');
        // Make a move to get new position
        try {
          const moveResult = await this.moveShip('N');
          this.position = {
            x: moveResult.position.x, y: moveResult.position.y,
            type: moveResult.position.type, zone: moveResult.position.zone
          };
          this.energy = moveResult.energy;
          this.moveCount++;
          await this.savePositionToDB(this.position);
          if (moveResult.discoveredCells) {
            await this.saveCellsToDB(moveResult.discoveredCells);
            for (const cell of moveResult.discoveredCells) {
              if (cell.island && this.knownIslandNames.has(cell.island.name)) {
                this.rechargePoints.push({ x: cell.x, y: cell.y });
              }
            }
          }
          this.log(`New position after tow: (${this.position.x}, ${this.position.y})`, 'success');
        } catch (err) {
          this.log(`Post-tow move failed: ${err.message}`, 'warn');
        }
      }
    } catch (err) {
      this.log(`Failed to refresh details: ${err.message}`, 'warn');
    }

    // Reload recharge points in case new islands were validated
    await this.loadRechargePoints();

    if (this.energy >= this.maxEnergy * 0.8) {
      this.state = 'EXPLORING';
      this.resetSpiral();
      this.log(`Recharged! Energy: ${this.energy}/${this.maxEnergy}. Resuming exploration.`, 'success');
    } else {
      this.log(`Recharging... Energy: ${this.energy}/${this.maxEnergy}`);
    }
  }

  // ========================
  // DO MOVE
  // ========================
  async doMove(direction) {
    if (!this.position) {
      this.log('Cannot move: position unknown', 'error');
      return null;
    }

    const fromPosition = { x: this.position.x, y: this.position.y, type: this.position.type, zone: this.position.zone };
    const energyBefore = this.energy;

    this.log(`Moving ${direction} from (${this.position.x}, ${this.position.y}) [energy: ${this.energy}]`);

    const result = await this.moveShip(direction);
    this.moveCount++;

    // Update position
    this.position = {
      x: result.position.x,
      y: result.position.y,
      type: result.position.type,
      zone: result.position.zone
    };
    this.energy = result.energy;
    this.visitedPositions.add(`${this.position.x},${this.position.y}`);

    // Save position to DB
    this.savePositionToDB(this.position);

    // Process discovered cells
    const cells = result.discoveredCells || [];
    this.discoveredCellsCount += cells.length;

    for (const cell of cells) {
      this.visitedPositions.add(`${cell.x},${cell.y}`);
      if (cell.island) {
        const isNew = !this.islandsFound.has(cell.island.name);
        this.islandsFound.add(cell.island.name);
        if (isNew) {
          const isKnown = this.knownIslandNames.has(cell.island.name);
          this.log(`Island ${isKnown ? 'reconnue' : 'decouverte'}: "${cell.island.name}" at (${cell.x}, ${cell.y})!`, 'success');
          this.saveIslandToDB(cell.island);
        }

        // If this island is already KNOWN, add its cells as recharge points
        if (this.knownIslandNames.has(cell.island.name)) {
          if (!this.rechargePoints.find(r => r.x === cell.x && r.y === cell.y)) {
            this.rechargePoints.push({ x: cell.x, y: cell.y });
          }
        }
      }
    }

    // Save cells to DB (fire and forget)
    this.saveCellsToDB(cells);

    // Save move to DB (fire and forget)
    this.saveMoveToDB(direction, fromPosition, this.position, energyBefore, this.energy, cells.length);

    // Broadcast updates
    broadcast('cells:update', { cells });
    broadcast('ship:position', { position: this.position });
    broadcast('bot:status', this.getStatus());

    return result;
  }

  // ========================
  // CONTROL
  // ========================
  async start() {
    if (this.running) {
      return { success: false, message: 'Bot already running' };
    }

    try {
      const initialized = await this.initialize();
      if (!initialized) {
        return { success: false, message: 'Failed to initialize' };
      }

      this.running = true;
      this.paused = false;
      this.startTime = new Date().toISOString();

      // Determine initial state
      if (this.energy <= 0) {
        this.state = 'RECHARGING';
      } else if (!this.canSafelyExplore()) {
        this.state = 'RETURNING';
      } else {
        this.state = 'EXPLORING';
      }

      this.log(`Bot started in ${this.state} mode`, 'success');
      broadcast('bot:status', this.getStatus());

      this.timer = setTimeout(() => this.tick(), 1000);
      return { success: true, message: `Bot started (${this.state})` };
    } catch (err) {
      this.log(`Start failed: ${err.message}`, 'error');
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
    if (!this.running) return { success: false, message: 'Not running' };
    this.paused = true;
    this.log('Bot paused');
    broadcast('bot:status', this.getStatus());
    return { success: true, message: 'Bot paused' };
  }

  resume() {
    if (!this.running) return { success: false, message: 'Not running' };
    if (!this.paused) return { success: false, message: 'Not paused' };
    this.paused = false;
    this.log('Bot resumed');
    broadcast('bot:status', this.getStatus());
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
      islandsFound: this.islandsFound.size,
      knownRechargePoints: this.rechargePoints.length,
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

const bot = new ExplorerBot();
export default bot;
