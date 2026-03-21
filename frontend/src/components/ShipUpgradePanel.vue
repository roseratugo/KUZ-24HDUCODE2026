<script setup>
import { ref, onMounted } from 'vue';
import { shipApi } from '../api/client';

const nextLevel = ref(null);
const loading = ref(false);
const upgrading = ref(false);
const error = ref(null);
const success = ref(null);

const fetchNextLevel = async () => {
  loading.value = true;
  error.value = null;
  try {
    const res = await shipApi.nextLevel();
    nextLevel.value = res.data;
  } catch (err) {
    error.value = err.response?.data?.message || err.message;
  } finally {
    loading.value = false;
  }
};

const upgrade = async () => {
  if (!nextLevel.value?.id) return;
  upgrading.value = true;
  error.value = null;
  success.value = null;
  try {
    await shipApi.upgrade(nextLevel.value.id);
    success.value = 'Bateau ameliore !';
    await fetchNextLevel();
  } catch (err) {
    error.value = err.response?.data?.message || err.message;
  } finally {
    upgrading.value = false;
  }
};

const resourceLabels = {
  FERONIUM: { icon: '⚙️', label: 'Feronium' },
  BOISIUM: { icon: '🪵', label: 'Boisium' },
  CHARBONIUM: { icon: '⬛', label: 'Charbonium' }
};

onMounted(fetchNextLevel);
</script>

<template>
  <div class="upgrade-panel">
    <div class="card">
      <h2>Ameliorer le Bateau</h2>

      <div v-if="loading" class="loading">Chargement...</div>

      <div v-else-if="nextLevel" class="upgrade-content">
        <div class="next-level-info">
          <div class="level-header">
            <span class="level-name">{{ nextLevel.name }}</span>
            <span class="level-id">Niveau {{ nextLevel.id }}</span>
          </div>

          <div class="stats-grid">
            <div class="stat">
              <span class="stat-label">Portee de vision</span>
              <span class="stat-value">{{ nextLevel.visibilityRange }}</span>
            </div>
            <div class="stat">
              <span class="stat-label">Mouvement max</span>
              <span class="stat-value">{{ nextLevel.maxMovement }}</span>
            </div>
            <div class="stat">
              <span class="stat-label">Vitesse</span>
              <span class="stat-value">{{ nextLevel.speed }}ms</span>
            </div>
          </div>
        </div>

        <div v-if="nextLevel.costResources" class="cost-section">
          <h3>Cout de l'amelioration</h3>
          <div class="cost-grid">
            <div
              v-for="(amount, resource) in nextLevel.costResources"
              :key="resource"
              class="cost-item"
            >
              <span class="cost-icon">{{ resourceLabels[resource]?.icon || '?' }}</span>
              <span class="cost-label">{{ resourceLabels[resource]?.label || resource }}</span>
              <span class="cost-amount">{{ amount.toLocaleString() }}</span>
            </div>
          </div>
        </div>

        <button class="upgrade-btn" @click="upgrade" :disabled="upgrading">
          {{ upgrading ? 'Amelioration...' : 'Ameliorer' }}
        </button>

        <p v-if="success" class="success-msg">{{ success }}</p>
        <p v-if="error" class="error-msg">{{ error }}</p>
      </div>

      <div v-else class="no-data">
        <p>{{ error || 'Niveau max atteint ou donnees indisponibles' }}</p>
        <button class="retry-btn" @click="fetchNextLevel">Reessayer</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.upgrade-panel {
  height: 100%;
}

.card {
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
  border-radius: 12px;
  padding: 20px;
  border: 1px solid #0f3460;
}

h2 {
  color: #e94560;
  margin-bottom: 20px;
  font-size: 1.3rem;
  border-bottom: 2px solid #0f3460;
  padding-bottom: 8px;
}

h3 {
  color: #94a3b8;
  font-size: 1rem;
  margin-bottom: 12px;
}

.level-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  padding: 12px;
  background: rgba(233, 69, 96, 0.1);
  border: 1px solid rgba(233, 69, 96, 0.3);
  border-radius: 8px;
}

.level-name {
  color: #e94560;
  font-size: 1.2rem;
  font-weight: 700;
  text-transform: capitalize;
}

.level-id {
  color: #94a3b8;
  font-size: 0.9rem;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 20px;
}

.stat {
  background: rgba(15, 52, 96, 0.5);
  border-radius: 8px;
  padding: 12px;
  text-align: center;
}

.stat-label {
  display: block;
  color: #64748b;
  font-size: 0.75rem;
  margin-bottom: 4px;
}

.stat-value {
  display: block;
  color: #22c55e;
  font-size: 1.3rem;
  font-weight: 700;
}

.cost-section {
  margin-bottom: 20px;
}

.cost-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cost-item {
  display: flex;
  align-items: center;
  gap: 10px;
  background: rgba(15, 52, 96, 0.4);
  padding: 10px 14px;
  border-radius: 8px;
}

.cost-icon {
  font-size: 1.3rem;
}

.cost-label {
  color: #94a3b8;
  flex: 1;
}

.cost-amount {
  color: #f59e0b;
  font-weight: 700;
  font-size: 1.1rem;
}

.upgrade-btn {
  width: 100%;
  background: #22c55e;
  color: #fff;
  border: none;
  padding: 12px;
  border-radius: 8px;
  font-weight: 700;
  font-size: 1rem;
  cursor: pointer;
  transition: background 0.2s;
}

.upgrade-btn:hover:not(:disabled) {
  background: #16a34a;
}

.upgrade-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.success-msg {
  color: #22c55e;
  text-align: center;
  margin-top: 10px;
  font-weight: 600;
}

.error-msg {
  color: #ef4444;
  text-align: center;
  margin-top: 10px;
}

.retry-btn {
  background: rgba(15, 52, 96, 0.8);
  border: 1px solid #0f3460;
  color: #94a3b8;
  padding: 8px 16px;
  border-radius: 8px;
  cursor: pointer;
  margin-top: 10px;
}

.loading, .no-data {
  text-align: center;
  padding: 20px;
  color: #94a3b8;
}
</style>
