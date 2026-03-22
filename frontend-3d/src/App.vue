<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { GameScene } from './three/scene.js';
import { fetchCells, fetchIslands, fetchShipPosition, connectWebSocket } from './three/api.js';
import Minimap from './components/Minimap.vue';
import ShipControls from './components/ShipControls.vue';
import Compass from './components/Compass.vue';
import EscapeMenu from './components/EscapeMenu.vue';

const menuVisible = ref(false);

function onGlobalKeydown(e) {
  if (e.key === 'Escape') {
    menuVisible.value = !menuVisible.value;
  }
}

const canvasContainer = ref(null);
const shipPos = ref({ x: 0, y: 0 });
const cellCount = ref(0);
const islandCount = ref(0);
const wsConnected = ref(false);
const devMode = ref(false);
const allCells = ref(new Map());

let gameScene = null;
const getCamera = () => gameScene?.camera;
const getTarget = () => gameScene?.controls?.target;
let disconnectWs = null;

// Demo data for dev mode (no backend)
function loadDevFallback() {
  devMode.value = true;
  console.log('[3D] Dev mode: using fallback data');

  const demoCells = [];
  // Create a few islands
  const islands = [
    { id: 'island-1', name: 'Ile du Soleil', x: 0, y: 0, radius: 2 },
    { id: 'island-2', name: 'Ile des Palmiers', x: 15, y: -12, radius: 1 },
    { id: 'island-3', name: 'Ile Mystere', x: -12, y: 15, radius: 3 },
  ];

  islands.forEach(isl => {
    for (let dx = -isl.radius; dx <= isl.radius; dx++) {
      for (let dy = -isl.radius; dy <= isl.radius; dy++) {
        if (dx * dx + dy * dy <= isl.radius * isl.radius) {
          demoCells.push({
            x: isl.x + dx,
            y: isl.y + dy,
            type: 'SAND',
            zone: 1,
            island: { id: isl.id, name: isl.name }
          });
        }
      }
    }
  });

  // Sea around
  for (let x = -15; x <= 15; x++) {
    for (let y = -15; y <= 15; y++) {
      const key = `${x},${y}`;
      if (!demoCells.find(c => c.x === x && c.y === y)) {
        demoCells.push({ x, y, type: 'SEA', zone: 1 });
      }
    }
  }

  gameScene.updateCells(demoCells);
  cellCount.value = demoCells.length;
  islandCount.value = islands.length;
  allCells.value = gameScene.cells;

  // Place ship
  shipPos.value = { x: 5, y: 0 };
  gameScene.updateShipPosition({ x: 5, y: 0 });
}

onMounted(async () => {
  window.addEventListener('keydown', onGlobalKeydown);
  gameScene = new GameScene(canvasContainer.value);

  // Try loading from backend
  try {
    const [cells, islands, shipPosition] = await Promise.all([
      fetchCells(),
      fetchIslands(),
      fetchShipPosition().catch(() => null)
    ]);

    if (!cells || cells.length === 0) {
      throw new Error('No data from backend');
    }

    // Set ship position FIRST so islands are generated around the boat
    if (shipPosition) {
      shipPos.value = { x: shipPosition.x, y: shipPosition.y };
      gameScene.updateShipPosition(shipPosition);
    }

    // Then load cells (filtered by ship position radius)
    cellCount.value = cells.length;
    islandCount.value = islands.length;
    gameScene.updateCells(cells);
    allCells.value = gameScene.cells;

    // WebSocket for real-time updates
    disconnectWs = connectWebSocket(({ event, data }) => {
      if (event === 'ws:connected') { wsConnected.value = true; return; }
      if (event === 'ws:disconnected') { wsConnected.value = false; return; }

      if (event === 'cells:update' && data?.cells) {
        gameScene.updateCells(data.cells);
        cellCount.value = gameScene.cells.size;
        allCells.value = gameScene.cells;
      }
      if (event === 'island:update' && data?.island) {
        gameScene.updateIsland(data.island);
      }
      if (event === 'ship:position' && data?.position) {
        shipPos.value = { x: data.position.x, y: data.position.y };
        gameScene.updateShipPosition(data.position);
      }
    });
  } catch (err) {
    console.warn('Backend unavailable, loading dev fallback:', err.message);
    loadDevFallback();
  }
});

function onShipMoved(position) {
  if (!position || !gameScene) return;
  shipPos.value = { x: position.x, y: position.y };
  gameScene.updateShipPosition(position);
}

onUnmounted(() => {
  window.removeEventListener('keydown', onGlobalKeydown);
  if (disconnectWs) disconnectWs();
  if (gameScene) gameScene.dispose();
});
</script>

<template>
  <div ref="canvasContainer" style="width: 100%; height: 100%;"></div>

  <div class="hud">
    <h3>KUZ 3026 - Vue 3D</h3>
    <div v-if="devMode" class="row">
      <span class="label" style="color: #f59e0b;">Mode Demo</span>
    </div>
    <div class="row">
      <span class="label">Position</span>
      <span class="value">({{ shipPos.x }}, {{ shipPos.y }})</span>
    </div>
    <div class="row">
      <span class="label">Cellules</span>
      <span class="value">{{ cellCount }}</span>
    </div>
    <div class="row">
      <span class="label">Iles</span>
      <span class="value">{{ islandCount }}</span>
    </div>
    <div class="row">
      <span class="label">WebSocket</span>
      <span class="value">
        <span :class="['ws-status', wsConnected ? 'connected' : 'disconnected']"></span>
        {{ wsConnected ? 'Connecte' : devMode ? 'Demo' : 'Deconnecte' }}
      </span>
    </div>
  </div>

  <div v-if="!menuVisible" class="esc-hint">ESC - Menu</div>

  <ShipControls v-if="!menuVisible" @moved="onShipMoved" />
  <Compass :getCamera="getCamera" :getTarget="getTarget" />
  <Minimap :cells="allCells" :shipX="shipPos.x" :shipY="shipPos.y" />
  <EscapeMenu :visible="menuVisible" @close="menuVisible = false" />
</template>
