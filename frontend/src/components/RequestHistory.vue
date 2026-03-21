<script setup>
import { computed, ref } from 'vue';
import { useHistoryStore } from '../stores/history';

const historyStore = useHistoryStore();
const showDetails = ref(null);

const requests = computed(() => historyStore.recentRequests);

const formatTime = (timestamp) => {
  return new Date(timestamp).toLocaleTimeString('fr-FR');
};

const getMethodClass = (method) => {
  const classes = {
    GET: 'method-get',
    POST: 'method-post',
    PUT: 'method-put',
    DELETE: 'method-delete'
  };
  return classes[method] || 'method-default';
};

const toggleDetails = (id) => {
  showDetails.value = showDetails.value === id ? null : id;
};

const clearHistory = () => {
  historyStore.clearHistory();
};
</script>

<template>
  <div class="request-history card">
    <div class="header">
      <h2>Historique des Requetes</h2>
      <div class="header-actions">
        <span class="count">{{ requests.length }} requete(s)</span>
        <button class="clear-btn" @click="clearHistory">Effacer</button>
      </div>
    </div>

    <div v-if="requests.length === 0" class="no-data">
      Aucune requete effectuee
    </div>

    <div v-else class="requests-list">
      <div
        v-for="req in requests"
        :key="req.id"
        class="request-item"
        :class="{ 'has-error': !req.success }"
      >
        <div class="request-header" @click="toggleDetails(req.id)">
          <div class="request-info">
            <span :class="['method', getMethodClass(req.method)]">{{ req.method }}</span>
            <span class="endpoint">{{ req.endpoint }}</span>
          </div>
          <div class="request-meta">
            <span :class="['status', req.success ? 'success' : 'error']">
              {{ req.status || 'ERR' }}
            </span>
            <span v-if="req.duration" class="duration">{{ req.duration }}ms</span>
            <span class="time">{{ formatTime(req.timestamp) }}</span>
          </div>
        </div>

        <div v-if="showDetails === req.id" class="request-details">
          <div v-if="req.data" class="detail-section">
            <span class="detail-label">Request:</span>
            <pre>{{ JSON.stringify(req.data, null, 2) }}</pre>
          </div>
          <div v-if="req.response" class="detail-section">
            <span class="detail-label">Response:</span>
            <pre>{{ JSON.stringify(req.response, null, 2) }}</pre>
          </div>
          <div v-if="req.error" class="detail-section error-section">
            <span class="detail-label">Erreur:</span>
            <pre>{{ req.error }}</pre>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.request-history {
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
  border-radius: 12px;
  padding: 20px;
  border: 1px solid #0f3460;
  max-height: 500px;
  display: flex;
  flex-direction: column;
}

.header {
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

.header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.count {
  color: #94a3b8;
  font-size: 0.875rem;
}

.clear-btn {
  background: rgba(239, 68, 68, 0.2);
  color: #ef4444;
  border: 1px solid #ef4444;
  padding: 4px 10px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.75rem;
  transition: all 0.2s;
}

.clear-btn:hover {
  background: #ef4444;
  color: white;
}

.requests-list {
  overflow-y: auto;
  flex: 1;
}

.request-item {
  background: rgba(15, 52, 96, 0.3);
  border-radius: 8px;
  margin-bottom: 8px;
  overflow: hidden;
}

.request-item.has-error {
  border-left: 3px solid #ef4444;
}

.request-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  cursor: pointer;
  transition: background 0.2s;
}

.request-header:hover {
  background: rgba(15, 52, 96, 0.5);
}

.request-info {
  display: flex;
  align-items: center;
  gap: 10px;
}

.method {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.7rem;
  font-weight: 700;
}

.method-get {
  background: rgba(34, 197, 94, 0.2);
  color: #22c55e;
}

.method-post {
  background: rgba(59, 130, 246, 0.2);
  color: #3b82f6;
}

.method-put {
  background: rgba(245, 158, 11, 0.2);
  color: #f59e0b;
}

.method-delete {
  background: rgba(239, 68, 68, 0.2);
  color: #ef4444;
}

.endpoint {
  color: #fff;
  font-family: monospace;
  font-size: 0.875rem;
}

.request-meta {
  display: flex;
  align-items: center;
  gap: 10px;
}

.status {
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.7rem;
  font-weight: 600;
}

.status.success {
  background: rgba(34, 197, 94, 0.2);
  color: #22c55e;
}

.status.error {
  background: rgba(239, 68, 68, 0.2);
  color: #ef4444;
}

.duration {
  color: #94a3b8;
  font-size: 0.75rem;
}

.time {
  color: #64748b;
  font-size: 0.75rem;
}

.request-details {
  padding: 12px;
  background: rgba(0, 0, 0, 0.2);
  border-top: 1px solid rgba(15, 52, 96, 0.5);
}

.detail-section {
  margin-bottom: 10px;
}

.detail-section:last-child {
  margin-bottom: 0;
}

.detail-label {
  color: #94a3b8;
  font-size: 0.75rem;
  display: block;
  margin-bottom: 5px;
}

pre {
  background: rgba(0, 0, 0, 0.3);
  padding: 10px;
  border-radius: 6px;
  color: #e2e8f0;
  font-size: 0.75rem;
  overflow-x: auto;
  margin: 0;
  max-height: 150px;
  overflow-y: auto;
}

.error-section pre {
  color: #fca5a5;
}

.no-data {
  text-align: center;
  padding: 30px;
  color: #94a3b8;
}
</style>
