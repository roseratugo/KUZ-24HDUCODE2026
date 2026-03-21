/**
 * ExplorationBot - Bot d'exploration automatique de la carte
 *
 * Stratégie :
 * 1. Explorer en spirale depuis la position actuelle
 * 2. Quand on découvre une île (DISCOVERED), on la note comme cible
 * 3. On continue jusqu'à avoir assez d'énergie pour retourner à une île KNOWN
 * 4. On retourne à l'île KNOWN la plus proche pour régénérer et valider les découvertes
 * 5. Si on a des îles DISCOVERED non validées, on y va pour les valider (KNOWN)
 * 6. On recommence l'exploration
 *
 * Gestion des bords :
 * - Si un mouvement échoue (bord de zone), on marque la direction comme bloquée
 * - On ajuste la spirale pour contourner les obstacles
 */

import { shipApi, playerApi } from '../api/client';
import { shipPositionApi, movesApi } from '../api/mapApi';

// Directions cardinales uniquement (pas de diagonales au début)
const CARDINAL_DIRECTIONS = ['N', 'E', 'S', 'W'];
const DIAGONAL_DIRECTIONS = ['NE', 'SE', 'SW', 'NW'];
const ALL_DIRECTIONS = [...CARDINAL_DIRECTIONS, ...DIAGONAL_DIRECTIONS];

const DIRECTION_VECTORS = {
  'N': { dx: 0, dy: -1 },
  'S': { dx: 0, dy: 1 },
  'E': { dx: 1, dy: 0 },
  'W': { dx: -1, dy: 0 },
  'NE': { dx: 1, dy: -1 },
  'NW': { dx: -1, dy: -1 },
  'SE': { dx: 1, dy: 1 },
  'SW': { dx: -1, dy: 1 }
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
      minEnergyReserve: options.minEnergyReserve || 3, // Énergie min pour retour
      moveDelay: options.moveDelay || 100, // Délai supplémentaire entre mouvements
      maxConsecutiveErrors: options.maxConsecutiveErrors || 5,
      explorationPattern: options.explorationPattern || 'linear' // linear, spiral, random
    };

    // État interne
    this.currentPosition = null;
    this.energy = 0;
    this.maxEnergy = 0;
    this.visibilityRange = 1;
    this.shipSpeed = 5000;
    this.canMoveDiagonally = false; // Par défaut, pas de diagonales

    // Carte connue
    this.knownCells = new Map(); // key: "x,y" -> cell data
    this.knownIslands = []; // Îles où on peut régénérer
    this.discoveredIslands = []; // Îles découvertes mais pas encore validées
    this.blockedDirections = new Map(); // key: "x,y" -> Set of blocked directions

    // Exploration state
    this.spiralStep = 0;
    this.spiralDirection = 0;
    this.spiralLength = 1;
    this.spiralCount = 0;
    this.homeIsland = null;

    // Linear exploration state
    this.currentDirection = 'E'; // Direction actuelle (commence vers l'Est)
    this.directionIndex = 0; // Index dans l'ordre des directions

    // Callbacks
    this.onStatusChange = null;
    this.onMove = null;
    this.onDiscovery = null;
    this.onError = null;
    this.onLog = null;

    // Error tracking
    this.consecutiveErrors = 0;
  }

  log(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = { timestamp, message, type };
    console.log(`[ExplorationBot ${timestamp}] ${message}`);
    if (this.onLog) this.onLog(logEntry);
  }

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

    this.log('🚀 Démarrage du bot d\'exploration');

    try {
      // Charger l'état initial
      await this.loadInitialState();

      // Vérifier qu'on a une position valide
      if (!this.currentPosition) {
        this.log('❌ ERREUR: Pas de position de bateau! As-tu construit ton bateau?', 'error');
        this.log('💡 Va dans l\'onglet "Carte & Navigation" et construis ton bateau d\'abord.', 'warn');
        this.stop();
        return;
      }

      // Boucle principale
      await this.runLoop();
    } catch (err) {
      this.log(`❌ ERREUR FATALE au démarrage: ${err.message}`, 'error');
      this.log(`📋 Stack: ${err.stack}`, 'error');
      this.stop();
      throw err;
    }
  }

  async loadInitialState() {
    try {
      this.log('📥 Chargement de l\'état initial...');

      // Récupérer les détails du joueur pour avoir l'énergie et le niveau
      this.log('📡 Récupération des détails joueur...');
      await this.playerStore.fetchDetails();
      this.log('✓ Détails joueur récupérés');

      // Vérifier si le joueur a un bateau
      if (!this.playerStore.details) {
        this.log('❌ Pas de détails joueur disponibles!', 'error');
        throw new Error('Impossible de récupérer les détails du joueur');
      }

      this.log(`👤 Joueur: ${this.playerStore.details.name || 'Inconnu'}`);
      this.log(`💰 Argent: ${this.playerStore.details.money || 0}`);

      // Debug: afficher l'état du shipStore
      this.log('🚢 Vérification du bateau...');
      this.log(`   shipStore.position: ${JSON.stringify(this.shipStore.position)}`);
      this.log(`   shipStore.energy: ${this.shipStore.energy}`);
      this.log(`   shipStore.maxEnergy: ${this.shipStore.maxEnergy}`);
      this.log(`   shipStore.shipLevel: ${JSON.stringify(this.shipStore.shipLevel)}`);
      this.log(`   shipStore.hasShip: ${this.shipStore.hasShip}`);

      this.currentPosition = this.shipStore.position;
      this.energy = this.shipStore.energy;
      this.maxEnergy = this.shipStore.maxEnergy;
      this.visibilityRange = this.shipStore.shipLevel?.visibilityRange || 1;
      this.shipSpeed = this.shipStore.shipLevel?.speed || 5000;

      // Vérifier si on a une position
      if (!this.currentPosition) {
        this.log('⚠️ Pas de position dans shipStore, vérification des détails joueur...', 'warn');
        // Essayer de récupérer depuis les détails du joueur
        const ship = this.playerStore.details?.ship;
        if (ship?.currentPosition) {
          this.currentPosition = ship.currentPosition;
          this.energy = ship.availableMove || 0;
          this.maxEnergy = ship.level?.maxMovement || 100;
          this.visibilityRange = ship.level?.visibilityRange || 1;
          this.shipSpeed = ship.level?.speed || 5000;
          this.log(`✓ Position récupérée depuis détails: (${this.currentPosition.x}, ${this.currentPosition.y})`);
        } else {
          // Pas de position connue, faire un mouvement initial pour la découvrir
          this.log('🎲 Position inconnue, mouvement initial pour la découvrir...', 'warn');
          await this.discoverInitialPosition();
        }
      }

      // Charger les îles connues depuis le playerStore
      const discoveredIslands = this.playerStore.discoveredIslands || [];
      this.knownIslands = discoveredIslands
        .filter(i => i.islandState === 'KNOWN')
        .map(i => i.island);
      this.discoveredIslands = discoveredIslands
        .filter(i => i.islandState === 'DISCOVERED')
        .map(i => i.island);

      // Home island
      this.homeIsland = this.playerStore.homeIsland;

      // Charger les cellules connues depuis le mapStore
      await this.mapStore.loadFromDB();
      this.mapStore.allCells.forEach(cell => {
        this.knownCells.set(`${cell.x},${cell.y}`, cell);
      });

      this.log('═══════════════════════════════════════');
      this.log(`📍 Position: (${this.currentPosition?.x}, ${this.currentPosition?.y})`);
      this.log(`⚡ Énergie: ${this.energy}/${this.maxEnergy}`);
      this.log(`👁️ Vision: ${this.visibilityRange} case(s)`);
      this.log(`⏱️ Cooldown: ${this.shipSpeed}ms`);
      this.log(`🗺️ Cellules connues: ${this.knownCells.size}`);
      this.log(`🏝️ Îles KNOWN: ${this.knownIslands.length}`);
      this.log(`🔍 Îles DISCOVERED: ${this.discoveredIslands.length}`);
      this.log(`🏠 Île de départ: ${this.homeIsland?.name || 'Inconnue'}`);
      this.log('═══════════════════════════════════════');
    } catch (err) {
      this.log(`❌ Erreur chargement état initial: ${err.message}`, 'error');
      throw err;
    }
  }

  getAvailableDirections() {
    return this.canMoveDiagonally ? ALL_DIRECTIONS : CARDINAL_DIRECTIONS;
  }

  async discoverInitialPosition() {
    // Essayer de bouger dans une direction (cardinales d'abord)
    const directions = CARDINAL_DIRECTIONS;

    for (const direction of directions) {
      try {
        this.log(`🎲 Tentative mouvement ${direction}...`);
        const response = await shipApi.move(direction);
        const data = response.data;

        // Succès ! On a notre position
        this.currentPosition = data.position;
        this.energy = data.energy;

        this.log(`✅ Position découverte: (${data.position.x}, ${data.position.y})`);
        this.log(`⚡ Énergie restante: ${data.energy}`);

        // Mettre à jour le store
        this.shipStore.updateFromMoveResponse(data);

        // Sauvegarder la position dans la DB
        if (data.position) {
          shipPositionApi.save(data.position).catch(err => {
            this.log(`⚠️ Erreur sauvegarde position DB: ${err.message}`, 'warn');
          });
        }

        // Traiter les cellules découvertes
        if (data.discoveredCells && data.discoveredCells.length > 0) {
          this.cellsDiscovered += data.discoveredCells.length;
          this.log(`👁️ ${data.discoveredCells.length} cellule(s) découverte(s)`);
          await this.processDiscoveredCells(data.discoveredCells);
        }

        // Attendre le cooldown
        this.log(`⏱️ Attente cooldown ${this.shipSpeed}ms...`);
        await this.sleep(this.shipSpeed + 100);

        return; // Succès, on sort
      } catch (err) {
        const errMsg = err.response?.data?.message || err.message;
        this.log(`⚠️ Direction ${direction} échouée: ${errMsg}`, 'warn');
        // Continuer avec la prochaine direction
      }
    }

    // Si toutes les directions ont échoué
    this.log(`❌ Impossible de découvrir la position (toutes directions bloquées)`, 'error');
    throw new Error('Impossible de découvrir la position initiale');
  }

  async runLoop() {
    this.log('🔁 Démarrage de la boucle principale');
    let tickCount = 0;

    while (this.isRunning) {
      if (this.isPaused) {
        await this.sleep(1000);
        continue;
      }

      tickCount++;
      this.log(`━━━━━━━━━━━━━ TICK #${tickCount} ━━━━━━━━━━━━━`);

      try {
        await this.executeTick();
        this.consecutiveErrors = 0;
      } catch (err) {
        this.consecutiveErrors++;
        const errMsg = err.response?.data?.message || err.message;
        const errCode = err.response?.data?.codeError || '';

        this.log(`❌ Erreur tick #${tickCount}: ${errCode ? `[${errCode}] ` : ''}${errMsg}`, 'error');
        this.log(`⚠️ Erreurs consécutives: ${this.consecutiveErrors}/${this.config.maxConsecutiveErrors}`, 'warn');

        // Log détaillé pour debug
        if (err.response) {
          this.log(`📋 Réponse API: ${JSON.stringify(err.response.data)}`, 'error');
        }

        if (this.consecutiveErrors >= this.config.maxConsecutiveErrors) {
          this.log(`🛑 ARRÊT: Trop d'erreurs consécutives!`, 'error');
          this.stop();
          break;
        }

        // Attendre un peu avant de réessayer
        this.log(`⏳ Pause de 2s avant réessai...`);
        await this.sleep(2000);
      }
    }

    this.log('🏁 Boucle principale terminée');
  }

  async executeTick() {
    // Mettre à jour l'état depuis les stores
    await this.refreshState();

    // Vérifier si on est en cooldown
    if (this.shipStore.isOnCooldown) {
      const waitTime = this.shipStore.cooldownRemaining + 100;
      this.log(`⏱️ Cooldown actif: attente ${Math.ceil(waitTime/1000)}s...`);
      await this.sleep(waitTime);
      return;
    }

    // Décider de l'action à faire
    this.log(`🤔 Analyse de la situation...`);
    const action = this.decideNextAction();

    if (action.type === 'wait') {
      this.log(`💤 Action: ATTENTE (${action.reason}) - ${action.duration || 5000}ms`);
      await this.sleep(action.duration || 5000);
      return;
    }

    if (action.type === 'move') {
      this.log(`🎯 Action: MOUVEMENT ${action.direction} (raison: ${action.reason})`);
      await this.executeMove(action.direction);
    }
  }

  async refreshState() {
    // Rafraîchir depuis l'API pour avoir l'énergie à jour (surtout sur les îles)
    try {
      await this.playerStore.fetchDetails();

      // Mettre à jour depuis le shipStore (qui est mis à jour par fetchDetails)
      this.currentPosition = this.shipStore.position || this.currentPosition;
      this.energy = this.shipStore.energy;
      this.maxEnergy = this.shipStore.maxEnergy;

      // Log si l'énergie a changé
      this.log(`🔄 Refresh: Énergie ${this.energy}/${this.maxEnergy}`);
    } catch (err) {
      this.log(`⚠️ Erreur refresh état: ${err.message}`, 'warn');
    }

    // Actualiser les îles
    const discoveredIslands = this.playerStore.discoveredIslands || [];
    this.knownIslands = discoveredIslands
      .filter(i => i.islandState === 'KNOWN')
      .map(i => i.island);
    this.discoveredIslands = discoveredIslands
      .filter(i => i.islandState === 'DISCOVERED')
      .map(i => i.island);
  }

  decideNextAction() {
    const pos = this.currentPosition;
    const posStr = pos ? `(${pos.x}, ${pos.y})` : '?';

    // 1. Si énergie critique ET on connaît une île, retourner à une île connue
    const distanceToNearestKnownIsland = this.getDistanceToNearestKnownIsland();

    // Si on ne connaît pas d'île (Infinity), on explore sans contrainte d'énergie
    const hasKnownIsland = distanceToNearestKnownIsland < Infinity;
    const safetyMargin = hasKnownIsland
      ? Math.max(this.config.minEnergyReserve, distanceToNearestKnownIsland + 2)
      : this.config.minEnergyReserve;

    this.log(`📊 État: Pos ${posStr} | Énergie ${this.energy}/${this.maxEnergy} | Dist île: ${hasKnownIsland ? distanceToNearestKnownIsland : '∞ (aucune connue)'} | Marge: ${safetyMargin}`);

    // Seulement vérifier l'énergie critique si on connaît une île où aller
    if (hasKnownIsland && this.energy <= safetyMargin && distanceToNearestKnownIsland > 0) {
      this.log(`⚠️ ALERTE: Énergie critique (${this.energy} <= ${safetyMargin}), RETOUR vers île connue`, 'warn');
      const direction = this.getDirectionToNearestKnownIsland();
      if (direction) {
        this.log(`🔙 Direction retour: ${direction}`);
        return { type: 'move', direction, reason: 'return_to_island' };
      } else {
        this.log(`❌ Impossible de trouver une direction vers une île!`, 'error');
      }
    }

    // Si énergie très basse et pas d'île connue, avertir mais continuer
    if (!hasKnownIsland && this.energy <= this.config.minEnergyReserve) {
      this.log(`⚠️ Énergie basse (${this.energy}) mais pas d'île connue - exploration risquée!`, 'warn');
    }

    // 2. Si on est sur une île, on régénère
    if (this.isOnIsland()) {
      this.log(`🏝️ Sur une île (type: ${this.currentPosition?.type})`);

      // Vérifier si on a des îles DISCOVERED à valider
      if (this.discoveredIslands.length > 0) {
        this.log(`📋 ${this.discoveredIslands.length} île(s) DISCOVERED à valider`);
        const energyThreshold = Math.floor(this.maxEnergy * 0.8);

        if (this.energy >= energyThreshold) {
          this.log(`✅ Énergie suffisante (${this.energy} >= ${energyThreshold}), départ pour validation`);
          const direction = this.getDirectionToNearestDiscoveredIsland();
          if (direction) {
            this.log(`🎯 Direction vers île à valider: ${direction}`);
            return { type: 'move', direction, reason: 'validate_island' };
          } else {
            this.log(`⚠️ Pas de direction trouvée vers île DISCOVERED`, 'warn');
          }
        } else {
          this.log(`⏳ Régénération en cours... (${this.energy}/${energyThreshold} requis)`);
        }
      }

      // Attendre de régénérer si énergie basse
      if (this.energy < this.maxEnergy * 0.8) {
        const needed = Math.floor(this.maxEnergy * 0.8) - this.energy;
        this.log(`🔋 Régénération: besoin de ${needed} énergie supplémentaire`);
        return { type: 'wait', reason: 'regenerating', duration: 3000 };
      }

      this.log(`✨ Énergie pleine, prêt à explorer!`);
    }

    // 3. Explorer selon le pattern
    this.log(`🧭 Mode exploration (pattern: ${this.config.explorationPattern})`);
    const direction = this.getNextExplorationDirection();
    if (direction) {
      this.log(`➡️ Direction exploration: ${direction}`);
      return { type: 'move', direction, reason: 'explore' };
    }

    // 4. Si aucune direction disponible, retourner à la maison
    this.log(`⚠️ Aucune direction d'exploration disponible, retour maison`, 'warn');
    const homeDirection = this.getDirectionToHome();
    if (homeDirection) {
      this.log(`🏠 Direction maison: ${homeDirection}`);
      return { type: 'move', direction: homeDirection, reason: 'return_home' };
    }

    this.log(`❌ Aucune action possible - bloqué!`, 'error');
    return { type: 'wait', reason: 'no_action_available', duration: 5000 };
  }

  async executeMove(direction) {
    const fromPos = this.currentPosition;
    const fromPosStr = fromPos ? `(${fromPos.x}, ${fromPos.y})` : '?';

    try {
      this.log(`🚢 MOUVEMENT: ${direction} depuis ${fromPosStr}`);

      const response = await shipApi.move(direction);
      const data = response.data;

      this.actionsCount++;

      // Mettre à jour l'état local
      const oldEnergy = this.energy;
      this.currentPosition = data.position;
      this.energy = data.energy;

      const newPosStr = `(${data.position.x}, ${data.position.y})`;
      const energyDiff = data.energy - oldEnergy;
      const energySign = energyDiff >= 0 ? '+' : '';

      this.log(`✅ OK: ${fromPosStr} → ${newPosStr} | Énergie: ${oldEnergy} → ${data.energy} (${energySign}${energyDiff})`);

      // Mettre à jour le store
      this.shipStore.updateFromMoveResponse(data);

      // Sauvegarder la position dans la DB
      if (data.position) {
        shipPositionApi.save(data.position).catch(err => {
          this.log(`⚠️ Erreur sauvegarde position DB: ${err.message}`, 'warn');
        });
      }

      // Sauvegarder le mouvement dans la DB
      const moveRecord = {
        direction,
        fromPosition: fromPos,
        toPosition: data.position,
        energyBefore: oldEnergy,
        energyAfter: data.energy,
        cellsDiscovered: data.discoveredCells?.length || 0,
        timestamp: new Date().toISOString()
      };
      movesApi.save(moveRecord).catch(err => {
        this.log(`⚠️ Erreur sauvegarde mouvement DB: ${err.message}`, 'warn');
      });

      // Traiter les cellules découvertes
      if (data.discoveredCells && data.discoveredCells.length > 0) {
        this.cellsDiscovered += data.discoveredCells.length;
        this.log(`👁️ ${data.discoveredCells.length} nouvelle(s) cellule(s) visible(s)`);
        await this.processDiscoveredCells(data.discoveredCells);
      }

      // Attendre le cooldown + délai configuré
      const waitTime = this.shipSpeed + this.config.moveDelay;
      this.log(`⏱️ Cooldown: ${waitTime}ms...`);
      await this.sleep(waitTime);

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

      this.log(`❌ ERREUR mouvement ${direction}: [${errorCode}] ${errorMsg}`, 'error');

      // Si c'est une erreur de mouvement bloqué, marquer la direction
      if (errorMsg.toLowerCase().includes('impossible') ||
          errorMsg.toLowerCase().includes('blocked') ||
          errorMsg.toLowerCase().includes('cannot') ||
          errorMsg.toLowerCase().includes('zone') ||
          errorCode.includes('BLOCKED') ||
          errorCode.includes('ZONE')) {
        this.markDirectionBlocked(this.currentPosition, direction);
        this.log(`🚫 Direction ${direction} marquée BLOQUÉE à ${fromPosStr}`, 'warn');
        this.log(`📋 Directions bloquées ici: ${this.getBlockedDirectionsAt(this.currentPosition)}`, 'warn');
      }

      throw err;
    }
  }

  getBlockedDirectionsAt(position) {
    if (!position) return 'aucune';
    const key = `${position.x},${position.y}`;
    const blocked = this.blockedDirections.get(key);
    if (!blocked || blocked.size === 0) return 'aucune';
    return Array.from(blocked).join(', ');
  }

  async processDiscoveredCells(cells) {
    // Compter les types de cellules
    const seaCells = cells.filter(c => c.type === 'SEA');
    const sandCells = cells.filter(c => c.type === 'SAND');
    const rockCells = cells.filter(c => c.type === 'ROCKS');

    // Compter les nouvelles cellules (jamais vues avant)
    let newCellsCount = 0;
    let updatedCellsCount = 0;

    cells.forEach(cell => {
      const key = `${cell.x},${cell.y}`;
      const existingCell = this.knownCells.get(key);

      if (!existingCell) {
        // Nouvelle cellule jamais vue
        newCellsCount++;
        cell.state = 'SEEN'; // Marquer comme vue
        this.knownCells.set(key, cell);
      } else {
        // Cellule déjà connue - on la revisite
        updatedCellsCount++;
        // Si on est SUR la cellule (position actuelle), elle devient KNOWN
        if (this.currentPosition &&
            cell.x === this.currentPosition.x &&
            cell.y === this.currentPosition.y) {
          existingCell.state = 'KNOWN';
          this.log(`✅ Cellule (${cell.x},${cell.y}) validée → KNOWN`);
        }
      }
    });

    // Log résumé
    this.log(`📦 Cellules: ${newCellsCount} nouvelles, ${updatedCellsCount} revisitées`);
    this.log(`   📊 Types: ${seaCells.length} MER, ${sandCells.length} SABLE, ${rockCells.length} ROCHERS`);

    // Sauvegarder dans le mapStore
    await this.mapStore.addCells(cells, 'SEEN');

    // Vérifier si on a découvert des NOUVELLES îles (cases SAND jamais vues)
    const newSandCells = sandCells.filter(c => {
      const key = `${c.x},${c.y}`;
      // C'est une nouvelle île si on ne l'avait pas dans knownCells avant ce tick
      return !this.knownCells.has(key) || this.knownCells.get(key).state === 'SEEN';
    });

    if (newSandCells.length > 0) {
      this.islandsDiscovered += newSandCells.length;
      this.log(`🏝️ ★★★ ÎLE DÉCOUVERTE! ${newSandCells.length} case(s) de sable! ★★★`, 'warn');

      // Refresh pour avoir les îles mises à jour
      await this.playerStore.fetchDetails();

      // Log les îles DISCOVERED (non validées)
      const discoveredIslands = this.playerStore.discoveredIslands?.filter(i => i.islandState === 'DISCOVERED') || [];
      const knownIslands = this.playerStore.discoveredIslands?.filter(i => i.islandState === 'KNOWN') || [];

      this.log(`🔍 Îles: ${discoveredIslands.length} DISCOVERED, ${knownIslands.length} KNOWN`);

      if (discoveredIslands.length > 0) {
        this.log(`   📋 À valider: ${discoveredIslands.map(i => i.island.name).join(', ')}`);
      }

      if (this.onDiscovery) {
        this.onDiscovery({ type: 'island', cells: newSandCells });
      }
    }

    // Mettre à jour la cellule actuelle comme KNOWN (on est dessus)
    if (this.currentPosition) {
      const currentKey = `${this.currentPosition.x},${this.currentPosition.y}`;
      const currentCell = this.knownCells.get(currentKey);
      if (currentCell && currentCell.state !== 'KNOWN') {
        currentCell.state = 'KNOWN';
        this.log(`✅ Position actuelle (${this.currentPosition.x},${this.currentPosition.y}) → KNOWN`);

        // Sauvegarder le changement d'état
        await this.mapStore.addCells([{ ...currentCell, state: 'KNOWN' }], 'KNOWN');
      }
    }
  }

  getNextExplorationDirection() {
    // Pattern linéaire : continuer en ligne droite jusqu'à obstacle
    if (this.config.explorationPattern === 'linear') {
      return this.getLinearDirection();
    }

    // Pattern spirale
    if (this.config.explorationPattern === 'spiral') {
      // Priorité 1: Aller vers une cellule INCONNUE (jamais vue)
      const unknownDir = this.getDirectionToUnknownCell();
      if (unknownDir) {
        this.log(`🔭 Direction vers cellule inconnue: ${unknownDir}`);
        return unknownDir;
      }

      // Priorité 2: Aller vers une cellule SEEN (vue mais pas validée)
      const seenDir = this.getDirectionToSeenCell();
      if (seenDir) {
        this.log(`👁️ Direction vers cellule SEEN (à valider): ${seenDir}`);
        return seenDir;
      }

      return this.getSpiralDirection();
    }

    // Fallback: direction aléatoire
    return this.getRandomUnblockedDirection();
  }

  // Exploration linéaire : va tout droit jusqu'à un obstacle, puis tourne
  getLinearDirection() {
    const directions = ['E', 'S', 'W', 'N']; // Ordre de rotation

    // Vérifier si on peut continuer dans la direction actuelle
    if (this.canMoveInDirection(this.currentDirection)) {
      this.log(`➡️ Continue en ligne droite: ${this.currentDirection}`);
      return this.currentDirection;
    }

    // Direction bloquée, chercher une nouvelle direction
    this.log(`🚧 Direction ${this.currentDirection} bloquée, recherche alternative...`);

    // Essayer de tourner (dans l'ordre: droite, gauche, demi-tour)
    const currentIdx = directions.indexOf(this.currentDirection);
    const turnOrder = [
      directions[(currentIdx + 1) % 4], // Tourner à droite
      directions[(currentIdx + 3) % 4], // Tourner à gauche
      directions[(currentIdx + 2) % 4]  // Demi-tour
    ];

    for (const newDir of turnOrder) {
      if (this.canMoveInDirection(newDir)) {
        this.currentDirection = newDir;
        this.log(`🔄 Nouvelle direction: ${newDir}`);
        return newDir;
      }
    }

    // Toutes les directions sont bloquées
    this.log(`❌ Toutes les directions sont bloquées!`, 'error');
    return null;
  }

  // Vérifie si on peut bouger dans une direction
  canMoveInDirection(direction) {
    // Vérifie si la direction n'est pas bloquée (bord de zone)
    if (this.isDirectionBlocked(this.currentPosition, direction)) {
      return false;
    }

    // Vérifie si la cellule destination n'est pas un obstacle (rochers)
    const nextPos = this.getNextPosition(this.currentPosition, direction);
    if (nextPos) {
      const cell = this.knownCells.get(`${nextPos.x},${nextPos.y}`);
      // Si la cellule est connue et c'est un rocher, on ne peut pas y aller
      if (cell && cell.type === 'ROCKS') {
        return false;
      }
    }

    return true;
  }

  // Trouver une direction vers une cellule jamais vue
  getDirectionToUnknownCell() {
    const availableDirs = this.getAvailableDirections();

    // Filtrer les directions non bloquées qui mènent à des cellules inconnues
    const unknownDirs = availableDirs.filter(dir => {
      if (this.isDirectionBlocked(this.currentPosition, dir)) return false;
      const nextPos = this.getNextPosition(this.currentPosition, dir);
      const key = `${nextPos.x},${nextPos.y}`;
      return !this.knownCells.has(key);
    });

    if (unknownDirs.length === 0) return null;

    // Préférer la direction de la spirale si elle est disponible
    const spiralOrder = ['E', 'S', 'W', 'N'];
    const preferredDir = spiralOrder[this.spiralDirection % spiralOrder.length];
    if (unknownDirs.includes(preferredDir)) {
      this.advanceSpiral();
      return preferredDir;
    }

    // Sinon prendre la première direction disponible dans l'ordre de la spirale
    for (const dir of spiralOrder) {
      if (unknownDirs.includes(dir)) {
        return dir;
      }
    }

    return unknownDirs[0];
  }

  // Trouver une direction vers une cellule SEEN (vue mais pas KNOWN)
  getDirectionToSeenCell() {
    const availableDirs = this.getAvailableDirections();

    // Chercher les cellules SEEN (non validées) adjacentes
    const seenDirs = availableDirs.filter(dir => {
      if (this.isDirectionBlocked(this.currentPosition, dir)) return false;
      const nextPos = this.getNextPosition(this.currentPosition, dir);
      const key = `${nextPos.x},${nextPos.y}`;
      const cell = this.knownCells.get(key);
      // Une cellule est à valider si elle est SEEN (et non KNOWN)
      return cell && cell.state === 'SEEN';
    });

    if (seenDirs.length === 0) return null;

    // Préférer les cellules SAND (îles) à valider
    for (const dir of seenDirs) {
      const nextPos = this.getNextPosition(this.currentPosition, dir);
      const cell = this.knownCells.get(`${nextPos.x},${nextPos.y}`);
      if (cell && cell.type === 'SAND') {
        this.log(`🏝️ Île SEEN à valider en direction ${dir}`);
        return dir;
      }
    }

    return seenDirs[0];
  }

  advanceSpiral() {
    this.spiralStep++;
    this.spiralCount++;

    if (this.spiralCount >= this.spiralLength) {
      this.spiralCount = 0;
      this.spiralDirection++;

      // Augmenter la longueur tous les 2 changements de direction
      if (this.spiralDirection % 2 === 0) {
        this.spiralLength++;
      }
    }
  }

  getSpiralDirection() {
    // Directions dans l'ordre de la spirale (cardinales uniquement si pas de diagonales)
    const spiralOrder = this.canMoveDiagonally
      ? ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE']
      : ['E', 'S', 'W', 'N'];

    // Calculer la direction suivante dans la spirale
    let direction = spiralOrder[this.spiralDirection % spiralOrder.length];

    // Vérifier si cette direction est bloquée
    if (this.isDirectionBlocked(this.currentPosition, direction)) {
      this.log(`🔄 Direction spirale ${direction} bloquée, recherche alternative...`);
      // Essayer les autres directions
      for (const dir of spiralOrder) {
        if (!this.isDirectionBlocked(this.currentPosition, dir)) {
          direction = dir;
          this.log(`🔄 Alternative trouvée: ${dir}`);
          break;
        }
      }
    }

    // Avancer dans la spirale
    this.advanceSpiral();

    this.log(`🌀 Spirale: step=${this.spiralStep}, dir=${this.spiralDirection}, len=${this.spiralLength}, count=${this.spiralCount}`);

    // Vérifier si la direction calculée est dans les directions non bloquées
    if (this.isDirectionBlocked(this.currentPosition, direction)) {
      this.log(`⚠️ Toutes directions spirale bloquées, mode aléatoire`, 'warn');
      return this.getRandomUnblockedDirection();
    }

    return direction;
  }

  getRandomUnblockedDirection() {
    const availableDirs = this.getAvailableDirections();
    const unblockedDirs = availableDirs.filter(d =>
      !this.isDirectionBlocked(this.currentPosition, d)
    );

    this.log(`🎲 Directions disponibles: ${unblockedDirs.join(', ') || 'AUCUNE'}`);

    if (unblockedDirs.length === 0) {
      this.log(`❌ BLOQUÉ: Aucune direction disponible!`, 'error');
      return null;
    }

    // Préférer les directions vers des cellules non explorées
    const unexploredDirs = unblockedDirs.filter(d => {
      const nextPos = this.getNextPosition(this.currentPosition, d);
      return !this.knownCells.has(`${nextPos.x},${nextPos.y}`);
    });

    if (unexploredDirs.length > 0) {
      const chosen = unexploredDirs[Math.floor(Math.random() * unexploredDirs.length)];
      this.log(`🎯 Vers zone inexplorée: ${chosen} (parmi ${unexploredDirs.join(', ')})`);
      return chosen;
    }

    // Préférer les cellules SEEN (à valider)
    const seenDirs = unblockedDirs.filter(d => {
      const nextPos = this.getNextPosition(this.currentPosition, d);
      const cell = this.knownCells.get(`${nextPos.x},${nextPos.y}`);
      return cell && cell.state === 'SEEN';
    });

    if (seenDirs.length > 0) {
      const chosen = seenDirs[Math.floor(Math.random() * seenDirs.length)];
      this.log(`👁️ Vers zone SEEN: ${chosen}`);
      return chosen;
    }

    const chosen = unblockedDirs[Math.floor(Math.random() * unblockedDirs.length)];
    this.log(`🔀 Direction aléatoire: ${chosen} (zone déjà KNOWN)`);
    return chosen;
  }

  getDirectionToNearestKnownIsland() {
    if (!this.currentPosition) return null;

    // Trouver la cellule d'île la plus proche (peu importe l'état)
    let nearestIslandCell = null;
    let minDistance = Infinity;

    // Chercher d'abord dans les cellules SAND connues
    for (const [key, cell] of this.knownCells) {
      if (cell.type === 'SAND') {
        const dist = this.getDistance(this.currentPosition, cell);
        if (dist < minDistance) {
          minDistance = dist;
          nearestIslandCell = cell;
        }
      }
    }

    if (nearestIslandCell) {
      this.log(`🏝️ Île la plus proche: (${nearestIslandCell.x}, ${nearestIslandCell.y}) à ${minDistance} cases`);
      return this.getDirectionTo(this.currentPosition, nearestIslandCell);
    }

    // Sinon essayer homeIsland
    if (this.homeIsland && this.homeIsland.x !== undefined) {
      this.log(`🏠 Retour vers home island: (${this.homeIsland.x}, ${this.homeIsland.y})`);
      return this.getDirectionTo(this.currentPosition, this.homeIsland);
    }

    // Sinon essayer les îles du playerStore
    for (const island of this.knownIslands) {
      if (island.x !== undefined && island.y !== undefined) {
        this.log(`🏝️ Direction vers île connue: ${island.name || 'inconnue'}`);
        return this.getDirectionTo(this.currentPosition, island);
      }
    }

    this.log(`⚠️ Aucune île trouvée pour navigation`, 'warn');
    return null;
  }

  getDistanceToNearestKnownIsland() {
    if (!this.currentPosition) return Infinity;

    let minDistance = Infinity;
    let foundIsland = null;

    // Chercher dans les cellules connues
    for (const [key, cell] of this.knownCells) {
      if (cell.type === 'SAND') {
        const dist = this.getDistance(this.currentPosition, cell);
        if (dist < minDistance) {
          minDistance = dist;
          foundIsland = cell;
        }
      }
    }

    // Si on n'a pas trouvé d'île dans knownCells, utiliser homeIsland
    if (minDistance === Infinity && this.homeIsland) {
      // Home island a des coordonnées
      if (this.homeIsland.x !== undefined && this.homeIsland.y !== undefined) {
        minDistance = this.getDistance(this.currentPosition, this.homeIsland);
        this.log(`📍 Utilisation homeIsland: (${this.homeIsland.x}, ${this.homeIsland.y}) à distance ${minDistance}`);
      }
    }

    // Si toujours rien, chercher dans les îles KNOWN du playerStore
    if (minDistance === Infinity && this.knownIslands.length > 0) {
      for (const island of this.knownIslands) {
        if (island.x !== undefined && island.y !== undefined) {
          const dist = this.getDistance(this.currentPosition, island);
          if (dist < minDistance) {
            minDistance = dist;
          }
        }
      }
    }

    return minDistance;
  }

  getDirectionToNearestDiscoveredIsland() {
    if (!this.currentPosition || this.discoveredIslands.length === 0) return null;

    // Trouver la cellule d'île DISCOVERED la plus proche
    let nearestCell = null;
    let minDistance = Infinity;

    for (const [key, cell] of this.knownCells) {
      if (cell.type === 'SAND' && cell.state === 'SEEN') {
        const dist = this.getDistance(this.currentPosition, cell);
        if (dist < minDistance) {
          minDistance = dist;
          nearestCell = cell;
        }
      }
    }

    if (!nearestCell) return null;

    return this.getDirectionTo(this.currentPosition, nearestCell);
  }

  getDirectionToHome() {
    if (!this.currentPosition) return null;

    // Trouver une cellule de home island
    for (const [key, cell] of this.knownCells) {
      if (cell.type === 'SAND' && this.isHomeIslandCell(cell)) {
        return this.getDirectionTo(this.currentPosition, cell);
      }
    }

    // Fallback: aller vers (0, 0) ou la position initiale connue
    return this.getDirectionTo(this.currentPosition, { x: 0, y: 0 });
  }

  getDirectionTo(from, to) {
    if (!from || !to) return null;

    const dx = to.x - from.x;
    const dy = to.y - from.y;

    // Déterminer la meilleure direction
    let direction = '';

    if (dy < 0) direction += 'N';
    else if (dy > 0) direction += 'S';

    if (dx > 0) direction += 'E';
    else if (dx < 0) direction += 'W';

    if (!direction) return null;

    const availableDirs = this.getAvailableDirections();

    // Vérifier si c'est une direction valide et disponible
    if (availableDirs.includes(direction) && !this.isDirectionBlocked(from, direction)) {
      return direction;
    }

    // Si direction diagonale mais pas autorisée, essayer les composantes
    if (direction.length === 2) {
      const ns = direction[0]; // N ou S
      const ew = direction[1]; // E ou W
      if (availableDirs.includes(ns) && !this.isDirectionBlocked(from, ns)) return ns;
      if (availableDirs.includes(ew) && !this.isDirectionBlocked(from, ew)) return ew;
    }

    // Essayer les directions cardinales alternatives
    for (const dir of CARDINAL_DIRECTIONS) {
      if (!this.isDirectionBlocked(from, dir)) {
        return dir;
      }
    }

    return null;
  }

  getNextPosition(position, direction) {
    if (!position) return null;
    const vector = DIRECTION_VECTORS[direction];
    if (!vector) return null;
    return {
      x: position.x + vector.dx,
      y: position.y + vector.dy
    };
  }

  getDistance(a, b) {
    // Distance de Chebyshev (car on peut bouger en diagonale)
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  }

  isOnIsland() {
    if (!this.currentPosition) return false;
    return this.currentPosition.type === 'SAND';
  }

  isHomeIslandCell(cell) {
    // Vérifier si la cellule appartient à l'île de départ
    // Pour l'instant on considère que c'est KNOWN + SAND
    return cell.type === 'SAND' && cell.state === 'KNOWN';
  }

  isDirectionBlocked(position, direction) {
    if (!position) return false;
    const key = `${position.x},${position.y}`;
    const blocked = this.blockedDirections.get(key);
    return blocked?.has(direction) || false;
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
}

export default ExplorationBot;
