<script setup>
import { ref, computed, onMounted } from 'vue';
import { theftsApi } from '../api/client';

const thefts = ref([]);
const loading = ref(false);
const sending = ref(false);
const error = ref(null);

const resourceType = ref('BOISIUM');
const moneySpent = ref(300);

const resourceOptions = ['BOISIUM', 'FERONIUM', 'CHARBONIUM'];

const sortedThefts = computed(() => {
  return [...thefts.value].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
});

const fetchThefts = async () => {
  loading.value = true;
  try {
    const res = await theftsApi.getAll();
    thefts.value = res.data;
  } catch (err) {
    console.error('Failed to fetch thefts:', err);
  } finally {
    loading.value = false;
  }
};

const launchTheft = async () => {
  sending.value = true;
  error.value = null;
  try {
    await theftsApi.steal(resourceType.value, moneySpent.value);
    await fetchThefts();
  } catch (err) {
    error.value = err.response?.data?.message || err.message;
  } finally {
    sending.value = false;
  }
};

const statusColor = (status) => {
  if (status === 'PENDING') return '#f59e0b';
  if (status === 'SUCCESS') return '#22c55e';
  return '#ef4444';
};

const chanceLabel = (chance) => {
  if (chance === 'FORTE') return '🟢 Forte';
  if (chance === 'MOYENNE') return '🟡 Moyenne';
  return '🔴 Faible';
};

const formatDate = (iso) => {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

onMounted(fetchThefts);
</script>

<template>
  <div class="thefts-panel">
    <div class="theft-form card">
      <h2>Lancer un vol</h2>
      <div class="form-row">
        <label>Ressource</label>
        <select v-model="resourceType">
          <option v-for="r in resourceOptions" :key="r" :value="r">{{ r }}</option>
        </select>
      </div>
      <div class="form-row">
        <label>Or depense</label>
        <input type="number" v-model.number="moneySpent" min="1" />
      </div>
      <button class="steal-btn" @click="launchTheft" :disabled="sending">
        {{ sending ? 'Envoi...' : 'Lancer le vol' }}
      </button>
      <p v-if="error" class="error-msg">{{ error }}</p>
    </div>

    <div class="theft-list card">
      <div class="list-header">
        <h2>Vols ({{ thefts.length }})</h2>
        <button class="refresh-small" @click="fetchThefts" :disabled="loading">↻</button>
      </div>

      <div v-if="loading" class="loading">Chargement...</div>
      <div v-else-if="sortedThefts.length === 0" class="no-data">Aucun vol</div>
      <div v-else class="thefts-grid">
        <div v-for="theft in sortedThefts" :key="theft.id" class="theft-card">
          <div class="theft-header">
            <span class="theft-resource">{{ theft.resourceType }}</span>
            <span class="theft-status" :style="{ color: statusColor(theft.status) }">
              {{ theft.status }}
            </span>
          </div>
          <div class="theft-details">
            <div class="detail">
              <span class="label">Or depense</span>
              <span class="value">{{ theft.moneySpent }}</span>
            </div>
            <div class="detail">
              <span class="label">Quantite volee</span>
              <span class="value">{{ theft.amountAttempted }}</span>
            </div>
            <div class="detail">
              <span class="label">Chance</span>
              <span class="value">{{ chanceLabel(theft.chance) }}</span>
            </div>
            <div class="detail">
              <span class="label">Lance a</span>
              <span class="value">{{ formatDate(theft.createdAt) }}</span>
            </div>
            <div class="detail">
              <span class="label">Resolu a</span>
              <span class="value">{{ formatDate(theft.resolveAt) }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.thefts-panel {
  display: flex;
  flex-direction: column;
  gap: 20px;
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
  margin-bottom: 15px;
  font-size: 1.3rem;
  border-bottom: 2px solid #0f3460;
  padding-bottom: 8px;
}

.form-row {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-bottom: 12px;
}

.form-row label {
  color: #94a3b8;
  font-size: 0.85rem;
}

.form-row select,
.form-row input {
  background: rgba(15, 52, 96, 0.8);
  border: 1px solid #0f3460;
  color: #fff;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 0.9rem;
}

.steal-btn {
  width: 100%;
  background: #e94560;
  color: #fff;
  border: none;
  padding: 10px;
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s;
  margin-top: 5px;
}

.steal-btn:hover:not(:disabled) {
  background: #d1304a;
}

.steal-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.error-msg {
  color: #ef4444;
  font-size: 0.85rem;
  margin-top: 8px;
}

.list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.list-header h2 {
  margin-bottom: 0;
  border-bottom: none;
  padding-bottom: 0;
}

.refresh-small {
  background: rgba(15, 52, 96, 0.8);
  border: 1px solid #0f3460;
  color: #94a3b8;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  cursor: pointer;
  font-size: 1rem;
}

.refresh-small:hover {
  color: #fff;
}

.thefts-grid {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 500px;
  overflow-y: auto;
}

.theft-card {
  background: rgba(15, 52, 96, 0.4);
  border-radius: 8px;
  padding: 12px;
  border: 1px solid rgba(15, 52, 96, 0.8);
}

.theft-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.theft-resource {
  color: #fff;
  font-weight: 600;
  font-size: 0.95rem;
}

.theft-status {
  font-weight: 700;
  font-size: 0.85rem;
  text-transform: uppercase;
}

.theft-details {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.detail {
  display: flex;
  flex-direction: column;
}

.detail .label {
  color: #64748b;
  font-size: 0.75rem;
}

.detail .value {
  color: #cbd5e1;
  font-size: 0.85rem;
}

.loading, .no-data {
  text-align: center;
  padding: 20px;
  color: #94a3b8;
}
</style>
