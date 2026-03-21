<script setup>
import { computed } from 'vue';
import { usePlayerStore } from '../stores/player';

const playerStore = usePlayerStore();

const resources = computed(() => playerStore.details?.resources || []);
const loading = computed(() => playerStore.loading);

const resourceConfig = {
  BOISIUM: { color: '#8B4513', icon: '🪵', label: 'Boisium' },
  FERONIUM: { color: '#71717a', icon: '⚙️', label: 'Feronium' },
  CHARBONIUM: { color: '#1f1f1f', icon: '⬛', label: 'Charbonium' }
};

const getResourceStyle = (type) => {
  const config = resourceConfig[type] || { color: '#666', icon: '?', label: type };
  return config;
};
</script>

<template>
  <div class="resources-display card">
    <h2>Ressources</h2>

    <div v-if="loading" class="loading">Chargement...</div>
    <div v-else-if="resources.length" class="resources-grid">
      <div
        v-for="resource in resources"
        :key="resource.type"
        class="resource-card"
        :style="{ '--resource-color': getResourceStyle(resource.type).color }"
      >
        <div class="resource-icon">{{ getResourceStyle(resource.type).icon }}</div>
        <div class="resource-info">
          <span class="resource-name">{{ getResourceStyle(resource.type).label }}</span>
          <span class="resource-quantity">{{ resource.quantity.toLocaleString() }}</span>
        </div>
      </div>
    </div>
    <div v-else class="no-data">Aucune ressource</div>
  </div>
</template>

<style scoped>
.resources-display {
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

.resources-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 15px;
}

.resource-card {
  background: rgba(15, 52, 96, 0.5);
  border-radius: 10px;
  padding: 15px;
  display: flex;
  align-items: center;
  gap: 12px;
  border-left: 4px solid var(--resource-color);
  transition: transform 0.2s, box-shadow 0.2s;
}

.resource-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.resource-icon {
  font-size: 2rem;
}

.resource-info {
  display: flex;
  flex-direction: column;
}

.resource-name {
  color: #94a3b8;
  font-size: 0.875rem;
}

.resource-quantity {
  color: #fff;
  font-size: 1.25rem;
  font-weight: 700;
}

.loading, .no-data {
  text-align: center;
  padding: 20px;
  color: #94a3b8;
}
</style>
