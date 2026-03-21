/**
 * ExplorationBot - Explorateur autonome avec algorithme BFS frontière
 *
 * Algorithme : Exploration par frontières avec pathfinding BFS
 *
 * 1. Multi-source BFS depuis toutes les îles (SAND) pour calculer la distance de retour
 * 2. BFS depuis la position actuelle pour trouver la meilleure frontière
 *    (cellule connue avec le plus de cellules inconnues à portée de vision)
 * 3. Score = valeur_découverte / (distance + 1) → maximise les découvertes par mouvement
 * 4. Exécute un seul pas par tick, puis re-planifie (adapte aux nouvelles découvertes)
 * 5. Quand l'énergie est critique, BFS vers l'île la plus proche
 *
 * Sécurité : maintient toujours assez d'énergie pour revenir à une île
 * Zones : les cellules de zone > niveau du bateau sont traitées comme des murs
 * Efficacité : re-planifie chaque mouvement pour un chemin optimal
 */

import { shipApi, playerApi } from '../api/client';
import { shipPositionApi, movesApi } from '../api/mapApi';

const CARDINAL_DIRECTIONS = ['N', 'E', 'S', 'W'];
const DIAGONAL_DIRECTIONS = ['NE', 'SE', 'SW', 'NW'];
const ALL_DIRECTIONS = [...CARDINAL_DIRECTIONS, ...DIAGONAL_DIRECTIONS];

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
      maxConsecutiveErrors: options.maxConsecutiveErrors ?? 5,
      useDiagonals: options.useDiagonals ?? false
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

    // Callbacks
    this.onStatusChange = null;
    this.onMove = null;
    this.onDiscovery = null;
    this.onError = null;
    this.onLog = null;

    // Error tracking
    this.consecutiveErrors = 0;
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

    this.log('🚀 Démarrage du bot d\'exploration (algorithme BFS frontière)');

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
    this.log(`🛡️ Buffer sécurité: ${this.config.safetyBuffer}`);
    this.log('═══════════════════════════════════════');
  }

  async discoverInitialPosition() {
    for (const direction of CARDINAL_DIRECTIONS) {
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
    this.log('🔁 Démarrage de la boucle principale (BFS frontière)');
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
          this.log(`🛑 ARRÊT: Trop d'erreurs consécutives!`, 'error');
          this.stop();
          break;
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

  /**
   * Extrait le numéro de niveau du bateau pour comparaison avec les zones.
   * Le bateau ne peut pas entrer dans une zone de niveau supérieur au sien.
   */
  extractShipLevel() {
    const levelName = this.shipStore?.shipLevel?.name || '';
    const match = levelName.match(/\d+/);
    if (match) return parseInt(match[0]);
    // Fallback: utiliser la zone de la position actuelle
    return this.currentPosition?.zone || 1;
  }

  /**
   * Retourne les directions disponibles selon la configuration.
   */
  getMovementDirections() {
    return this.config.useDiagonals ? ALL_DIRECTIONS : CARDINAL_DIRECTIONS;
  }

  /**
   * Vérifie si une cellule est traversable pour le pathfinding.
   * - Doit être connue (SEEN ou KNOWN)
   * - Pas un rocher
   * - Zone <= niveau du bateau
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
   * Permet de connaître en O(1) le coût de retour depuis n'importe quelle position.
   */
  computeIslandDistanceMap() {
    const distMap = new Map();
    const queue = [];
    const directions = this.getMovementDirections();

    // Initialiser avec toutes les cellules SAND à distance 0
    for (const [key, cell] of this.knownCells) {
      if (cell.type === 'SAND') {
        distMap.set(key, 0);
        queue.push({ x: cell.x, y: cell.y });
      }
    }

    // BFS outward depuis toutes les îles simultanément
    let head = 0;
    while (head < queue.length) {
      const { x, y } = queue[head++];
      const currentDist = distMap.get(`${x},${y}`);

      for (const dir of directions) {
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
   *
   * Une frontière = cellule connue et passable qui a des cellules inconnues
   * dans son rayon de visibilité (= on découvrira de nouvelles cases en y allant).
   *
   * Score = discoveryValue / (distance + 1) → maximise découvertes par mouvement
   *
   * Retourne { frontier, path, hasUnaffordableFrontiers } ou null si aucune frontière.
   */
  findBestFrontier(islandDistMap) {
    const pos = this.currentPosition;
    if (!pos) return null;

    const startKey = `${pos.x},${pos.y}`;
    const queue = [{ x: pos.x, y: pos.y }];
    const visited = new Map();
    visited.set(startKey, { parent: null, dir: null, dist: 0 });
    let head = 0;

    let bestFrontier = null;
    let bestScore = -1;
    let hasUnaffordableFrontiers = false;

    const directions = this.getMovementDirections();

    while (head < queue.length) {
      const { x, y } = queue[head++];
      const key = `${x},${y}`;
      const dist = visited.get(key).dist;

      // Vérifier si cette cellule est une frontière (a des inconnues à portée)
      if (dist > 0) {
        const discoveryValue = this.getDiscoveryValue(x, y);
        if (discoveryValue > 0) {
          const returnCost = islandDistMap.get(key) ?? Infinity;
          const totalCost = dist + returnCost + this.config.safetyBuffer;

          if (totalCost <= this.energy) {
            const score = discoveryValue / (dist + 1);
            if (score > bestScore) {
              bestScore = score;
              bestFrontier = { x, y, dist, score, discoveryValue, returnCost, totalCost, key };
            }
          } else {
            hasUnaffordableFrontiers = true;
          }
        }
      }

      // Aussi vérifier à distance 0 si on est déjà sur une frontière
      // (mais on ne la sélectionne pas comme cible - on est déjà dessus)
      // On vérifie quand même pour savoir si des frontières existent

      // Expansion BFS
      for (const dir of directions) {
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
    const path = [];
    let current = bestFrontier.key;
    while (visited.get(current).parent !== null) {
      const { parent, dir } = visited.get(current);
      path.unshift(dir);
      current = parent;
    }

    return { frontier: bestFrontier, path, hasUnaffordableFrontiers };
  }

  /**
   * BFS exact vers l'île la plus proche (cellule SAND).
   * Respecte les directions bloquées pour un chemin fiable.
   * Retourne { path: direction[], dist: number } ou null.
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

    const directions = this.getMovementDirections();

    while (head < queue.length) {
      const { x, y } = queue[head++];
      const key = `${x},${y}`;

      // Trouvé une île ?
      if (key !== startKey) {
        const cell = this.knownCells.get(key);
        if (cell && cell.type === 'SAND' && (cell.zone === undefined || cell.zone <= this.shipLevelNumber)) {
          const path = [];
          let c = key;
          while (visited.get(c).parent !== null) {
            const { parent, dir } = visited.get(c);
            path.unshift(dir);
            c = parent;
          }
          return { path, dist: path.length };
        }
      }

      for (const dir of directions) {
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
   * Moteur de décision principal.
   *
   * Priorités :
   * 1. Énergie critique → retour immédiat vers île
   * 2. Sur île + énergie insuffisante → attendre régénération
   * 3. Frontière trouvée et abordable → explorer
   * 4. Frontières inabordables → retourner à l'île pour recharger
   * 5. Aucune frontière → exploration terminée
   * 6. Pas d'île connue → exploration aléatoire prudente
   */
  decideNextAction() {
    const pos = this.currentPosition;
    if (!pos) return { type: 'wait', reason: 'no_position', duration: 5000 };

    // Calculer la carte de distances aux îles (multi-source BFS)
    const islandDistMap = this.computeIslandDistanceMap();
    const posKey = `${pos.x},${pos.y}`;
    const returnCostEstimate = islandDistMap.get(posKey) ?? Infinity;
    const hasKnownIsland = returnCostEstimate < Infinity;

    this.log(`📊 (${pos.x},${pos.y}) | ⚡${this.energy}/${this.maxEnergy} | 🏝️retour≈${hasKnownIsland ? returnCostEstimate : '∞'} | Lv${this.shipLevelNumber}`);

    // ─── 1. ÉNERGIE CRITIQUE : retour immédiat ───
    if (hasKnownIsland && returnCostEstimate > 0 && this.energy <= returnCostEstimate + this.config.safetyBuffer) {
      this.log(`⚠️ ÉNERGIE CRITIQUE (${this.energy} ≤ ${returnCostEstimate}+${this.config.safetyBuffer}) → RETOUR`, 'warn');
      const returnInfo = this.bfsToNearestIsland();
      if (returnInfo && returnInfo.path.length > 0) {
        return { type: 'move', direction: returnInfo.path[0], reason: 'retour_critique' };
      }
      // BFS n'a pas trouvé de chemin (directions bloquées) - tenter direction brute
      const bruteDir = this.getBruteDirectionToIsland(islandDistMap);
      if (bruteDir) {
        return { type: 'move', direction: bruteDir, reason: 'retour_brut' };
      }
    }

    // ─── 2. SUR UNE ÎLE ───
    if (this.isOnIsland()) {
      const result = this.findBestFrontier(islandDistMap);

      if (!result.frontier) {
        if (result.hasUnaffordableFrontiers) {
          // Il existe des frontières mais on n'a pas assez d'énergie
          this.log(`🔋 Recharge... frontières existent mais coût > énergie (${this.energy}/${this.maxEnergy})`);
          return { type: 'wait', reason: 'recharge_pour_frontière', duration: 3000 };
        }
        if (this.energy < this.maxEnergy) {
          // Pas de frontière visible, peut-être qu'avec plus d'énergie on pourra aller plus loin
          this.log(`🔋 Recharge complète en cours... (${this.energy}/${this.maxEnergy})`);
          return { type: 'wait', reason: 'recharge_exploration', duration: 3000 };
        }
        this.log(`✅ Exploration terminée ! Aucune frontière accessible.`);
        return { type: 'wait', reason: 'exploration_terminée', duration: 30000 };
      }

      // On a une frontière abordable
      if (this.energy < result.frontier.totalCost) {
        const needed = result.frontier.totalCost - this.energy;
        this.log(`🔋 Besoin de ${needed} énergie supp. pour (${result.frontier.x},${result.frontier.y}) [coût: ${result.frontier.totalCost}]`);
        return { type: 'wait', reason: 'recharge_cible', duration: 3000 };
      }

      this.log(`🎯 Frontière (${result.frontier.x},${result.frontier.y}) score=${result.frontier.score.toFixed(2)} disc=${result.frontier.discoveryValue} dist=${result.frontier.dist} ret=${result.frontier.returnCost}`);
      return { type: 'move', direction: result.path[0], reason: 'explorer' };
    }

    // ─── 3. PAS SUR UNE ÎLE : explorer ou retourner ───
    const result = this.findBestFrontier(islandDistMap);

    if (result.frontier) {
      this.log(`🎯 Frontière (${result.frontier.x},${result.frontier.y}) score=${result.frontier.score.toFixed(2)} disc=${result.frontier.discoveryValue} dist=${result.frontier.dist}`);
      return { type: 'move', direction: result.path[0], reason: 'explorer' };
    }

    // Pas de frontière abordable → retour à l'île pour recharger
    if (hasKnownIsland) {
      const returnInfo = this.bfsToNearestIsland();
      if (returnInfo && returnInfo.path.length > 0) {
        this.log(`↩️ Aucune frontière abordable → retour île (dist: ${returnInfo.dist})`);
        return { type: 'move', direction: returnInfo.path[0], reason: 'retour_recharge' };
      }
    }

    // ─── 4. PAS D'ÎLE CONNUE : exploration aléatoire prudente ───
    if (!hasKnownIsland) {
      this.log(`⚠️ Aucune île connue ! Exploration prudente...`, 'warn');
    }

    return this.getRandomExploreAction();
  }

  /**
   * Direction brute vers la zone de distance minimale sur la carte des îles.
   * Utilisé en dernier recours quand le BFS ne trouve pas de chemin.
   */
  getBruteDirectionToIsland(islandDistMap) {
    const pos = this.currentPosition;
    const directions = this.getMovementDirections();
    let bestDir = null;
    let bestDist = Infinity;

    for (const dir of directions) {
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

  /**
   * Action d'exploration aléatoire quand aucune stratégie BFS n'est disponible.
   * Priorise les cellules inconnues, puis les passables.
   */
  getRandomExploreAction() {
    const pos = this.currentPosition;
    const directions = this.getMovementDirections();

    // Priorité 1 : directions vers des cellules inconnues
    const unknownDirs = directions.filter(dir => {
      if (this.isDirectionBlocked(pos, dir)) return false;
      const vec = DIRECTION_VECTORS[dir];
      const nkey = `${pos.x + vec.dx},${pos.y + vec.dy}`;
      return !this.knownCells.has(nkey);
    });

    if (unknownDirs.length > 0) {
      const dir = unknownDirs[Math.floor(Math.random() * unknownDirs.length)];
      return { type: 'move', direction: dir, reason: 'exploration_aléatoire_inconnue' };
    }

    // Priorité 2 : directions passables (pas rochers, pas haute zone)
    const passableDirs = directions.filter(dir => {
      if (this.isDirectionBlocked(pos, dir)) return false;
      const vec = DIRECTION_VECTORS[dir];
      return this.isCellPassable(pos.x + vec.dx, pos.y + vec.dy);
    });

    if (passableDirs.length > 0) {
      const dir = passableDirs[Math.floor(Math.random() * passableDirs.length)];
      return { type: 'move', direction: dir, reason: 'exploration_aléatoire' };
    }

    // Priorité 3 : n'importe quelle direction non bloquée
    const unblockedDirs = directions.filter(dir => !this.isDirectionBlocked(pos, dir));
    if (unblockedDirs.length > 0) {
      const dir = unblockedDirs[Math.floor(Math.random() * unblockedDirs.length)];
      return { type: 'move', direction: dir, reason: 'tentative_désespérée' };
    }

    return { type: 'wait', reason: 'complètement_bloqué', duration: 5000 };
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
      const currentKey = `${data.position.x},${data.position.y}`;
      if (!this.knownCells.has(currentKey)) {
        this.knownCells.set(currentKey, {
          x: data.position.x,
          y: data.position.y,
          type: data.position.type,
          zone: data.position.zone,
          state: 'KNOWN'
        });
      }

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

      // Marquer direction bloquée si erreur de mouvement
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
              // Marquer la zone comme trop haute (on met shipLevelNumber + 1 pour qu'elle soit bloquée)
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
        // Si on est SUR la cellule, elle devient KNOWN
        if (this.currentPosition &&
            cell.x === this.currentPosition.x &&
            cell.y === this.currentPosition.y) {
          existing.state = 'KNOWN';
        }
        // Mettre à jour la zone si on ne l'avait pas
        if (cell.zone !== undefined && existing.zone === undefined) {
          existing.zone = cell.zone;
        }
      }
    });

    if (newCellsCount > 0) {
      this.log(`📦 ${newCellsCount} nouvelles | ${seaCells.length}🌊 ${sandCells.length}🏝️ ${rockCells.length}🪨`);
    }

    // Sauvegarder dans le mapStore
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
