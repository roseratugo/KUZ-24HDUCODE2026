<script setup>
import { computed, defineExpose } from 'vue';
import { useBrokerStore } from '../stores/broker';

const brokerStore = useBrokerStore();

// Expose pour usage externe (ex: bot)
defineExpose({
  latestMessage: computed(() => brokerStore.latestMessage),
  messages: computed(() => brokerStore.messages),
  connectionStatus: computed(() => brokerStore.connectionStatus)
});

const filter = ref('all');

import { ref } from 'vue';

const filteredMessages = computed(() => {
  if (filter.value === 'all') return brokerStore.messages;
  return brokerStore.messages.filter(m => m.type === filter.value);
});

const messageTypes = computed(() => {
  const types = new Set(brokerStore.messages.map(m => m.type || 'unknown'));
  return Array.from(types);
});

const stats = computed(() => {
  const typeCount = {};
  brokerStore.messages.forEach(m => {
    const type = m.type || 'unknown';
    typeCount[type] = (typeCount[type] || 0) + 1;
  });
  return typeCount;
});

const connectionStatus = computed(() => brokerStore.connectionStatus);
const error = computed(() => brokerStore.error);
const isConnected = computed(() => brokerStore.isConnected);

const statusLabel = computed(() => {
  if (connectionStatus.value === 'connected') return 'Connecte';
  if (connectionStatus.value === 'connecting') return 'Connexion...';
  if (connectionStatus.value === 'ws_ready') return 'WS OK';
  if (connectionStatus.value === 'error') return 'Erreur';
  return 'Deconnecte';
});

const toggleMessage = (msg) => {
  msg.expanded = !msg.expanded;
};

const clearMessages = () => {
  brokerStore.clearMessages();
};

const formatTimestamp = (ts) => {
  return new Date(ts).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
};

const getEventIcon = (type) => {
  const icons = {
    'ACHAT': '🛒',
    'OFFRE': '📦',
    'OFFRE_SUPPRIMEE': '🗑️',
    'DISCOVERED_ISLAND': '🏝️',
    'VOL': '🦹',
    'RESSOURCE': '💎',
    'status': 'ℹ️',
    'error': '❌'
  };
  return icons[type] || '📨';
};

const getEventColor = (type) => {
  const colors = {
    'ACHAT': '#22c55e',
    'OFFRE': '#3b82f6',
    'OFFRE_SUPPRIMEE': '#f97316',
    'DISCOVERED_ISLAND': '#a855f7',
    'VOL': '#ef4444',
    'RESSOURCE': '#eab308',
    'status': '#6b7280',
    'error': '#ef4444'
  };
  return colors[type] || '#8b949e';
};
</script>

<template>
  <div class="broker-panel">
    <div class="panel-header">
      <div class="header-left">
        <h2>Broker AMQP</h2>
        <span class="subtitle">Evenements temps reel</span>
      </div>
      <div class="header-right">
        <div :class="['status-badge', connectionStatus]">
          <span class="status-dot"></span>
          <span class="status-text">{{ statusLabel }}</span>
        </div>
        <button class="clear-btn" @click="clearMessages" title="Effacer les messages">
          Effacer
        </button>
      </div>
    </div>

    <div v-if="error" class="error-banner">
      {{ error }}
    </div>

    <!-- Stats -->
    <div class="stats-row" v-if="brokerStore.messages.length > 0">
      <div
        v-for="(count, type) in stats"
        :key="type"
        :class="['stat-chip', { active: filter === type }]"
        :style="{ '--chip-color': getEventColor(type) }"
        @click="filter = filter === type ? 'all' : type"
      >
        <span class="chip-icon">{{ getEventIcon(type) }}</span>
        <span class="chip-label">{{ type }}</span>
        <span class="chip-count">{{ count }}</span>
      </div>
    </div>

    <!-- Messages -->
    <div class="messages-container">
      <div v-if="filteredMessages.length === 0" class="no-messages">
        <span class="no-msg-icon">📭</span>
        <p v-if="isConnected">En attente d'evenements...</p>
        <p v-else>Connexion au broker en cours...</p>
      </div>

      <div
        v-for="msg in filteredMessages"
        :key="msg.id"
        :class="['message-item', { expanded: msg.expanded }]"
        :style="{ '--msg-color': getEventColor(msg.type) }"
        @click="toggleMessage(msg)"
      >
        <div class="msg-header">
          <span class="msg-icon">{{ getEventIcon(msg.type) }}</span>
          <span class="msg-type">{{ msg.type }}</span>
          <span class="msg-time">{{ formatTimestamp(msg.timestamp) }}</span>
        </div>
        <div class="msg-preview" v-if="!msg.expanded">
          {{ JSON.stringify(msg.data).substring(0, 100) }}{{ JSON.stringify(msg.data).length > 100 ? '...' : '' }}
        </div>
        <div class="msg-full" v-if="msg.expanded">
          <pre>{{ JSON.stringify(msg.data, null, 2) }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.broker-panel {
  background: linear-gradient(135deg, #0d1117 0%, #161b22 100%);
  border-radius: 12px;
  padding: 20px;
  height: 100%;
  display: flex;
  flex-direction: column;
  color: #c9d1d9;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  padding-bottom: 15px;
  border-bottom: 1px solid #30363d;
}

.header-left h2 {
  color: #58a6ff;
  margin: 0;
  font-size: 1.5rem;
}

.subtitle {
  color: #8b949e;
  font-size: 0.85rem;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.status-badge {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-radius: 20px;
  font-size: 0.85rem;
  font-weight: 500;
}

.status-badge.connected {
  background: rgba(34, 197, 94, 0.15);
  border: 1px solid #22c55e;
}

.status-badge.disconnected,
.status-badge.error {
  background: rgba(248, 81, 73, 0.15);
  border: 1px solid #f85149;
}

.status-badge.connecting,
.status-badge.ws_ready {
  background: rgba(234, 179, 8, 0.15);
  border: 1px solid #eab308;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.status-badge.connected .status-dot {
  background: #22c55e;
  box-shadow: 0 0 6px #22c55e;
  animation: pulse 2s infinite;
}

.status-badge.disconnected .status-dot,
.status-badge.error .status-dot {
  background: #f85149;
}

.status-badge.connecting .status-dot,
.status-badge.ws_ready .status-dot {
  background: #eab308;
  animation: pulse 1s infinite;
}

.status-badge.connected .status-text { color: #22c55e; }
.status-badge.disconnected .status-text,
.status-badge.error .status-text { color: #f85149; }
.status-badge.connecting .status-text,
.status-badge.ws_ready .status-text { color: #eab308; }

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.clear-btn {
  background: #21262d;
  border: 1px solid #30363d;
  color: #c9d1d9;
  padding: 8px 14px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.85rem;
  transition: all 0.2s;
}

.clear-btn:hover {
  background: #30363d;
  border-color: #484f58;
}

.error-banner {
  background: rgba(248, 81, 73, 0.1);
  border: 1px solid #f85149;
  color: #f85149;
  padding: 12px;
  border-radius: 8px;
  margin-bottom: 15px;
  font-size: 0.9rem;
}

.stats-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 15px;
}

.stat-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--chip-color);
  border-radius: 20px;
  cursor: pointer;
  transition: all 0.2s;
}

.stat-chip:hover,
.stat-chip.active {
  background: rgba(255, 255, 255, 0.1);
  transform: scale(1.02);
}

.chip-icon {
  font-size: 0.9rem;
}

.chip-label {
  color: var(--chip-color);
  font-size: 0.75rem;
  font-weight: 600;
}

.chip-count {
  background: var(--chip-color);
  color: #0d1117;
  padding: 2px 6px;
  border-radius: 10px;
  font-size: 0.7rem;
  font-weight: 700;
}

.messages-container {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.no-messages {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #6e7681;
}

.no-msg-icon {
  font-size: 3rem;
  margin-bottom: 10px;
}

.message-item {
  background: #161b22;
  border: 1px solid #30363d;
  border-left: 3px solid var(--msg-color);
  border-radius: 8px;
  padding: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.message-item:hover {
  background: #1c2128;
  border-color: #484f58;
}

.msg-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.msg-icon {
  font-size: 1.1rem;
}

.msg-type {
  color: var(--msg-color);
  font-weight: 600;
  font-size: 0.9rem;
}

.msg-time {
  color: #6e7681;
  font-size: 0.8rem;
  margin-left: auto;
}

.msg-preview {
  color: #8b949e;
  font-size: 0.85rem;
  font-family: monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.msg-full {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid #30363d;
}

.msg-full pre {
  margin: 0;
  padding: 10px;
  background: #0d1117;
  border-radius: 6px;
  font-size: 0.8rem;
  color: #c9d1d9;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
