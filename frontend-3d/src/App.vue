<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { GameScene } from './three/scene.js';
import { fetchCells, fetchIslands, fetchShipPosition, connectWebSocket } from './three/api.js';

const canvasContainer = ref(null);
const shipPos = ref({ x: 0, y: 0 });
const cellCount = ref(0);
const islandCount = ref(0);
const wsConnected = ref(false);

let gameScene = null;
let disconnectWs = null;

onMounted(async () => {
  gameScene = new GameScene(canvasContainer.value);

  // Load initial data
  try {
    const [cells, islands, shipPosition] = await Promise.all([
      fetchCells(),
      fetchIslands(),
      fetchShipPosition().catch(() => null)
    ]);

    cellCount.value = cells.length;
    islandCount.value = islands.length;

    gameScene.updateCells(cells);

    if (shipPosition) {
      shipPos.value = { x: shipPosition.x, y: shipPosition.y };
      gameScene.updateShipPosition(shipPosition);
    }
  } catch (err) {
    console.error('Failed to load initial data:', err);
  }

  // WebSocket for real-time updates
  disconnectWs = connectWebSocket(({ event, data }) => {
    if (event === 'ws:connected') {
      wsConnected.value = true;
      return;
    }
    if (event === 'ws:disconnected') {
      wsConnected.value = false;
      return;
    }

    if (event === 'cells:update' && data?.cells) {
      gameScene.updateCells(data.cells);
      cellCount.value = gameScene.cells.size;
    }

    if (event === 'island:update' && data?.island) {
      gameScene.updateIsland(data.island);
    }

    if (event === 'ship:position' && data?.position) {
      shipPos.value = { x: data.position.x, y: data.position.y };
      gameScene.updateShipPosition(data.position);
    }
  });
});

onUnmounted(() => {
  if (disconnectWs) disconnectWs();
  if (gameScene) gameScene.dispose();
});
</script>

<template>
  <div ref="canvasContainer" style="width: 100%; height: 100%;"></div>

  <div class="hud">
    <h3>KUZ 3026 - Vue 3D</h3>
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
        {{ wsConnected ? 'Connecte' : 'Deconnecte' }}
      </span>
    </div>
  </div>
</template>
