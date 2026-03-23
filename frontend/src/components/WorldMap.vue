<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { useMapStore } from '../stores/map';
import { useShipStore } from '../stores/ship';

const mapStore = useMapStore();
const shipStore = useShipStore();

const canvasRef = ref(null);
const containerRef = ref(null);

const CELL_SIZE = 28;

const camera = ref({ x: 0, y: 0 });
const zoomLevel = ref(1);

const isDragging = ref(false);
const dragStart = ref({ x: 0, y: 0 });
const lastMouse = ref({ x: 0, y: 0 });

const velocity = ref({ x: 0, y: 0 });
let animFrameId = null;

const cells = computed(() => mapStore.allCells);
const shipPosition = computed(() => mapStore.shipPosition);
const loading = computed(() => mapStore.loading);
const syncing = computed(() => mapStore.syncing);
const lastSync = computed(() => mapStore.lastSync);
const islandCount = computed(() => mapStore.islandCount);

const viewCenter = computed(() => {
  const cellPx = CELL_SIZE * zoomLevel.value;
  return {
    x: Math.round(camera.value.x / cellPx),
    y: Math.round(camera.value.y / cellPx)
  };
});

const cellColors = {
  SEA: {
    1: '#7dd3fc',
    2: '#2563eb',
    3: '#1d4ed8',
    4: '#1e3a8a',
    5: '#172554',
    default: '#1e40af'
  },
  SAND: '#d97706',
  ROCKS: '#57534e'
};

const getCellColor = (cell) => {
  if (!cell || !cell.type) return 'rgba(50, 50, 60, 0.3)';
  if (cell.type === 'SEA') {
    return cellColors.SEA[cell.zone] || cellColors.SEA.default;
  }
  return cellColors[cell.type] || 'rgba(50, 50, 60, 0.3)';
};

const getIslandColor = (cell) => {
  if (!cell.island) return null;
  const islandData = mapStore.islands.get(cell.island.id);
  if (!islandData || islandData.state === 'DISCOVERED') return '#eab308';
  return '#22c55e';
};

const draw = () => {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const z = zoomLevel.value;
  const cellPx = CELL_SIZE * z;

  ctx.clearRect(0, 0, w, h);

  const offsetX = w / 2 - camera.value.x * z;
  const offsetY = h / 2 - camera.value.y * z;

  const minCellX = Math.floor((camera.value.x * z - w / 2) / cellPx) - 1;
  const maxCellX = Math.ceil((camera.value.x * z + w / 2) / cellPx) + 1;
  const minCellY = Math.floor((camera.value.y * z - h / 2) / cellPx) - 1;
  const maxCellY = Math.ceil((camera.value.y * z + h / 2) / cellPx) + 1;

  for (let cy = minCellY; cy <= maxCellY; cy++) {
    for (let cx = minCellX; cx <= maxCellX; cx++) {
      const screenX = offsetX + cx * cellPx;
      const screenY = offsetY + cy * cellPx;

      const cell = mapStore.getCellAt(cx, cy);

      ctx.fillStyle = getCellColor(cell);
      if (cell?.state === 'SEEN') ctx.globalAlpha = 0.7;
      else if (cell?.state === 'VISITED') ctx.globalAlpha = 0.5;
      else ctx.globalAlpha = 1;

      const gap = cellPx > 3 ? 1 : 0;
      ctx.fillRect(screenX, screenY, cellPx - gap, cellPx - gap);
      ctx.globalAlpha = 1;

      if (cell?.island) {
        const islandColor = getIslandColor(cell);
        ctx.fillStyle = islandColor;
        ctx.fillRect(screenX, screenY, cellPx - gap, cellPx - gap);

        if (cellPx >= 8) {
          ctx.strokeStyle = islandColor === '#22c55e' ? '#86efac' : '#fde047';
          ctx.lineWidth = cellPx >= 15 ? 2 : 1;
          ctx.strokeRect(screenX + 1, screenY + 1, cellPx - 3, cellPx - 3);
        }

        if (cellPx >= 18) {
          ctx.font = `${Math.max(10, cellPx * 0.4)}px serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('🏝️', screenX + cellPx / 2, screenY + cellPx / 2);
        }
      }

      if (cellPx >= 15 && cell?.ships?.length) {
        ctx.font = `${Math.max(8, cellPx * 0.35)}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('⛵', screenX + cellPx / 2, screenY + cellPx / 2);
      }
    }
  }

  if (shipPosition.value) {
    const sx = offsetX + shipPosition.value.x * cellPx;
    const sy = offsetY + shipPosition.value.y * cellPx;

    const markerSize = Math.max(cellPx, 6);
    const mx = cellPx >= 6 ? sx : sx - (markerSize - cellPx) / 2;
    const my = cellPx >= 6 ? sy : sy - (markerSize - cellPx) / 2;

    ctx.shadowColor = '#e94560';
    ctx.shadowBlur = Math.max(5, 15 * z);
    ctx.strokeStyle = '#e94560';
    ctx.lineWidth = Math.max(1, 2 * z);
    ctx.strokeRect(mx, my, markerSize - 1, markerSize - 1);
    ctx.shadowBlur = 0;

    if (cellPx >= 12) {
      ctx.font = `${Math.max(12, cellPx * 0.5)}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🚢', sx + cellPx / 2, sy + cellPx / 2);
    } else {
      ctx.fillStyle = '#e94560';
      ctx.fillRect(mx, my, markerSize - 1, markerSize - 1);
    }
  }

  if (z >= 0.8) {
    ctx.strokeStyle = 'rgba(15, 52, 96, 0.3)';
    ctx.lineWidth = 0.5;
    for (let cx = minCellX; cx <= maxCellX; cx++) {
      const x = offsetX + cx * cellPx;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let cy = minCellY; cy <= maxCellY; cy++) {
      const y = offsetY + cy * cellPx;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
  }
};

const resizeCanvas = () => {
  const canvas = canvasRef.value;
  const container = containerRef.value;
  if (!canvas || !container) return;
  canvas.width = container.clientWidth;
  canvas.height = container.clientHeight;
  draw();
};

const handleWheel = (e) => {
  e.preventDefault();
  const factor = e.deltaY > 0 ? 0.85 : 1.18;
  zoomLevel.value = Math.max(0.05, Math.min(3, zoomLevel.value * factor));
  mapStore.setZoom(zoomLevel.value);
  draw();
};

const startDrag = (e) => {
  e.preventDefault();
  isDragging.value = true;
  dragStart.value = { x: e.clientX, y: e.clientY };
  lastMouse.value = { x: e.clientX, y: e.clientY };
  velocity.value = { x: 0, y: 0 };
};

const onDrag = (e) => {
  if (!isDragging.value) return;
  const dx = e.clientX - lastMouse.value.x;
  const dy = e.clientY - lastMouse.value.y;

  camera.value = {
    x: camera.value.x - dx / zoomLevel.value,
    y: camera.value.y - dy / zoomLevel.value
  };

  velocity.value = { x: dx, y: dy };
  lastMouse.value = { x: e.clientX, y: e.clientY };
  draw();
};

const endDrag = () => {
  if (!isDragging.value) return;
  isDragging.value = false;

  const friction = 0.92;
  const animate = () => {
    if (Math.abs(velocity.value.x) < 0.5 && Math.abs(velocity.value.y) < 0.5) {
      syncViewCenter();
      return;
    }

    camera.value = {
      x: camera.value.x - velocity.value.x / zoomLevel.value,
      y: camera.value.y - velocity.value.y / zoomLevel.value
    };

    velocity.value = {
      x: velocity.value.x * friction,
      y: velocity.value.y * friction
    };

    draw();
    animFrameId = requestAnimationFrame(animate);
  };

  if (Math.abs(velocity.value.x) > 2 || Math.abs(velocity.value.y) > 2) {
    animFrameId = requestAnimationFrame(animate);
  } else {
    syncViewCenter();
  }
};

const syncViewCenter = () => {
  const cellPx = CELL_SIZE;
  mapStore.setViewCenter(
    Math.round(camera.value.x / cellPx),
    Math.round(camera.value.y / cellPx)
  );
};

const handleTouchStart = (e) => {
  if (e.touches.length === 1) {
    const touch = e.touches[0];
    startDrag({ clientX: touch.clientX, clientY: touch.clientY, preventDefault: () => {} });
  }
};

const handleTouchMove = (e) => {
  if (e.touches.length === 1) {
    e.preventDefault();
    const touch = e.touches[0];
    onDrag({ clientX: touch.clientX, clientY: touch.clientY });
  }
};

const handleTouchEnd = () => {
  endDrag();
};

const hoveredCell = ref(null);
const tooltipPos = ref({ x: 0, y: 0 });

const onMouseMove = (e) => {
  if (isDragging.value) {
    onDrag(e);
    hoveredCell.value = null;
    return;
  }

  const canvas = canvasRef.value;
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  const z = zoomLevel.value;
  const cellPx = CELL_SIZE * z;
  const offsetX = canvas.width / 2 - camera.value.x * z;
  const offsetY = canvas.height / 2 - camera.value.y * z;

  const cellX = Math.floor((mx - offsetX) / cellPx);
  const cellY = Math.floor((my - offsetY) / cellPx);

  const cell = mapStore.getCellAt(cellX, cellY);
  hoveredCell.value = { x: cellX, y: cellY, cell };
  tooltipPos.value = { x: e.clientX - rect.left + 15, y: e.clientY - rect.top - 10 };
};

const handleZoom = (delta) => {
  zoomLevel.value = Math.max(0.05, Math.min(3, zoomLevel.value + delta));
  mapStore.setZoom(zoomLevel.value);
  draw();
};

const centerOnShip = () => {
  if (shipPosition.value) {
    camera.value = {
      x: shipPosition.value.x * CELL_SIZE,
      y: shipPosition.value.y * CELL_SIZE
    };
    mapStore.centerOnShip();
    draw();
  }
};

const isFullscreen = ref(false);
const mapRoot = ref(null);

const toggleFullscreen = () => {
  if (!document.fullscreenElement) {
    mapRoot.value?.requestFullscreen();
  } else {
    document.exitFullscreen();
  }
};

const onFullscreenChange = () => {
  isFullscreen.value = !!document.fullscreenElement;
  nextTick(resizeCanvas);
};

const reloadMap = async () => {
  await mapStore.loadFromDB();
  await nextTick();
  resizeCanvas();
};

const formatTime = (isoString) => {
  if (!isoString) return '';
  return new Date(isoString).toLocaleTimeString('fr-FR');
};

watch(() => shipStore.position, (newPos) => {
  if (newPos) {
    mapStore.updateShipPosition(newPos);
    nextTick(draw);
  }
}, { immediate: true });

watch(() => shipStore.discoveredCells, (newCells) => {
  if (newCells && newCells.length) {
    mapStore.addCells(newCells, 'SEEN');
    nextTick(draw);
  }
}, { deep: true });

watch(() => mapStore.allCells, () => {
  draw();
}, { deep: true });

let resizeObserver = null;

onMounted(async () => {
  await mapStore.loadFromDB();
  mapStore.connectWebSocket();
  if (shipStore.position) {
    camera.value = {
      x: shipStore.position.x * CELL_SIZE,
      y: shipStore.position.y * CELL_SIZE
    };
    mapStore.centerOnShip();
  }
  await nextTick();
  resizeCanvas();

  resizeObserver = new ResizeObserver(resizeCanvas);
  if (containerRef.value) resizeObserver.observe(containerRef.value);
  document.addEventListener('fullscreenchange', onFullscreenChange);
});

onUnmounted(() => {
  if (animFrameId) cancelAnimationFrame(animFrameId);
  if (resizeObserver) resizeObserver.disconnect();
  document.removeEventListener('fullscreenchange', onFullscreenChange);
  mapStore.disconnectWebSocket();
});
</script>

<template>
  <div ref="mapRoot" :class="['world-map', 'card', { fullscreen: isFullscreen }]">
    <div class="map-header">
      <h2>Carte du Monde</h2>
      <div class="map-controls">
        <button class="control-btn" @click="handleZoom(-0.2)" title="Zoom -">-</button>
        <span class="zoom-level">{{ Math.round(zoomLevel * 100) }}%</span>
        <button class="control-btn" @click="handleZoom(0.2)" title="Zoom +">+</button>
        <button class="control-btn center" @click="centerOnShip" title="Centrer sur le bateau">
          🎯
        </button>
        <button class="control-btn reload" @click="reloadMap" title="Recharger depuis DB">
          🔄
        </button>
        <button class="control-btn fullscreen" @click="toggleFullscreen" :title="isFullscreen ? 'Quitter plein ecran' : 'Plein ecran'">
          {{ isFullscreen ? '⛶' : '⛶' }}
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
      <span :class="['stat', mapStore.wsConnected ? 'synced' : 'syncing']">
        <span class="stat-icon">{{ mapStore.wsConnected ? '🟢' : '🔴' }}</span>
        WS
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
      @mousemove="onMouseMove"
      @mouseup="endDrag"
      @mouseleave="endDrag"
      @touchstart="handleTouchStart"
      @touchmove="handleTouchMove"
      @touchend="handleTouchEnd"
    >
      <canvas ref="canvasRef"></canvas>

      <div
        v-if="hoveredCell && !isDragging"
        class="tooltip"
        :style="{ left: tooltipPos.x + 'px', top: tooltipPos.y + 'px' }"
      >
        <span>({{ hoveredCell.x }}, {{ hoveredCell.y }})</span>
        <span v-if="hoveredCell.cell"> - {{ hoveredCell.cell.type }}</span>
        <span v-if="hoveredCell.cell?.island"> - {{ hoveredCell.cell.island.name }}</span>
        <span v-if="hoveredCell.cell?.zone"> [Zone {{ hoveredCell.cell.zone }}]</span>
        <span v-if="!hoveredCell.cell"> - Inconnu</span>
      </div>
    </div>

    <div class="legend">
      <div class="legend-item">
        <span class="legend-color sea-z1"></span>
        <span>Mer Z1</span>
      </div>
      <div class="legend-item">
        <span class="legend-color sea-z2"></span>
        <span>Mer Z2</span>
      </div>
      <div class="legend-item">
        <span class="legend-color sea-z3"></span>
        <span>Mer Z3</span>
      </div>
      <div class="legend-item">
        <span class="legend-color sand"></span>
        <span>Plage</span>
      </div>
      <div class="legend-item">
        <span class="legend-color island-known"></span>
        <span>Ile validee</span>
      </div>
      <div class="legend-item">
        <span class="legend-color island-discovered"></span>
        <span>Ile decouverte</span>
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
        <span class="legend-emoji">🚢</span>
        <span>Bateau</span>
      </div>
      <div class="legend-item">
        <span class="legend-emoji">🏝️</span>
        <span>Ile</span>
      </div>
    </div>

    <div class="map-instructions">
      <p>Molette: zoom | Glisser: deplacer | Touch: support mobile</p>
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

.stat.ship-pos { color: #e94560; }
.stat.syncing { color: #f59e0b; animation: blink 1s infinite; }
.stat.synced { color: #22c55e; }

@keyframes blink { 50% { opacity: 0.5; } }

.stat-icon { font-size: 0.85rem; }

.loading-overlay {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 500px;
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

@keyframes spin { to { transform: rotate(360deg); } }

.map-container {
  background: #0a0a14;
  border-radius: 10px;
  overflow: hidden;
  cursor: grab;
  min-height: 700px;
  height: 700px;
  position: relative;
  user-select: none;
  -webkit-user-select: none;
}

.fullscreen {
  background: #0a0a0f;
  border-radius: 0;
  border: none;
  display: flex;
  flex-direction: column;
}

.fullscreen .map-container {
  flex: 1;
  height: auto;
  min-height: 0;
  border-radius: 0;
}

.control-btn.fullscreen:hover {
  background: #6366f1;
  border-color: #6366f1;
}

.map-container:active {
  cursor: grabbing;
}

canvas {
  display: block;
  width: 100%;
  height: 100%;
}

.tooltip {
  position: absolute;
  background: rgba(10, 10, 20, 0.9);
  border: 1px solid #0f3460;
  color: #94a3b8;
  font-size: 0.75rem;
  padding: 4px 8px;
  border-radius: 6px;
  pointer-events: none;
  white-space: nowrap;
  z-index: 100;
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

.legend-color.sea-z1 { background: #7dd3fc; }
.legend-color.sea-z2 { background: #2563eb; }
.legend-color.sea-z3 { background: #1d4ed8; }
.legend-color.sand { background: #d97706; }
.legend-color.island-known { background: #22c55e; border: 2px solid #86efac; }
.legend-color.island-discovered { background: #eab308; border: 2px solid #fde047; }
.legend-color.rocks { background: #57534e; }
.legend-color.unknown { background: rgba(50, 50, 60, 0.5); }

.legend-emoji { font-size: 12px; }

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
