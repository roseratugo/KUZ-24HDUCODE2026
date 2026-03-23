<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useShipStore } from '../stores/ship';

const shipStore = useShipStore();

const error = computed(() => shipStore.error);
const position = computed(() => shipStore.position);
const energy = computed(() => shipStore.energy);
const maxEnergy = computed(() => shipStore.maxEnergy);
const discoveredCells = computed(() => shipStore.discoveredCells);
const shipLevel = computed(() => shipStore.shipLevel);
const lastUpdate = computed(() => shipStore.lastUpdate);
const moveHistory = computed(() => shipStore.moveHistory);
const isOnCooldown = computed(() => shipStore.isOnCooldown);
const cooldownSeconds = computed(() => shipStore.cooldownSeconds);
const cooldownRemaining = computed(() => shipStore.cooldownRemaining);
const shipSpeed = computed(() => shipStore.shipSpeed);

const cooldownPercent = computed(() => {
  if (!shipSpeed.value || cooldownRemaining.value <= 0) return 0;
  return (cooldownRemaining.value / shipSpeed.value) * 100;
});

const lastKeyDirection = ref(null);

const KEY_MAP = {
  'ArrowUp': 'N', 'ArrowDown': 'S', 'ArrowLeft': 'W', 'ArrowRight': 'E',
  'z': 'N', 's': 'S', 'q': 'W', 'd': 'E',
  'a': 'NW', 'e': 'NE', 'w': 'SW', 'x': 'SE',
  '8': 'N', '2': 'S', '4': 'W', '6': 'E',
  '7': 'NW', '9': 'NE', '1': 'SW', '3': 'SE',
};

let keyFlashTimeout = null;
const handleKeyDown = (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

  const direction = KEY_MAP[e.key];
  if (direction) {
    e.preventDefault();
    lastKeyDirection.value = direction;
    clearTimeout(keyFlashTimeout);
    keyFlashTimeout = setTimeout(() => { lastKeyDirection.value = null; }, 200);
    move(direction);
  }
};

onMounted(() => {
  shipStore.checkAndRestoreCooldown();
  shipStore.loadMoveHistory();
  window.addEventListener('keydown', handleKeyDown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown);
});

const energyPercent = computed(() => {
  if (!maxEnergy.value) return 0;
  return Math.round((energy.value / maxEnergy.value) * 100);
});

const energyBarColor = computed(() => {
  if (energyPercent.value > 60) return '#22c55e';
  if (energyPercent.value > 30) return '#f59e0b';
  return '#ef4444';
});

const formatLastUpdate = computed(() => {
  if (!lastUpdate.value) return 'Jamais';
  return new Date(lastUpdate.value).toLocaleTimeString('fr-FR');
});

const directions = [
  { key: 'NW', label: 'NW', row: 1, col: 1, icon: '↖' },
  { key: 'N', label: 'N', row: 1, col: 2, icon: '↑' },
  { key: 'NE', label: 'NE', row: 1, col: 3, icon: '↗' },
  { key: 'W', label: 'W', row: 2, col: 1, icon: '←' },
  { key: null, label: '', row: 2, col: 2, icon: '⚓' },
  { key: 'E', label: 'E', row: 2, col: 3, icon: '→' },
  { key: 'SW', label: 'SW', row: 3, col: 1, icon: '↙' },
  { key: 'S', label: 'S', row: 3, col: 2, icon: '↓' },
  { key: 'SE', label: 'SE', row: 3, col: 3, icon: '↘' }
];

const move = (direction) => {
  if (!direction || isOnCooldown.value || energy.value === 0) return;
  shipStore.move(direction).catch(err => {
    console.error('Move failed:', err);
  });
};

const getCellTypeLabel = (type) => {
  return type === 'SEA' ? 'Mer' : type === 'SAND' ? 'Plage' : type === 'ROCKS' ? 'Rochers' : type;
};

const resetShipData = () => {
  if (confirm('Reinitialiser les donnees du bateau?')) {
    shipStore.resetState();
  }
};
</script>

<template>
  <div class="ship-control card">
    <div class="header-row">
      <h2>Controle du Bateau</h2>
      <button class="reset-btn" @click="resetShipData" title="Reinitialiser">🔄</button>
    </div>

    <div v-if="error" class="error">{{ error }}</div>

    <div class="energy-section">
      <div class="energy-header">
        <span class="energy-label">Points de Mouvement</span>
        <span class="energy-value">{{ energy }} / {{ maxEnergy }}</span>
      </div>
      <div class="energy-bar-container">
        <div
          class="energy-bar"
          :style="{ width: energyPercent + '%', backgroundColor: energyBarColor }"
        ></div>
      </div>
      <div class="energy-warning" v-if="energy <= 5 && energy > 0">
        Attention: energie faible!
      </div>
      <div class="energy-warning critical" v-if="energy === 0 && maxEnergy > 0">
        Panne seche! Retournez sur une ile.
      </div>
      <div class="energy-hint" v-if="!lastUpdate">
        Deplacez-vous pour mettre a jour l'energie
      </div>
    </div>

    <div class="ship-info">
      <div class="info-item">
        <span class="info-icon">🚢</span>
        <span class="info-text">{{ shipLevel?.name || 'Inconnu' }}</span>
      </div>
      <div class="info-item">
        <span class="info-icon">👁</span>
        <span class="info-text">Portee: {{ shipLevel?.visibilityRange || '?' }}</span>
      </div>
      <div class="info-item" v-if="lastUpdate">
        <span class="info-icon">🕐</span>
        <span class="info-text">{{ formatLastUpdate }}</span>
      </div>
    </div>

    <div class="ship-status">
      <div class="status-item position">
        <span class="status-label">Position</span>
        <span v-if="position" class="status-value coords">
          ({{ position.x }}, {{ position.y }})
        </span>
        <span v-else class="status-value unknown">?</span>
      </div>
      <div class="status-item">
        <span class="status-label">Terrain</span>
        <span v-if="position" :class="['status-value', 'terrain', position.type?.toLowerCase()]">
          {{ getCellTypeLabel(position.type) }}
        </span>
        <span v-else class="status-value unknown">?</span>
      </div>
      <div class="status-item">
        <span class="status-label">Zone</span>
        <span v-if="position" class="status-value">{{ position.zone }}</span>
        <span v-else class="status-value unknown">?</span>
      </div>
    </div>

    <div class="controls-section">
      <h3>Navigation <span class="kbd-hint">ZQSD / Fleches</span></h3>
      <div class="direction-grid" :class="{ 'on-cooldown': isOnCooldown }">
        <button
          v-for="dir in directions"
          :key="dir.row + '-' + dir.col"
          :class="['direction-btn', { empty: !dir.key, disabled: (energy === 0 || isOnCooldown) && dir.key, active: lastKeyDirection === dir.key }]"
          :disabled="isOnCooldown || !dir.key || energy === 0"
          :style="{ gridRow: dir.row, gridColumn: dir.col }"
          @click="move(dir.key)"
          :title="dir.key ? `Aller vers ${dir.key}` : ''"
        >
          <span class="dir-icon">{{ dir.icon }}</span>
          <span v-if="dir.key" class="dir-label">{{ dir.label }}</span>
        </button>
      </div>
      <div v-if="isOnCooldown" class="cooldown-section">
        <div class="cooldown-bar-container">
          <div
            class="cooldown-bar"
            :style="{ width: cooldownPercent + '%' }"
          ></div>
        </div>
        <span class="cooldown-text">{{ cooldownRemaining }}ms</span>
      </div>
      <p class="nav-hint">
        {{ moveHistory.length }} mouvement(s) effectue(s)
      </p>
    </div>

    <div v-if="discoveredCells.length" class="discovered-section">
      <h3>Cellules visibles ({{ discoveredCells.length }})</h3>
      <div class="cells-list">
        <div v-for="cell in discoveredCells" :key="cell.id" class="cell-item">
          <span class="cell-coords">({{ cell.x }}, {{ cell.y }})</span>
          <span :class="['cell-type', cell.type.toLowerCase()]">
            {{ getCellTypeLabel(cell.type) }}
          </span>
          <span v-if="cell.island" class="cell-island">🏝️</span>
          <span v-if="cell.ships && cell.ships.length" class="cell-ships">
            🚢 {{ cell.ships.length }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ship-control {
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
  border-radius: 12px;
  padding: 20px;
  border: 1px solid #0f3460;
}

.header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 15px;
  border-bottom: 2px solid #0f3460;
  padding-bottom: 10px;
}

h2 {
  color: #e94560;
  font-size: 1.3rem;
  margin: 0;
}

.reset-btn {
  background: rgba(15, 52, 96, 0.5);
  border: 1px solid #0f3460;
  color: #94a3b8;
  width: 30px;
  height: 30px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.9rem;
  transition: all 0.2s;
}

.reset-btn:hover {
  background: #e94560;
  border-color: #e94560;
}

h3 {
  color: #94a3b8;
  font-size: 0.9rem;
  margin: 12px 0 8px;
}

.error {
  background: rgba(239, 68, 68, 0.2);
  color: #ef4444;
  padding: 10px;
  border-radius: 8px;
  margin-bottom: 15px;
  font-size: 0.85rem;
}

.energy-section {
  background: rgba(15, 52, 96, 0.5);
  border-radius: 10px;
  padding: 12px;
  margin-bottom: 12px;
}

.energy-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.energy-label {
  color: #94a3b8;
  font-size: 0.85rem;
}

.energy-value {
  color: #fff;
  font-weight: 700;
  font-size: 1.1rem;
}

.energy-bar-container {
  background: rgba(0, 0, 0, 0.3);
  border-radius: 8px;
  height: 10px;
  overflow: hidden;
}

.energy-bar {
  height: 100%;
  border-radius: 8px;
  transition: width 0.3s, background-color 0.3s;
}

.energy-warning {
  margin-top: 8px;
  padding: 6px;
  background: rgba(245, 158, 11, 0.2);
  color: #f59e0b;
  border-radius: 6px;
  font-size: 0.8rem;
  text-align: center;
}

.energy-warning.critical {
  background: rgba(239, 68, 68, 0.2);
  color: #ef4444;
}

.energy-hint {
  margin-top: 8px;
  color: #64748b;
  font-size: 0.75rem;
  text-align: center;
  font-style: italic;
}

.ship-info {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.info-item {
  display: flex;
  align-items: center;
  gap: 5px;
  background: rgba(15, 52, 96, 0.3);
  padding: 6px 10px;
  border-radius: 15px;
}

.info-icon {
  font-size: 0.9rem;
}

.info-text {
  color: #94a3b8;
  font-size: 0.8rem;
}

.ship-status {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-bottom: 15px;
}

.status-item {
  background: rgba(15, 52, 96, 0.5);
  padding: 10px;
  border-radius: 8px;
  text-align: center;
}

.status-label {
  color: #94a3b8;
  font-size: 0.7rem;
  display: block;
  margin-bottom: 3px;
}

.status-value {
  color: #fff;
  font-weight: 600;
  font-size: 0.95rem;
}

.status-value.coords {
  font-family: monospace;
  color: #60a5fa;
}

.status-value.unknown {
  color: #64748b;
}

.terrain.sea {
  color: #60a5fa;
}

.terrain.sand {
  color: #fbbf24;
}

.terrain.rocks {
  color: #a1a1aa;
}

.controls-section {
  text-align: center;
}

.kbd-hint {
  font-size: 0.65rem;
  color: #64748b;
  font-weight: 400;
  margin-left: 6px;
  padding: 2px 6px;
  background: rgba(15, 52, 96, 0.5);
  border-radius: 4px;
  border: 1px solid #0f3460;
}

.cooldown-section {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
  margin-bottom: 6px;
  padding: 8px 12px;
  background: rgba(239, 68, 68, 0.15);
  border-radius: 8px;
  border: 1px solid rgba(239, 68, 68, 0.3);
}

.cooldown-bar-container {
  flex: 1;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 6px;
  height: 8px;
  overflow: hidden;
}

.cooldown-bar {
  height: 100%;
  background: linear-gradient(90deg, #ef4444, #f59e0b);
  border-radius: 6px;
  transition: width 0.1s linear;
}

.cooldown-text {
  color: #ef4444;
  font-weight: 700;
  font-size: 1rem;
  min-width: 30px;
  text-align: right;
}

.direction-grid {
  display: grid;
  grid-template-columns: repeat(3, 55px);
  grid-template-rows: repeat(3, 55px);
  gap: 6px;
  justify-content: center;
  margin: 10px 0;
  transition: opacity 0.2s;
}

.direction-grid.on-cooldown {
  opacity: 0.5;
}

.direction-btn {
  background: #0f3460;
  border: 2px solid #e94560;
  color: #fff;
  border-radius: 10px;
  cursor: pointer;
  font-weight: 600;
  transition: all 0.2s;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
}

.direction-btn:hover:not(:disabled):not(.empty),
.direction-btn.active:not(.empty) {
  background: #e94560;
  transform: scale(1.08);
  box-shadow: 0 4px 15px rgba(233, 69, 96, 0.4);
}

.direction-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.direction-btn.disabled {
  border-color: #64748b;
}

.direction-btn.empty {
  background: rgba(15, 52, 96, 0.3);
  border: 2px dashed #0f3460;
  cursor: default;
}

.dir-icon {
  font-size: 1.1rem;
}

.dir-label {
  font-size: 0.6rem;
  color: #94a3b8;
}

.nav-hint {
  color: #64748b;
  font-size: 0.7rem;
  margin: 0;
}

.discovered-section {
  margin-top: 15px;
  border-top: 1px solid #0f3460;
  padding-top: 10px;
}

.cells-list {
  max-height: 100px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.cell-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 10px;
  background: rgba(15, 52, 96, 0.3);
  border-radius: 6px;
}

.cell-coords {
  color: #fff;
  font-family: monospace;
  font-size: 0.8rem;
}

.cell-type {
  padding: 2px 6px;
  border-radius: 8px;
  font-size: 0.7rem;
}

.cell-type.sea {
  background: rgba(59, 130, 246, 0.3);
  color: #60a5fa;
}

.cell-type.sand {
  background: rgba(245, 158, 11, 0.3);
  color: #fbbf24;
}

.cell-type.rocks {
  background: rgba(161, 161, 170, 0.3);
  color: #a1a1aa;
}

.cell-island {
  font-size: 0.8rem;
}

.cell-ships {
  font-size: 0.75rem;
}
</style>
