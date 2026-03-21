<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useMapStore } from '../stores/map';
import { useShipStore } from '../stores/ship';

const mapStore = useMapStore();
const shipStore = useShipStore();

const containerRef = ref(null);
const isDragging = ref(false);
const dragStart = ref({ x: 0, y: 0 });

const CELL_SIZE = 24;
const VISIBLE_RADIUS = 15;

const cells = computed(() => mapStore.allCells);
const shipPosition = computed(() => mapStore.shipPosition);
const zoom = computed(() => mapStore.viewSettings.zoom);
const loading = computed(() => mapStore.loading);
const syncing = computed(() => mapStore.syncing);
const lastSync = computed(() => mapStore.lastSync);
const islandCount = computed(() => mapStore.islandCount);

const viewCenter = computed(() => ({
  x: mapStore.viewSettings.centerX,
  y: mapStore.viewSettings.centerY
}));

const visibleCells = computed(() => {
  const result = [];
  const cx = viewCenter.value.x;
  const cy = viewCenter.value.y;
  const radius = Math.ceil(VISIBLE_RADIUS / zoom.value);

  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      const cell = mapStore.getCellAt(x, y);
      result.push({
        x,
        y,
        cell,
        isShip: shipPosition.value && shipPosition.value.x === x && shipPosition.value.y === y
      });
    }
  }
  return result;
});

const gridColumns = computed(() => {
  const radius = Math.ceil(VISIBLE_RADIUS / zoom.value);
  return radius * 2 + 1;
});

const cellStyle = computed(() => ({
  width: `${CELL_SIZE * zoom.value}px`,
  height: `${CELL_SIZE * zoom.value}px`
}));

const getCellClass = (item) => {
  const classes = ['cell'];
  if (!item.cell) {
    classes.push('unknown');
  } else {
    classes.push(item.cell.type.toLowerCase());
    if (item.cell.zone !== undefined && item.cell.zone !== null) {
      classes.push(`zone-${item.cell.zone}`);
    }
    if (item.cell.state) {
      classes.push(`state-${item.cell.state.toLowerCase()}`);
    }
    if (item.cell.island) {
      classes.push('has-island');
    }
  }
  if (item.isShip) {
    classes.push('ship');
  }
  return classes;
};

const getCellTitle = (item) => {
  let title = `(${item.x}, ${item.y})`;
  if (item.cell) {
    title += ` - ${item.cell.type}`;
    if (item.cell.island) {
      title += ` - ${item.cell.island.name}`;
    }
    title += ` [Zone ${item.cell.zone}]`;
  } else {
    title += ' - Inconnu';
  }
  return title;
};

const handleZoom = (delta) => {
  mapStore.setZoom(zoom.value + delta);
};

const handleWheel = (e) => {
  e.preventDefault();
  const delta = e.deltaY > 0 ? -0.1 : 0.1;
  handleZoom(delta);
};

const startDrag = (e) => {
  isDragging.value = true;
  dragStart.value = { x: e.clientX, y: e.clientY };
};

const onDrag = (e) => {
  if (!isDragging.value) return;
  const dx = e.clientX - dragStart.value.x;
  const dy = e.clientY - dragStart.value.y;
  const sensitivity = 50 / zoom.value;

  if (Math.abs(dx) > sensitivity) {
    mapStore.setViewCenter(
      viewCenter.value.x - Math.sign(dx),
      viewCenter.value.y
    );
    dragStart.value.x = e.clientX;
  }
  if (Math.abs(dy) > sensitivity) {
    mapStore.setViewCenter(
      viewCenter.value.x,
      viewCenter.value.y + Math.sign(dy)
    );
    dragStart.value.y = e.clientY;
  }
};

const endDrag = () => {
  isDragging.value = false;
};

const centerOnShip = () => {
  mapStore.centerOnShip();
};

const clearMap = () => {
  if (confirm('Effacer toutes les cellules de la base de donnees?')) {
    mapStore.clearMap();
  }
};

const reloadMap = () => {
  mapStore.loadFromDB();
};

const formatTime = (isoString) => {
  if (!isoString) return '';
  return new Date(isoString).toLocaleTimeString('fr-FR');
};

watch(() => shipStore.position, (newPos) => {
  if (newPos) {
    mapStore.updateShipPosition(newPos);
  }
}, { immediate: true });

watch(() => shipStore.discoveredCells, (newCells) => {
  if (newCells && newCells.length) {
    mapStore.addCells(newCells, 'SEEN');
  }
}, { deep: true });

onMounted(async () => {
  await mapStore.loadFromDB();
  if (shipStore.position) {
    mapStore.centerOnShip();
  }
});
</script>

<template>
  <div class="world-map card">
    <div class="map-header">
      <h2>Carte du Monde</h2>
      <div class="map-controls">
        <button class="control-btn" @click="handleZoom(-0.2)" title="Zoom -">-</button>
        <span class="zoom-level">{{ Math.round(zoom * 100) }}%</span>
        <button class="control-btn" @click="handleZoom(0.2)" title="Zoom +">+</button>
        <button class="control-btn center" @click="centerOnShip" title="Centrer sur le bateau">
          🎯
        </button>
        <button class="control-btn reload" @click="reloadMap" title="Recharger depuis DB">
          🔄
        </button>
        <button class="control-btn clear" @click="clearMap" title="Effacer la carte">
          🗑️
        </button>
      </div>
    </div>

    <div class="map-stats">
      <span class="stat">
        <span class="stat-icon">🗺️</span>
        {{ cells.length }} cellules
      </span>
      <span class="stat">
        <span class="stat-icon">🏝️</span>
        {{ islandCount }} iles
      </span>
      <span class="stat">
        <span class="stat-icon">📍</span>
        ({{ viewCenter.x }}, {{ viewCenter.y }})
      </span>
      <span v-if="shipPosition" class="stat ship-pos">
        <span class="stat-icon">🚢</span>
        ({{ shipPosition.x }}, {{ shipPosition.y }})
      </span>
      <span v-if="syncing" class="stat syncing">
        <span class="stat-icon">⏳</span>
        Sync...
      </span>
      <span v-else-if="lastSync" class="stat synced">
        <span class="stat-icon">✅</span>
        {{ formatTime(lastSync) }}
      </span>
    </div>

    <div v-if="loading" class="loading-overlay">
      <div class="loading-spinner"></div>
      <span>Chargement de la carte...</span>
    </div>

    <div
      v-else
      ref="containerRef"
      class="map-container"
      @wheel="handleWheel"
      @mousedown="startDrag"
      @mousemove="onDrag"
      @mouseup="endDrag"
      @mouseleave="endDrag"
    >
      <div
        class="map-grid"
        :style="{
          gridTemplateColumns: `repeat(${gridColumns}, ${CELL_SIZE * zoom}px)`,
          gridTemplateRows: `repeat(${gridColumns}, ${CELL_SIZE * zoom}px)`
        }"
      >
        <div
          v-for="(item, index) in visibleCells"
          :key="`${item.x}-${item.y}`"
          :class="getCellClass(item)"
          :style="cellStyle"
          :title="getCellTitle(item)"
        >
          <span v-if="item.isShip" class="ship-marker">🚢</span>
          <span v-else-if="item.cell?.ships?.length" class="other-ship">⛵</span>
          <span v-else-if="item.cell?.island" class="island-marker">🏝️</span>
        </div>
      </div>
    </div>

    <div class="legend">
      <div class="legend-item">
        <span class="legend-color sea zone-1"></span>
        <span>Mer Z1</span>
      </div>
      <div class="legend-item">
        <span class="legend-color sea zone-2"></span>
        <span>Mer Z2</span>
      </div>
      <div class="legend-item">
        <span class="legend-color sea zone-3"></span>
        <span>Mer Z3</span>
      </div>
      <div class="legend-item">
        <span class="legend-color sand"></span>
        <span>Plage</span>
      </div>
      <div class="legend-item">
        <span class="legend-color rocks"></span>
        <span>Rochers</span>
      </div>
      <div class="legend-item">
        <span class="legend-color unknown"></span>
        <span>Inconnu</span>
      </div>
      <div class="legend-item">
        <span class="ship-icon">🚢</span>
        <span>Bateau</span>
      </div>
      <div class="legend-item">
        <span class="ship-icon">🏝️</span>
        <span>Ile</span>
      </div>
    </div>

    <div class="map-instructions">
      <p>Molette: zoom | Glisser: deplacer | Donnees persistees en MongoDB</p>
    </div>
  </div>
</template>

<style scoped>
.world-map {
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
  border-radius: 12px;
  padding: 20px;
  border: 1px solid #0f3460;
}

.map-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 15px;
  border-bottom: 2px solid #0f3460;
  padding-bottom: 10px;
}

h2 {
  color: #e94560;
  font-size: 1.5rem;
  margin: 0;
}

.map-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.control-btn {
  width: 32px;
  height: 32px;
  border-radius: 6px;
  border: 1px solid #0f3460;
  background: rgba(15, 52, 96, 0.5);
  color: #fff;
  cursor: pointer;
  font-size: 1rem;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.control-btn:hover {
  background: #e94560;
  border-color: #e94560;
}

.control-btn.reload:hover {
  background: #22c55e;
  border-color: #22c55e;
}

.zoom-level {
  color: #94a3b8;
  font-size: 0.8rem;
  min-width: 40px;
  text-align: center;
}

.map-stats {
  display: flex;
  gap: 10px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}

.stat {
  display: flex;
  align-items: center;
  gap: 5px;
  color: #94a3b8;
  font-size: 0.75rem;
  background: rgba(15, 52, 96, 0.3);
  padding: 4px 8px;
  border-radius: 15px;
}

.stat.ship-pos {
  color: #e94560;
}

.stat.syncing {
  color: #f59e0b;
  animation: blink 1s infinite;
}

.stat.synced {
  color: #22c55e;
}

@keyframes blink {
  50% { opacity: 0.5; }
}

.stat-icon {
  font-size: 0.85rem;
}

.loading-overlay {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 400px;
  gap: 15px;
  color: #94a3b8;
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid #0f3460;
  border-top-color: #e94560;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.map-container {
  background: rgba(0, 0, 0, 0.3);
  border-radius: 10px;
  overflow: hidden;
  cursor: grab;
  padding: 10px;
  min-height: 400px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.map-container:active {
  cursor: grabbing;
}

.map-grid {
  display: grid;
  gap: 1px;
  background: rgba(15, 52, 96, 0.2);
}

.cell {
  border-radius: 2px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.1s;
  font-size: 10px;
}

.cell:hover {
  transform: scale(1.15);
  z-index: 10;
}

.cell.unknown {
  background: rgba(50, 50, 60, 0.3);
}

.cell.sea {
  background: #1e40af;
}

/* Zones SEA : plus la zone est haute, plus c'est foncé */
.cell.sea.zone-1 {
  background: #7dd3fc; /* bleu très clair */
}

.cell.sea.zone-2 {
  background: #2563eb; /* bleu moyen */
}

.cell.sea.zone-3 {
  background: #1d4ed8; /* bleu soutenu */
}

.cell.sea.zone-4 {
  background: #1e3a8a; /* bleu foncé */
}

.cell.sea.zone-5 {
  background: #172554; /* bleu très foncé */
}

.cell.sand {
  background: #d97706;
}

.cell.rocks {
  background: #57534e;
}

.cell.has-island {
  border: 1px solid #22c55e;
}

.cell.state-seen {
  opacity: 0.7;
}

.cell.state-visited {
  opacity: 0.5;
}

.cell.ship {
  box-shadow: 0 0 10px #e94560, 0 0 20px rgba(233, 69, 96, 0.5);
  border: 2px solid #e94560;
  z-index: 20;
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%, 100% {
    box-shadow: 0 0 10px #e94560, 0 0 20px rgba(233, 69, 96, 0.5);
  }
  50% {
    box-shadow: 0 0 15px #e94560, 0 0 30px rgba(233, 69, 96, 0.7);
  }
}

.ship-marker {
  font-size: 12px;
  animation: bob 1s ease-in-out infinite;
}

@keyframes bob {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-2px); }
}

.other-ship {
  font-size: 10px;
  opacity: 0.8;
}

.island-marker {
  font-size: 8px;
}

.legend {
  display: flex;
  gap: 12px;
  justify-content: center;
  margin-top: 15px;
  flex-wrap: wrap;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 5px;
  color: #94a3b8;
  font-size: 0.75rem;
}

.legend-color {
  width: 12px;
  height: 12px;
  border-radius: 3px;
}

.legend-color.sea {
  background: #1e40af;
}

.legend-color.sea.zone-1 {
  background: #7dd3fc;
}

.legend-color.sea.zone-2 {
  background: #2563eb;
}

.legend-color.sea.zone-3 {
  background: #1d4ed8;
}

.legend-color.sea.zone-4 {
  background: #1e3a8a;
}

.legend-color.sea.zone-5 {
  background: #172554;
}

.legend-color.sand {
  background: #d97706;
}

.legend-color.rocks {
  background: #57534e;
}

.legend-color.unknown {
  background: rgba(50, 50, 60, 0.5);
}

.ship-icon {
  font-size: 12px;
}

.map-instructions {
  text-align: center;
  margin-top: 10px;
}

.map-instructions p {
  color: #64748b;
  font-size: 0.7rem;
  margin: 0;
}
</style>
