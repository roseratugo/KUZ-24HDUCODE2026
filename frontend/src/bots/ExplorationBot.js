/**
 * ExplorationBot - Explorateur autonome avec algorithme BFS frontière
 *
 * Algorithme : Exploration par frontières avec pathfinding BFS 8-directionnel
 *
 * 1. Multi-source BFS depuis toutes les îles (SAND) pour calculer la distance de retour
 * 2. BFS depuis la position actuelle pour trouver la meilleure frontière
 *    (cellule connue avec le plus de cellules inconnues à portée de vision)
 * 3. Score = valeur_découverte / (distance + 1) → maximise les découvertes par mouvement
 * 4. Exécute un seul pas par tick, puis re-planifie (adapte aux nouvelles découvertes)
 * 5. Quand l'énergie est critique, BFS vers l'île la plus proche
 * 6. Quand des îles sont DISCOVERED, retour vers île KNOWN pour valider
 *
 * Le bot ne s'arrête JAMAIS : il explore en continu.
 * Diagonales prioritaires : NE/SE/SW/NW avant N/E/S/W pour couvrir plus de terrain.
 * Zones : les cellules de zone > niveau du bateau sont traitées comme des murs.
 */

import { shipApi, playerApi } from '../api/client';
import { shipPositionApi, movesApi } from '../api/mapApi';

// Diagonales EN PREMIER pour maximiser la couverture par mouvement
// En Chebyshev, un mouvement diagonal couvre dx+dy simultanément = plus efficace
const DIAG_FIRST_DIRECTIONS = ['NE', 'SE', 'SW', 'NW', 'N', 'E', 'S', 'W'];
const CARDINAL_DIRECTIONS = ['N', 'E', 'S', 'W'];

const DIRECTION_VECTORS = {
  'N':  { dx:  0, dy: -1 },
  'S':  { dx:  0, dy:  1 },
  'E':  { dx:  1, dy:  0 },
  'W':  { dx: -1, dy:  0 },
  'NE': { dx:  1, dy: -1 },
  'NW': { dx: -1, dy: -1 },
  'SE': { dx:  1, dy:  1 },
  'SW': { dx: -1, dy:  1 }
};

export class ExplorationBot {
  constructor(options = {}) {
    this.isRunning = false;
    this.isPaused = false;
    this.startTime = null;
    this.actionsCount = 0;
    this.cellsDiscovered = 0;
    this.islandsDiscovered = 0;

    // Configuration
    this.config = {
      safetyBuffer: options.safetyBuffer ?? 3,
      moveDelay: options.moveDelay ?? 100,
      maxConsecutiveErrors: options.maxConsecutiveErrors ?? 5
    };

    // Ship state
    this.currentPosition = null;
    this.energy = 0;
    this.maxEnergy = 0;
    this.visibilityRange = 1;
    this.shipSpeed = 5000;
    this.shipLevelNumber = 1;

    // Known map
    this.knownCells = new Map();       // "x,y" -> cell data
    this.knownIslands = [];
    this.discoveredIslands = [];
    this.blockedDirections = new Map(); // "x,y" -> Set<direction>
    this.homeIsland = null;

    // Exploration anti-boucle : positions récemment visitées
    this.recentPositions = [];
    this.maxRecentPositions = 20;

    // Callbacks
    this.onStatusChange = null;
    this.onMove = null;
    this.onDiscovery = null;
    this.onError = null;
    this.onLog = null;

    // Error tracking
    this.consecutiveErrors = 0;
    this.stuckCounter = 0;
  }

  // ─────────────────────── Logging ───────────────────────

  log(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = { timestamp, message, type };
    console.log(`[ExplorationBot ${timestamp}] ${message}`);
    if (this.onLog) this.onLog(logEntry);
  }

  // ─────────────────────── Lifecycle ───────────────────────

  async start(shipStore, mapStore, playerStore) {
    if (this.isRunning) {
      this.log('Bot déjà en cours d\'exécution', 'warn');
      return;
    }

    this.isRunning = true;
    this.isPaused = false;
    this.startTime = Date.now();
    this.actionsCount = 0;
    this.consecutiveErrors = 0;

    this.shipStore = shipStore;
    this.mapStore = mapStore;
    this.playerStore = playerStore;

    this.log('🚀 Démarrage du bot d\'exploration (BFS 8-dir, diagonales prioritaires)');

    try {
      await this.loadInitialState();

      if (!this.currentPosition) {
        this.log('❌ Pas de position de bateau! Construis ton bateau d\'abord.', 'error');
        this.stop();
        return;
      }

      await this.runLoop();
    } catch (err) {
      this.log(`❌ ERREUR FATALE: ${err.message}`, 'error');
      this.stop();
      throw err;
    }
  }

  pause() {
    this.isPaused = true;
    this.log('⏸️ Bot en pause');
    if (this.onStatusChange) this.onStatusChange('paused');
  }

  resume() {
    this.isPaused = false;
    this.log('▶️ Bot repris');
    if (this.onStatusChange) this.onStatusChange('running');
  }

  stop() {
    this.isRunning = false;
    this.isPaused = false;
    this.log('⏹️ Bot arrêté');
    if (this.onStatusChange) this.onStatusChange('stopped');
  }

  getStats() {
    return {
      isRunning: this.isRunning,
      isPaused: this.isPaused,
      startTime: this.startTime,
      uptime: this.startTime ? Date.now() - this.startTime : 0,
      actionsCount: this.actionsCount,
      cellsDiscovered: this.cellsDiscovered,
      islandsDiscovered: this.islandsDiscovered,
      currentPosition: this.currentPosition,
      energy: this.energy,
      maxEnergy: this.maxEnergy,
      knownCellsCount: this.knownCells.size,
      knownIslandsCount: this.knownIslands.length,
      discoveredIslandsCount: this.discoveredIslands.length
    };
  }

  // ─────────────────────── Initialization ───────────────────────

  async loadInitialState() {
    this.log('📥 Chargement de l\'état initial...');

    await this.playerStore.fetchDetails();

    if (!this.playerStore.details) {
      throw new Error('Impossible de récupérer les détails du joueur');
    }

    this.log(`👤 Joueur: ${this.playerStore.details.name || 'Inconnu'}`);

    // Ship state from store or player details
    this.currentPosition = this.shipStore.position;
    this.energy = this.shipStore.energy;
    this.maxEnergy = this.shipStore.maxEnergy;
    this.visibilityRange = this.shipStore.shipLevel?.visibilityRange || 1;
    this.shipSpeed = this.shipStore.shipLevel?.speed || 5000;

    if (!this.currentPosition) {
      const ship = this.playerStore.details?.ship;
      if (ship?.currentPosition) {
        this.currentPosition = ship.currentPosition;
        this.energy = ship.availableMove || 0;
        this.maxEnergy = ship.level?.maxMovement || 100;
        this.visibilityRange = ship.level?.visibilityRange || 1;
        this.shipSpeed = ship.level?.speed || 5000;
      } else {
        await this.discoverInitialPosition();
      }
    }

    // Ship level for zone comparison
    this.shipLevelNumber = this.extractShipLevel();

    // Islands
    const discoveredIslands = this.playerStore.discoveredIslands || [];
    this.knownIslands = discoveredIslands
      .filter(i => i.islandState === 'KNOWN')
      .map(i => i.island);
    this.discoveredIslands = discoveredIslands
      .filter(i => i.islandState === 'DISCOVERED')
      .map(i => i.island);
    this.homeIsland = this.playerStore.homeIsland;

    // Load known cells from DB
    await this.mapStore.loadFromDB();
    this.mapStore.allCells.forEach(cell => {
      this.knownCells.set(`${cell.x},${cell.y}`, cell);
    });

    // Ensure current position is in known cells
    if (this.currentPosition) {
      const key = `${this.currentPosition.x},${this.currentPosition.y}`;
      if (!this.knownCells.has(key)) {
        this.knownCells.set(key, {
          x: this.currentPosition.x,
          y: this.currentPosition.y,
          type: this.currentPosition.type,
          zone: this.currentPosition.zone,
          state: 'KNOWN'
        });
      }
    }

    this.log('═══════════════════════════════════════');
    this.log(`📍 Position: (${this.currentPosition?.x}, ${this.currentPosition?.y})`);
    this.log(`⚡ Énergie: ${this.energy}/${this.maxEnergy}`);
    this.log(`👁️ Vision: ${this.visibilityRange} case(s)`);
    this.log(`⏱️ Cooldown: ${this.shipSpeed}ms`);
    this.log(`🗺️ Cellules connues: ${this.knownCells.size}`);
    this.log(`🏝️ Îles KNOWN: ${this.knownIslands.length}`);
    this.log(`🔍 Îles DISCOVERED: ${this.discoveredIslands.length}`);
    this.log(`🚢 Niveau bateau: ${this.shipLevelNumber}`);
    this.log(`↗️ Mode: 8 directions, diagonales prioritaires`);
    this.log('═══════════════════════════════════════');
  }

  async discoverInitialPosition() {
    // Essayer diagonales d'abord (plus efficace)
    for (const direction of DIAG_FIRST_DIRECTIONS) {
      try {
        this.log(`🎲 Tentative mouvement ${direction}...`);
        const response = await shipApi.move(direction);
        const data = response.data;

        this.currentPosition = data.position;
        this.energy = data.energy;
        this.shipStore.updateFromMoveResponse(data);

        if (data.position) {
          shipPositionApi.save(data.position).catch(() => {});
        }

        if (data.discoveredCells?.length > 0) {
          this.cellsDiscovered += data.discoveredCells.length;
          await this.processDiscoveredCells(data.discoveredCells);
        }

        await this.sleep(this.shipSpeed + 100);
        return;
      } catch (err) {
        this.log(`⚠️ Direction ${direction} échouée: ${err.response?.data?.message || err.message}`, 'warn');
      }
    }

    throw new Error('Impossible de découvrir la position initiale');
  }

  // ─────────────────────── Main Loop ───────────────────────

  async runLoop() {
    this.log('🔁 Boucle principale — le bot ne s\'arrêtera JAMAIS');
    let tickCount = 0;

    while (this.isRunning) {
      if (this.isPaused) {
        await this.sleep(1000);
        continue;
      }

      tickCount++;

      try {
        await this.executeTick(tickCount);
        this.consecutiveErrors = 0;
      } catch (err) {
        this.consecutiveErrors++;
        const errMsg = err.response?.data?.message || err.message;
        const errCode = err.response?.data?.codeError || '';

        this.log(`❌ Erreur tick #${tickCount}: ${errCode ? `[${errCode}] ` : ''}${errMsg}`, 'error');

        if (this.consecutiveErrors >= this.config.maxConsecutiveErrors) {
          this.log(`⚠️ ${this.consecutiveErrors} erreurs consécutives, reset des directions bloquées et reprise...`, 'warn');
          this.blockedDirections.clear();
          this.consecutiveErrors = 0;
          this.stuckCounter++;

          if (this.stuckCounter >= 3) {
            this.log(`🔄 Stuck x3, pause de 10s puis reprise...`, 'warn');
            this.stuckCounter = 0;
            await this.sleep(10000);
          }
        }

        await this.sleep(2000);
      }
    }
  }

  async executeTick(tickCount) {
    await this.refreshState();

    // Wait for cooldown
    if (this.shipStore.isOnCooldown) {
      const waitTime = this.shipStore.cooldownRemaining + 100;
      await this.sleep(waitTime);
      return;
    }

    const action = this.decideNextAction();

    if (action.type === 'wait') {
      this.log(`💤 ${action.reason} (${action.duration || 3000}ms)`);
      await this.sleep(action.duration || 3000);
      return;
    }

    if (action.type === 'move') {
      this.log(`🎯 ${action.direction} (${action.reason})`);
      await this.executeMove(action.direction);
    }
  }

  async refreshState() {
    try {
      await this.playerStore.fetchDetails();
      this.currentPosition = this.shipStore.position || this.currentPosition;
      this.energy = this.shipStore.energy;
      this.maxEnergy = this.shipStore.maxEnergy;
      this.shipLevelNumber = this.extractShipLevel();

      // Refresh islands
      const discoveredIslands = this.playerStore.discoveredIslands || [];
      this.knownIslands = discoveredIslands
        .filter(i => i.islandState === 'KNOWN')
        .map(i => i.island);
      this.discoveredIslands = discoveredIslands
        .filter(i => i.islandState === 'DISCOVERED')
        .map(i => i.island);

      await this.mapStore.syncIslandStates(discoveredIslands);
    } catch (err) {
      this.log(`⚠️ Erreur refresh: ${err.message}`, 'warn');
    }
  }

  // ─────────────────────── Core Algorithm ───────────────────────

  extractShipLevel() {
    const levelName = this.shipStore?.shipLevel?.name || '';
    const match = levelName.match(/\d+/);
    if (match) return parseInt(match[0]);
    return this.currentPosition?.zone || 1;
  }

  /**
   * Vérifie si une cellule est traversable pour le pathfinding.
   */
  isCellPassable(x, y) {
    const cell = this.knownCells.get(`${x},${y}`);
    if (!cell) return false;
    if (cell.type === 'ROCKS') return false;
    if (cell.zone !== undefined && cell.zone > this.shipLevelNumber) return false;
    return true;
  }

  /**
   * Calcule la valeur de découverte d'une position : nombre de cellules
   * inconnues dans le rayon de visibilité (Chebyshev).
   */
  getDiscoveryValue(x, y) {
    let count = 0;
    const range = this.visibilityRange;
    for (let dx = -range; dx <= range; dx++) {
      for (let dy = -range; dy <= range; dy++) {
        if (dx === 0 && dy === 0) continue;
        if (Math.max(Math.abs(dx), Math.abs(dy)) > range) continue;
        if (!this.knownCells.has(`${x + dx},${y + dy}`)) {
          count++;
        }
      }
    }
    return count;
  }

  /**
   * Multi-source BFS depuis toutes les cellules SAND (îles).
   * Retourne une Map "x,y" -> distance vers l'île la plus proche.
   */
  computeIslandDistanceMap() {
    const distMap = new Map();
    const queue = [];

    for (const [key, cell] of this.knownCells) {
      if (cell.type === 'SAND' && (cell.zone === undefined || cell.zone <= this.shipLevelNumber)) {
        distMap.set(key, 0);
        queue.push({ x: cell.x, y: cell.y });
      }
    }

    let head = 0;
    while (head < queue.length) {
      const { x, y } = queue[head++];
      const currentDist = distMap.get(`${x},${y}`);

      for (const dir of DIAG_FIRST_DIRECTIONS) {
        const vec = DIRECTION_VECTORS[dir];
        const nx = x + vec.dx;
        const ny = y + vec.dy;
        const nkey = `${nx},${ny}`;

        if (distMap.has(nkey)) continue;
        if (!this.isCellPassable(nx, ny)) continue;

        distMap.set(nkey, currentDist + 1);
        queue.push({ x: nx, y: ny });
      }
    }

    return distMap;
  }

  /**
   * BFS depuis la position actuelle pour trouver la meilleure frontière.
   * Utilise 8 directions avec diagonales en priorité.
   *
   * Score = discoveryValue / (distance + 1)
   * Bonus anti-revisit : pénalise les cellules récemment visitées.
   */
  findBestFrontier(islandDistMap) {
    const pos = this.currentPosition;
    if (!pos) return { frontier: null, path: null, hasUnaffordableFrontiers: false };

    const startKey = `${pos.x},${pos.y}`;
    const queue = [{ x: pos.x, y: pos.y }];
    const visited = new Map();
    visited.set(startKey, { parent: null, dir: null, dist: 0 });
    let head = 0;

    let bestFrontier = null;
    let bestScore = -1;
    let hasUnaffordableFrontiers = false;

    // Set des positions récentes pour pénaliser
    const recentSet = new Set(this.recentPositions);

    while (head < queue.length) {
      const { x, y } = queue[head++];
      const key = `${x},${y}`;
      const dist = visited.get(key).dist;

      // Vérifier si cette cellule est une frontière
      if (dist > 0) {
        const discoveryValue = this.getDiscoveryValue(x, y);
        if (discoveryValue > 0) {
          const returnCost = islandDistMap.get(key) ?? Infinity;
          const totalCost = dist + returnCost + this.config.safetyBuffer;

          if (totalCost <= this.energy) {
            // Pénaliser les positions récemment visitées
            const recentPenalty = recentSet.has(key) ? 0.5 : 1.0;
            const score = (discoveryValue * recentPenalty) / (dist + 1);
            if (score > bestScore) {
              bestScore = score;
              bestFrontier = { x, y, dist, score, discoveryValue, returnCost, totalCost, key };
            }
          } else {
            hasUnaffordableFrontiers = true;
          }
        }
      }

      // Expansion BFS — diagonales en premier !
      for (const dir of DIAG_FIRST_DIRECTIONS) {
        const vec = DIRECTION_VECTORS[dir];
        const nx = x + vec.dx;
        const ny = y + vec.dy;
        const nkey = `${nx},${ny}`;

        if (visited.has(nkey)) continue;
        if (!this.isCellPassable(nx, ny)) continue;
        if (this.isDirectionBlocked({ x, y }, dir)) continue;

        visited.set(nkey, { parent: key, dir, dist: dist + 1 });
        queue.push({ x: nx, y: ny });
      }
    }

    if (!bestFrontier) {
      return { frontier: null, path: null, hasUnaffordableFrontiers };
    }

    // Reconstruire le chemin
    const path = this.reconstructPath(visited, bestFrontier.key);
    return { frontier: bestFrontier, path, hasUnaffordableFrontiers };
  }

  /**
   * Reconstruit un chemin depuis les données BFS.
   */
  reconstructPath(visited, targetKey) {
    const path = [];
    let current = targetKey;
    while (visited.get(current)?.parent !== null) {
      const { parent, dir } = visited.get(current);
      path.unshift(dir);
      current = parent;
    }
    return path;
  }

  /**
   * BFS exact vers l'île KNOWN la plus proche (cellule SAND).
   * Respecte les directions bloquées pour un chemin fiable.
   */
  bfsToNearestIsland() {
    const pos = this.currentPosition;
    if (!pos) return null;
    if (this.isOnIsland()) return { path: [], dist: 0 };

    const startKey = `${pos.x},${pos.y}`;
    const queue = [{ x: pos.x, y: pos.y }];
    const visited = new Map();
    visited.set(startKey, { parent: null, dir: null });
    let head = 0;

    while (head < queue.length) {
      const { x, y } = queue[head++];
      const key = `${x},${y}`;

      if (key !== startKey) {
        const cell = this.knownCells.get(key);
        if (cell && cell.type === 'SAND' && (cell.zone === undefined || cell.zone <= this.shipLevelNumber)) {
          const path = this.reconstructPath(visited, key);
          return { path, dist: path.length };
        }
      }

      for (const dir of DIAG_FIRST_DIRECTIONS) {
        const vec = DIRECTION_VECTORS[dir];
        const nx = x + vec.dx;
        const ny = y + vec.dy;
        const nkey = `${nx},${ny}`;

        if (visited.has(nkey)) continue;
        if (!this.isCellPassable(nx, ny)) continue;
        if (this.isDirectionBlocked({ x, y }, dir)) continue;

        visited.set(nkey, { parent: key, dir });
        queue.push({ x: nx, y: ny });
      }
    }

    return null;
  }

  /**
   * BFS vers l'île KNOWN la plus proche pour valider les découvertes.
   * Différent de bfsToNearestIsland: celui-ci cible spécifiquement
   * les cellules SAND d'îles dont l'état est KNOWN (pas DISCOVERED).
   */
  bfsToKnownIsland() {
    const pos = this.currentPosition;
    if (!pos) return null;

    // Si on est déjà sur une île KNOWN, pas besoin de bouger
    if (this.isOnKnownIsland()) return { path: [], dist: 0 };

    // Collecter les IDs des îles KNOWN
    const knownIslandIds = new Set(this.knownIslands.map(i => i.id));

    // Trouver les cellules SAND qui font partie d'îles KNOWN
    const knownIslandCells = new Set();
    for (const [key, cell] of this.knownCells) {
      if (cell.type === 'SAND' && cell.state === 'KNOWN') {
        knownIslandCells.add(key);
      }
      // Aussi via l'ID de l'île
      if (cell.type === 'SAND' && cell.island?.id && knownIslandIds.has(cell.island.id)) {
        knownIslandCells.add(key);
      }
    }

    // Ajouter les cellules de homeIsland si on l'a
    if (this.homeIsland) {
      for (const [key, cell] of this.knownCells) {
        if (cell.type === 'SAND' && cell.island?.name === this.homeIsland.name) {
          knownIslandCells.add(key);
        }
      }
    }

    if (knownIslandCells.size === 0) {
      // Fallback: n'importe quelle île SAND
      return this.bfsToNearestIsland();
    }

    const startKey = `${pos.x},${pos.y}`;
    const queue = [{ x: pos.x, y: pos.y }];
    const visited = new Map();
    visited.set(startKey, { parent: null, dir: null });
    let head = 0;

    while (head < queue.length) {
      const { x, y } = queue[head++];
      const key = `${x},${y}`;

      if (key !== startKey && knownIslandCells.has(key)) {
        const path = this.reconstructPath(visited, key);
        return { path, dist: path.length };
      }

      for (const dir of DIAG_FIRST_DIRECTIONS) {
        const vec = DIRECTION_VECTORS[dir];
        const nx = x + vec.dx;
        const ny = y + vec.dy;
        const nkey = `${nx},${ny}`;

        if (visited.has(nkey)) continue;
        if (!this.isCellPassable(nx, ny)) continue;
        if (this.isDirectionBlocked({ x, y }, dir)) continue;

        visited.set(nkey, { parent: key, dir });
        queue.push({ x: nx, y: ny });
      }
    }

    // Pas d'île KNOWN trouvée, fallback
    return this.bfsToNearestIsland();
  }

  /**
   * Vérifie si on est sur une île KNOWN (pas juste SAND).
   */
  isOnKnownIsland() {
    if (!this.currentPosition || this.currentPosition.type !== 'SAND') return false;
    const key = `${this.currentPosition.x},${this.currentPosition.y}`;
    const cell = this.knownCells.get(key);
    if (cell?.state === 'KNOWN') return true;
    // Vérifier via les IDs d'îles
    const knownIds = new Set(this.knownIslands.map(i => i.id));
    if (cell?.island?.id && knownIds.has(cell.island.id)) return true;
    // Home island
    if (cell?.island?.name === this.homeIsland?.name) return true;
    return false;
  }

  /**
   * Moteur de décision principal.
   * Le bot ne s'arrête JAMAIS. Il explore en boucle infinie.
   *
   * Priorités :
   * 1. Énergie critique → retour vers île KNOWN
   * 2. Îles DISCOVERED à valider → retour vers île KNOWN
   * 3. Sur île : recharger si besoin, puis explorer
   * 4. Explorer vers la meilleure frontière
   * 5. Aucune frontière abordable → retour recharge
   * 6. Aucune frontière du tout → random walk (ne s'arrête jamais)
   */
  decideNextAction() {
    const pos = this.currentPosition;
    if (!pos) return { type: 'wait', reason: 'no_position', duration: 2000 };

    const islandDistMap = this.computeIslandDistanceMap();
    const posKey = `${pos.x},${pos.y}`;
    const returnCostEstimate = islandDistMap.get(posKey) ?? Infinity;
    const hasKnownIsland = returnCostEstimate < Infinity;

    this.log(`📊 (${pos.x},${pos.y}) | ⚡${this.energy}/${this.maxEnergy} | 🏝️ret≈${hasKnownIsland ? returnCostEstimate : '∞'} | Lv${this.shipLevelNumber} | 🔍DISC:${this.discoveredIslands.length}`);

    // ─── 1. ÉNERGIE CRITIQUE → retour immédiat ───
    if (hasKnownIsland && returnCostEstimate > 0 && this.energy <= returnCostEstimate + this.config.safetyBuffer) {
      this.log(`⚠️ ÉNERGIE CRITIQUE (${this.energy} ≤ ${returnCostEstimate}+${this.config.safetyBuffer}) → RETOUR`, 'warn');
      const returnInfo = this.bfsToNearestIsland();
      if (returnInfo && returnInfo.path.length > 0) {
        return { type: 'move', direction: returnInfo.path[0], reason: 'retour_critique' };
      }
      const bruteDir = this.getBruteDirectionToIsland(islandDistMap);
      if (bruteDir) {
        return { type: 'move', direction: bruteDir, reason: 'retour_brut' };
      }
    }

    // ─── 2. ÎLES DISCOVERED À VALIDER → retour vers île KNOWN ───
    if (this.discoveredIslands.length > 0 && !this.isOnKnownIsland()) {
      // On a des îles à valider : il faut retourner sur une île KNOWN
      // Mais seulement si on a assez d'énergie, ou si on doit de toute façon rentrer
      const returnInfo = this.bfsToKnownIsland();
      if (returnInfo && returnInfo.path.length > 0) {
        const canAffordReturn = this.energy > returnInfo.dist + this.config.safetyBuffer;
        const shouldReturn = this.energy <= returnCostEstimate + this.config.safetyBuffer + 3;

        if (canAffordReturn && shouldReturn) {
          this.log(`📋 ${this.discoveredIslands.length} île(s) à valider → retour île KNOWN (dist: ${returnInfo.dist})`, 'warn');
          return { type: 'move', direction: returnInfo.path[0], reason: 'validation_îles' };
        }

        // Si on peut encore explorer un peu avant de rentrer, on continue
        // On ne rentre que quand l'énergie nous y oblige
      }
    }

    // ─── 3. SUR UNE ÎLE ───
    if (this.isOnIsland()) {
      // 3a. Si on est sur une île KNOWN et qu'on a des DISCOVERED à valider
      if (this.isOnKnownIsland() && this.discoveredIslands.length > 0) {
        this.log(`✅ Sur île KNOWN — validation de ${this.discoveredIslands.length} île(s) DISCOVERED en cours`);
        // Le refresh de l'état a déjà synchro les îles, la validation se fait automatiquement
        // via le game server quand on retourne sur une île KNOWN.
        // On attend un tick pour que le serveur traite, puis on continue.
      }

      // 3b. Chercher la meilleure frontière
      const result = this.findBestFrontier(islandDistMap);

      if (result.frontier) {
        if (this.energy >= result.frontier.totalCost) {
          this.log(`🎯 Frontière (${result.frontier.x},${result.frontier.y}) score=${result.frontier.score.toFixed(2)} disc=${result.frontier.discoveryValue} dist=${result.frontier.dist}`);
          return { type: 'move', direction: result.path[0], reason: 'explorer' };
        }
        // Pas assez d'énergie, recharger
        const needed = result.frontier.totalCost - this.energy;
        this.log(`🔋 Recharge: besoin ${needed} énergie pour frontière (${result.frontier.x},${result.frontier.y})`);
        return { type: 'wait', reason: 'recharge', duration: 3000 };
      }

      if (result.hasUnaffordableFrontiers) {
        this.log(`🔋 Frontières existent mais trop chères (${this.energy}/${this.maxEnergy})`);
        return { type: 'wait', reason: 'recharge_frontière', duration: 3000 };
      }

      // Aucune frontière visible — mais on ne s'arrête JAMAIS
      if (this.energy < this.maxEnergy) {
        this.log(`🔋 Pas de frontière, recharge complète avant de tenter random (${this.energy}/${this.maxEnergy})`);
        return { type: 'wait', reason: 'recharge_avant_random', duration: 3000 };
      }

      // Énergie pleine, aucune frontière → random walk pour trouver de nouvelles zones
      this.log(`🔀 Aucune frontière trouvée — random walk pour découvrir de nouvelles zones`);
      this.blockedDirections.clear(); // Reset des blocages potentiellement obsolètes
      return this.getSmartRandomAction(islandDistMap);
    }

    // ─── 4. PAS SUR UNE ÎLE : explorer ───
    const result = this.findBestFrontier(islandDistMap);

    if (result.frontier) {
      this.log(`🎯 Frontière (${result.frontier.x},${result.frontier.y}) score=${result.frontier.score.toFixed(2)} disc=${result.frontier.discoveryValue} dist=${result.frontier.dist}`);
      return { type: 'move', direction: result.path[0], reason: 'explorer' };
    }

    // Pas de frontière abordable → retour recharge
    if (hasKnownIsland) {
      const returnInfo = this.bfsToNearestIsland();
      if (returnInfo && returnInfo.path.length > 0) {
        this.log(`↩️ Aucune frontière abordable → retour île (dist: ${returnInfo.dist})`);
        return { type: 'move', direction: returnInfo.path[0], reason: 'retour_recharge' };
      }
    }

    // ─── 5. AUCUNE ÎLE CONNUE : exploration aléatoire ───
    this.log(`⚠️ Aucune île connue ! Exploration libre...`, 'warn');
    return this.getSmartRandomAction(islandDistMap);
  }

  /**
   * Mouvement aléatoire intelligent quand le BFS ne trouve pas de frontière.
   * Priorise : inconnu > zones peu visitées > n'importe quelle direction
   * Utilise la carte de distance aux îles pour rester en sécurité.
   */
  getSmartRandomAction(islandDistMap) {
    const pos = this.currentPosition;
    const recentSet = new Set(this.recentPositions);

    // Construire la liste des directions avec leur score
    const candidates = [];

    for (const dir of DIAG_FIRST_DIRECTIONS) {
      if (this.isDirectionBlocked(pos, dir)) continue;

      const vec = DIRECTION_VECTORS[dir];
      const nx = pos.x + vec.dx;
      const ny = pos.y + vec.dy;
      const nkey = `${nx},${ny}`;

      const cell = this.knownCells.get(nkey);
      const isUnknown = !cell;
      const isPassable = isUnknown || this.isCellPassable(nx, ny);
      if (!isPassable) continue;

      // Vérifier qu'on peut revenir en sécurité
      const returnFromThere = islandDistMap.get(nkey) ?? Infinity;
      if (returnFromThere !== Infinity && this.energy - 1 <= returnFromThere + this.config.safetyBuffer) {
        continue; // Trop risqué
      }

      let score = 0;

      // Forte priorité pour les cellules inconnues
      if (isUnknown) {
        score += 100;
      } else {
        // Bonus pour les cellules avec des voisins inconnus
        score += this.getDiscoveryValue(nx, ny) * 10;
      }

      // Pénaliser les cellules récemment visitées
      if (recentSet.has(nkey)) {
        score -= 50;
      }

      // Bonus pour les diagonales (couvrent plus de terrain)
      if (dir.length === 2) {
        score += 5;
      }

      candidates.push({ dir, score, isUnknown });
    }

    if (candidates.length === 0) {
      // Toutes les directions bloquées — on reset et on réessaie
      this.log(`🔄 Toutes directions bloquées → reset blocages`);
      this.blockedDirections.clear();
      return { type: 'wait', reason: 'reset_blocages', duration: 1000 };
    }

    // Trier par score décroissant
    candidates.sort((a, b) => b.score - a.score);

    // Prendre le meilleur (ou random parmi les meilleurs si égalité)
    const topScore = candidates[0].score;
    const topCandidates = candidates.filter(c => c.score >= topScore - 5);
    const chosen = topCandidates[Math.floor(Math.random() * topCandidates.length)];

    const reason = chosen.isUnknown ? 'random_vers_inconnu' : 'random_exploration';
    return { type: 'move', direction: chosen.dir, reason };
  }

  /**
   * Direction brute vers la zone de distance minimale sur la carte des îles.
   */
  getBruteDirectionToIsland(islandDistMap) {
    const pos = this.currentPosition;
    let bestDir = null;
    let bestDist = Infinity;

    for (const dir of DIAG_FIRST_DIRECTIONS) {
      if (this.isDirectionBlocked(pos, dir)) continue;
      const vec = DIRECTION_VECTORS[dir];
      const nkey = `${pos.x + vec.dx},${pos.y + vec.dy}`;
      const dist = islandDistMap.get(nkey);
      if (dist !== undefined && dist < bestDist) {
        bestDist = dist;
        bestDir = dir;
      }
    }

    return bestDir;
  }

  // ─────────────────────── Movement ───────────────────────

  async executeMove(direction) {
    const fromPos = this.currentPosition;
    const fromPosStr = fromPos ? `(${fromPos.x}, ${fromPos.y})` : '?';

    try {
      const response = await shipApi.move(direction);
      const data = response.data;

      this.actionsCount++;

      const oldEnergy = this.energy;
      this.currentPosition = data.position;
      this.energy = data.energy;

      const newPosStr = `(${data.position.x}, ${data.position.y})`;
      const energyDiff = data.energy - oldEnergy;
      this.log(`✅ ${fromPosStr} → ${newPosStr} | ⚡${oldEnergy}→${data.energy} (${energyDiff >= 0 ? '+' : ''}${energyDiff})`);

      // Tracker les positions récentes (anti-boucle)
      const newKey = `${data.position.x},${data.position.y}`;
      this.recentPositions.push(newKey);
      if (this.recentPositions.length > this.maxRecentPositions) {
        this.recentPositions.shift();
      }

      // Mettre à jour les stores
      this.shipStore.updateFromMoveResponse(data);

      // Sauvegarder position et mouvement en DB (async)
      if (data.position) {
        shipPositionApi.save(data.position).catch(() => {});
      }

      movesApi.save({
        direction,
        fromPosition: fromPos,
        toPosition: data.position,
        energyBefore: oldEnergy,
        energyAfter: data.energy,
        cellsDiscovered: data.discoveredCells?.length || 0,
        timestamp: new Date().toISOString()
      }).catch(() => {});

      // Traiter les cellules découvertes
      if (data.discoveredCells?.length > 0) {
        this.cellsDiscovered += data.discoveredCells.length;
        await this.processDiscoveredCells(data.discoveredCells);
      }

      // Ensure current position is in known cells
      if (!this.knownCells.has(newKey)) {
        this.knownCells.set(newKey, {
          x: data.position.x,
          y: data.position.y,
          type: data.position.type,
          zone: data.position.zone,
          state: 'KNOWN'
        });
      } else {
        this.knownCells.get(newKey).state = 'KNOWN';
      }

      // Reset stuck counter on successful move
      this.stuckCounter = 0;

      // Cooldown
      await this.sleep(this.shipSpeed + this.config.moveDelay);

      if (this.onMove) {
        this.onMove({
          direction,
          position: data.position,
          energy: data.energy,
          cellsDiscovered: data.discoveredCells?.length || 0
        });
      }
    } catch (err) {
      const errorMsg = err.response?.data?.message || err.message;
      const errorCode = err.response?.data?.codeError || 'UNKNOWN';

      this.log(`❌ Mouvement ${direction} échoué: [${errorCode}] ${errorMsg}`, 'error');

      if (errorMsg.toLowerCase().includes('impossible') ||
          errorMsg.toLowerCase().includes('blocked') ||
          errorMsg.toLowerCase().includes('cannot') ||
          errorMsg.toLowerCase().includes('zone') ||
          errorMsg.toLowerCase().includes('level') ||
          errorCode.includes('BLOCKED') ||
          errorCode.includes('ZONE') ||
          errorCode.includes('LEVEL')) {
        this.markDirectionBlocked(this.currentPosition, direction);

        // Si erreur de zone, marquer la cellule destination comme haute zone
        if (errorMsg.toLowerCase().includes('zone') || errorMsg.toLowerCase().includes('level')) {
          const vec = DIRECTION_VECTORS[direction];
          if (this.currentPosition) {
            const targetKey = `${this.currentPosition.x + vec.dx},${this.currentPosition.y + vec.dy}`;
            const targetCell = this.knownCells.get(targetKey);
            if (targetCell) {
              targetCell.zone = this.shipLevelNumber + 1;
              this.log(`🚫 Zone trop élevée marquée à ${targetKey}`, 'warn');
            }
          }
        }
      }

      throw err;
    }
  }

  // ─────────────────────── Cell Processing ───────────────────────

  async processDiscoveredCells(cells) {
    const seaCells = cells.filter(c => c.type === 'SEA');
    const sandCells = cells.filter(c => c.type === 'SAND');
    const rockCells = cells.filter(c => c.type === 'ROCKS');

    let newCellsCount = 0;

    cells.forEach(cell => {
      const key = `${cell.x},${cell.y}`;
      const existing = this.knownCells.get(key);

      if (!existing) {
        newCellsCount++;
        cell.state = 'SEEN';
        this.knownCells.set(key, { ...cell });
      } else {
        if (this.currentPosition &&
            cell.x === this.currentPosition.x &&
            cell.y === this.currentPosition.y) {
          existing.state = 'KNOWN';
        }
        if (cell.zone !== undefined && existing.zone === undefined) {
          existing.zone = cell.zone;
        }
      }
    });

    if (newCellsCount > 0) {
      this.log(`📦 ${newCellsCount} nouvelles | ${seaCells.length}🌊 ${sandCells.length}🏝️ ${rockCells.length}🪨`);
    }

    await this.mapStore.addCells(cells, 'SEEN');

    // Détecter nouvelles îles
    const newSandCells = sandCells.filter(c => {
      const key = `${c.x},${c.y}`;
      const existing = this.knownCells.get(key);
      return !existing || existing.state === 'SEEN';
    });

    if (newSandCells.length > 0) {
      this.islandsDiscovered += newSandCells.length;
      this.log(`🏝️ ★★★ ÎLE DÉCOUVERTE! ${newSandCells.length} case(s) de sable! ★★★`, 'warn');

      await this.playerStore.fetchDetails();

      const discoveredIslands = this.playerStore.discoveredIslands?.filter(i => i.islandState === 'DISCOVERED') || [];
      if (discoveredIslands.length > 0) {
        this.log(`📋 À valider: ${discoveredIslands.map(i => i.island.name).join(', ')}`);
      }

      if (this.onDiscovery) {
        this.onDiscovery({ type: 'island', cells: newSandCells });
      }
    }

    // Valider cellule actuelle
    if (this.currentPosition) {
      const currentKey = `${this.currentPosition.x},${this.currentPosition.y}`;
      const currentCell = this.knownCells.get(currentKey);
      if (currentCell && currentCell.state !== 'KNOWN') {
        currentCell.state = 'KNOWN';
        await this.mapStore.addCells([{ ...currentCell, state: 'KNOWN' }], 'KNOWN');
      }
    }
  }

  // ─────────────────────── Utilities ───────────────────────

  getNextPosition(position, direction) {
    if (!position) return null;
    const vec = DIRECTION_VECTORS[direction];
    if (!vec) return null;
    return { x: position.x + vec.dx, y: position.y + vec.dy };
  }

  isOnIsland() {
    if (!this.currentPosition) return false;
    return this.currentPosition.type === 'SAND';
  }

  isDirectionBlocked(position, direction) {
    if (!position) return false;
    const key = `${position.x},${position.y}`;
    return this.blockedDirections.get(key)?.has(direction) || false;
  }

  markDirectionBlocked(position, direction) {
    if (!position) return;
    const key = `${position.x},${position.y}`;
    if (!this.blockedDirections.has(key)) {
      this.blockedDirections.set(key, new Set());
    }
    this.blockedDirections.get(key).add(direction);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default ExplorationBot;
