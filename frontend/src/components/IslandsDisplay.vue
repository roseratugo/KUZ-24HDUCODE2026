<script setup>
import { computed } from 'vue';
import { usePlayerStore } from '../stores/player';

const playerStore = usePlayerStore();

const discoveredIslands = computed(() => playerStore.discoveredIslands);
const homeIsland = computed(() => playerStore.homeIsland);
const loading = computed(() => playerStore.loading);

const getStateLabel = (state) => {
  return state === 'KNOWN' ? 'Validee' : 'Decouverte';
};

const getStateClass = (state) => {
  return state === 'KNOWN' ? 'state-known' : 'state-discovered';
};
</script>

<template>
  <div class="islands-display card">
    <h2>Iles Decouvertes</h2>

    <div v-if="loading" class="loading">Chargement...</div>
    <div v-else>
      <div v-if="homeIsland" class="home-island">
        <div class="island-header">
          <span class="home-badge">Ile de depart</span>
        </div>
        <div class="island-name">{{ homeIsland.name }}</div>
        <div class="island-bonus">Bonus: +{{ homeIsland.bonusQuotient }}</div>
      </div>

      <div class="islands-count">
        Total: {{ discoveredIslands.length }} ile(s) decouverte(s)
      </div>

      <div v-if="discoveredIslands.length" class="islands-list">
        <div
          v-for="(item, index) in discoveredIslands"
          :key="index"
          class="island-card"
        >
          <div class="island-info">
            <span class="island-name">{{ item.island.name }}</span>
            <span :class="['island-state', getStateClass(item.islandState)]">
              {{ getStateLabel(item.islandState) }}
            </span>
          </div>
          <div class="island-bonus">+{{ item.island.bonusQuotient }} prod</div>
        </div>
      </div>
      <div v-else class="no-data">Aucune ile decouverte pour le moment</div>
    </div>
  </div>
</template>

<style scoped>
.islands-display {
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
  border-radius: 12px;
  padding: 20px;
  border: 1px solid #0f3460;
}

h2 {
  color: #e94560;
  margin-bottom: 20px;
  font-size: 1.5rem;
  border-bottom: 2px solid #0f3460;
  padding-bottom: 10px;
}

.home-island {
  background: linear-gradient(135deg, #0f3460 0%, #1a1a2e 100%);
  border-radius: 10px;
  padding: 15px;
  margin-bottom: 20px;
  border: 2px solid #e94560;
}

.island-header {
  margin-bottom: 10px;
}

.home-badge {
  background: #e94560;
  color: white;
  padding: 4px 12px;
  border-radius: 20px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
}

.islands-count {
  color: #94a3b8;
  margin-bottom: 15px;
  font-size: 0.875rem;
}

.islands-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 300px;
  overflow-y: auto;
}

.island-card {
  background: rgba(15, 52, 96, 0.5);
  border-radius: 8px;
  padding: 12px 15px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.island-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.island-name {
  color: #fff;
  font-weight: 600;
}

.island-state {
  font-size: 0.75rem;
  padding: 2px 8px;
  border-radius: 10px;
  width: fit-content;
}

.state-known {
  background: rgba(34, 197, 94, 0.2);
  color: #22c55e;
}

.state-discovered {
  background: rgba(245, 158, 11, 0.2);
  color: #f59e0b;
}

.island-bonus {
  color: #22c55e;
  font-weight: 600;
}

.loading, .no-data {
  text-align: center;
  padding: 20px;
  color: #94a3b8;
}
</style>
