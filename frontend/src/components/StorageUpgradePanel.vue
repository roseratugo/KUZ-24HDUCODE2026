<script setup>
import { ref, onMounted } from 'vue';
import { storageApi } from '../api/client';

const nextLevel = ref(null);
const loading = ref(false);
const upgrading = ref(false);
const error = ref(null);
const success = ref(null);

const fetchNextLevel = async () => {
  loading.value = true;
  error.value = null;
  try {
    const res = await storageApi.nextLevel();
    nextLevel.value = res.data;
  } catch (err) {
    error.value = err.response?.data?.message || err.message;
  } finally {
    loading.value = false;
  }
};

const upgrade = async () => {
  upgrading.value = true;
  error.value = null;
  success.value = null;
  try {
    const res = await storageApi.upgrade();
    success.value = 'Entrepot ameliore !';
    nextLevel.value = null;
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
      <h2>Ameliorer l'Entrepot</h2>

      <div v-if="loading" class="loading">Chargement...</div>

      <div v-else-if="nextLevel" class="upgrade-content">
        <div class="level-header">
          <span class="level-name">{{ nextLevel.name }}</span>
          <span class="level-id">Niveau {{ nextLevel.id }}</span>
        </div>

        <div v-if="nextLevel.maxResources" class="section">
          <h3>Capacite max apres upgrade</h3>
          <div class="resource-grid">
            <div
              v-for="(amount, resource) in nextLevel.maxResources"
              :key="resource"
              class="resource-item max"
            >
              <span class="res-icon">{{ resourceLabels[resource]?.icon || '?' }}</span>
              <span class="res-label">{{ resourceLabels[resource]?.label || resource }}</span>
              <span class="res-amount">{{ amount.toLocaleString() }}</span>
            </div>
          </div>
        </div>

        <div v-if="nextLevel.costResources" class="section">
          <h3>Cout de l'amelioration</h3>
          <div class="resource-grid">
            <div
              v-for="(amount, resource) in nextLevel.costResources"
              :key="resource"
              class="resource-item cost"
            >
              <span class="res-icon">{{ resourceLabels[resource]?.icon || '?' }}</span>
              <span class="res-label">{{ resourceLabels[resource]?.label || resource }}</span>
              <span class="res-amount">{{ amount.toLocaleString() }}</span>
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

.section {
  margin-bottom: 20px;
}

.resource-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.resource-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 8px;
}

.resource-item.max {
  background: rgba(34, 197, 94, 0.1);
  border: 1px solid rgba(34, 197, 94, 0.2);
}

.resource-item.cost {
  background: rgba(15, 52, 96, 0.4);
}

.res-icon {
  font-size: 1.3rem;
}

.res-label {
  color: #94a3b8;
  flex: 1;
}

.resource-item.max .res-amount {
  color: #22c55e;
  font-weight: 700;
  font-size: 1.1rem;
}

.resource-item.cost .res-amount {
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
