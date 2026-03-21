<script setup>
import { computed } from 'vue';
import { usePlayerStore } from '../stores/player';

const playerStore = usePlayerStore();

const details = computed(() => playerStore.details);
const loading = computed(() => playerStore.loading);
const error = computed(() => playerStore.error);

const storage = computed(() => details.value?.storage);
const storageUsage = computed(() => {
  if (!storage.value || !details.value?.resources) return [];
  return details.value.resources.map(res => ({
    type: res.type,
    quantity: res.quantity,
    max: storage.value.maxResources[res.type] || 0,
    percent: storage.value.maxResources[res.type]
      ? Math.round((res.quantity / storage.value.maxResources[res.type]) * 100)
      : 0
  }));
});

const getResourceIcon = (type) => {
  const icons = {
    BOISIUM: '🪵',
    FERONIUM: '⚙️',
    CHARBONIUM: '⬛'
  };
  return icons[type] || '📦';
};

const getStorageBarColor = (percent) => {
  if (percent >= 90) return '#ef4444';
  if (percent >= 70) return '#f59e0b';
  return '#22c55e';
};
</script>

<template>
  <div class="player-info card">
    <h2>Informations du Joueur</h2>

    <div v-if="loading" class="loading">Chargement...</div>
    <div v-else-if="error" class="error">{{ error }}</div>
    <div v-else-if="details" class="details">
      <div class="player-header">
        <div class="player-name">{{ details.name }}</div>
        <div class="player-id">ID: {{ details.id?.slice(0, 8) }}...</div>
      </div>

      <div class="stats-grid">
        <div class="stat-card gold">
          <span class="stat-icon">💰</span>
          <div class="stat-info">
            <span class="stat-value">{{ details.money?.toLocaleString() }}</span>
            <span class="stat-label">Or</span>
          </div>
        </div>
        <div class="stat-card">
          <span class="stat-icon">⚡</span>
          <div class="stat-info">
            <span class="stat-value">{{ details.quotient }}</span>
            <span class="stat-label">Production</span>
          </div>
        </div>
      </div>

      <div class="section">
        <h3>Ile de depart</h3>
        <div class="home-island">
          <span class="island-icon">🏝️</span>
          <span class="island-name">{{ details.home?.name || 'N/A' }}</span>
          <span class="island-bonus">+{{ details.home?.bonusQuotient || 0 }}</span>
        </div>
      </div>

      <div class="section" v-if="storage">
        <h3>Entrepot: {{ storage.name }}</h3>
        <div class="storage-level">Niveau {{ storage.levelId }}</div>
        <div class="storage-bars">
          <div v-for="item in storageUsage" :key="item.type" class="storage-item">
            <div class="storage-header">
              <span class="resource-icon">{{ getResourceIcon(item.type) }}</span>
              <span class="resource-name">{{ item.type }}</span>
              <span class="resource-count">{{ item.quantity }} / {{ item.max }}</span>
            </div>
            <div class="storage-bar-container">
              <div
                class="storage-bar"
                :style="{
                  width: item.percent + '%',
                  backgroundColor: getStorageBarColor(item.percent)
                }"
              ></div>
            </div>
          </div>
        </div>
      </div>

      <div class="section">
        <h3>Statut</h3>
        <div class="status-row">
          <span class="status-label">Marketplace:</span>
          <span :class="['status-value', details.marketPlaceDiscovered ? 'success' : 'warning']">
            {{ details.marketPlaceDiscovered ? 'Decouverte' : 'Non decouverte' }}
          </span>
        </div>
        <div class="status-row">
          <span class="status-label">Iles decouvertes:</span>
          <span class="status-value">{{ details.discoveredIslands?.length || 0 }}</span>
        </div>
        <div class="status-row">
          <span class="status-label">Amis:</span>
          <span class="status-value">{{ details.friends?.length || 0 }}</span>
        </div>
        <div class="status-row">
          <span class="status-label">Offres actives:</span>
          <span class="status-value">{{ details.offers?.length || 0 }}</span>
        </div>
      </div>
    </div>
    <div v-else class="no-data">Aucune donnee disponible</div>
  </div>
</template>

<style scoped>
.player-info {
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
  border-radius: 12px;
  padding: 20px;
  border: 1px solid #0f3460;
}

h2 {
  color: #e94560;
  margin-bottom: 15px;
  font-size: 1.3rem;
  border-bottom: 2px solid #0f3460;
  padding-bottom: 10px;
}

h3 {
  color: #94a3b8;
  font-size: 0.85rem;
  margin: 0 0 10px 0;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.player-header {
  margin-bottom: 15px;
}

.player-name {
  font-size: 1.4rem;
  font-weight: 700;
  color: #fff;
}

.player-id {
  font-size: 0.75rem;
  color: #64748b;
  font-family: monospace;
}

.stats-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-bottom: 15px;
}

.stat-card {
  background: rgba(15, 52, 96, 0.5);
  border-radius: 10px;
  padding: 12px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.stat-card.gold {
  border: 1px solid rgba(255, 215, 0, 0.3);
}

.stat-icon {
  font-size: 1.5rem;
}

.stat-info {
  display: flex;
  flex-direction: column;
}

.stat-value {
  font-size: 1.1rem;
  font-weight: 700;
  color: #fff;
}

.stat-card.gold .stat-value {
  color: #ffd700;
}

.stat-label {
  font-size: 0.7rem;
  color: #94a3b8;
}

.section {
  background: rgba(15, 52, 96, 0.3);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 12px;
}

.section:last-child {
  margin-bottom: 0;
}

.home-island {
  display: flex;
  align-items: center;
  gap: 10px;
}

.island-icon {
  font-size: 1.2rem;
}

.island-name {
  color: #fff;
  font-weight: 600;
  flex: 1;
}

.island-bonus {
  color: #22c55e;
  font-weight: 600;
  font-size: 0.85rem;
}

.storage-level {
  font-size: 0.75rem;
  color: #64748b;
  margin-bottom: 10px;
}

.storage-bars {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.storage-item {
  background: rgba(0, 0, 0, 0.2);
  border-radius: 6px;
  padding: 8px;
}

.storage-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 5px;
}

.resource-icon {
  font-size: 0.9rem;
}

.resource-name {
  color: #94a3b8;
  font-size: 0.75rem;
  flex: 1;
}

.resource-count {
  color: #fff;
  font-size: 0.75rem;
  font-weight: 600;
}

.storage-bar-container {
  background: rgba(0, 0, 0, 0.3);
  border-radius: 4px;
  height: 6px;
  overflow: hidden;
}

.storage-bar {
  height: 100%;
  border-radius: 4px;
  transition: width 0.3s, background-color 0.3s;
}

.status-row {
  display: flex;
  justify-content: space-between;
  padding: 6px 0;
  border-bottom: 1px solid rgba(15, 52, 96, 0.5);
}

.status-row:last-child {
  border-bottom: none;
}

.status-label {
  color: #94a3b8;
  font-size: 0.85rem;
}

.status-value {
  color: #fff;
  font-weight: 600;
  font-size: 0.85rem;
}

.success {
  color: #22c55e;
}

.warning {
  color: #f59e0b;
}

.loading, .error, .no-data {
  text-align: center;
  padding: 20px;
  color: #94a3b8;
}

.error {
  color: #ef4444;
}
</style>
