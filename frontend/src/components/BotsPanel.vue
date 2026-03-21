<script setup>
import { onMounted, onUnmounted, computed, ref } from 'vue';
import { useBotStore } from '../stores/bot';

const botStore = useBotStore();

const status = computed(() => botStore.status);
const logs = computed(() => botStore.logs);
const isRunning = computed(() => botStore.isRunning);
const isPaused = computed(() => botStore.isPaused);
const botState = computed(() => botStore.botState);
const loading = computed(() => botStore.loading);
const error = computed(() => botStore.error);

const showLogs = ref(true);

const stateLabel = computed(() => {
  const labels = {
    IDLE: 'Arrete',
    EXPLORING: 'Exploration',
    RETURNING: 'Retour',
    RECHARGING: 'Recharge'
  };
  return labels[botState.value] || botState.value;
});

const stateColor = computed(() => {
  const colors = {
    IDLE: '#64748b',
    EXPLORING: '#22c55e',
    RETURNING: '#f59e0b',
    RECHARGING: '#60a5fa'
  };
  return colors[botState.value] || '#64748b';
});

const energyPercent = computed(() => {
  if (!status.value.maxEnergy) return 0;
  return Math.round((status.value.energy / status.value.maxEnergy) * 100);
});

const uptimeFormatted = computed(() => {
  const ms = status.value.uptime || 0;
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
});

const logTypeIcon = (type) => {
  const icons = { info: 'i', success: '+', warn: '!', error: 'x' };
  return icons[type] || 'i';
};

const handleStart = async () => {
  try {
    await botStore.start();
  } catch (err) {
    console.error('Failed to start bot:', err);
  }
};

const handleStop = () => botStore.stop();
const handlePause = () => botStore.pause();
const handleResume = () => botStore.resume();
const handleClearLogs = () => botStore.clearLogs();

onMounted(() => {
  botStore.init();
});

onUnmounted(() => {
  botStore.stopPolling();
});
</script>

<template>
  <div class="bots-panel">
    <div class="header-row">
      <h2>Bot Explorateur</h2>
      <div class="state-badge" :style="{ backgroundColor: stateColor + '30', color: stateColor, borderColor: stateColor }">
        {{ stateLabel }}
      </div>
    </div>

    <div v-if="error" class="error-msg">{{ error }}</div>

    <!-- Controls -->
    <div class="controls">
      <button
        v-if="!isRunning"
        class="btn btn-start"
        :disabled="loading"
        @click="handleStart"
      >
        {{ loading ? 'Demarrage...' : 'Demarrer' }}
      </button>
      <template v-else>
        <button
          v-if="!isPaused"
          class="btn btn-pause"
          @click="handlePause"
        >
          Pause
        </button>
        <button
          v-else
          class="btn btn-resume"
          @click="handleResume"
        >
          Reprendre
        </button>
        <button
          class="btn btn-stop"
          @click="handleStop"
        >
          Arreter
        </button>
      </template>
    </div>

    <!-- Stats -->
    <div class="stats-grid" v-if="status.moveCount > 0 || isRunning">
      <div class="stat-item">
        <span class="stat-value">{{ status.moveCount }}</span>
        <span class="stat-label">Mouvements</span>
      </div>
      <div class="stat-item">
        <span class="stat-value">{{ status.cellsDiscovered }}</span>
        <span class="stat-label">Cellules</span>
      </div>
      <div class="stat-item">
        <span class="stat-value">{{ status.islandsFound }}</span>
        <span class="stat-label">Iles</span>
      </div>
      <div class="stat-item">
        <span class="stat-value">{{ uptimeFormatted }}</span>
        <span class="stat-label">Duree</span>
      </div>
    </div>

    <!-- Energy & Position -->
    <div class="info-section" v-if="isRunning || status.position">
      <div class="info-row">
        <span class="info-label">Position</span>
        <span class="info-value coords" v-if="status.position">
          ({{ status.position.x }}, {{ status.position.y }})
        </span>
        <span class="info-value" v-else>?</span>
      </div>
      <div class="info-row">
        <span class="info-label">Energie</span>
        <div class="energy-mini">
          <div class="energy-mini-bar" :style="{ width: energyPercent + '%' }"></div>
        </div>
        <span class="info-value">{{ status.energy }}/{{ status.maxEnergy }}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Points recharge</span>
        <span class="info-value">{{ status.knownRechargePoints }}</span>
      </div>
    </div>

    <!-- Logs -->
    <div class="logs-section">
      <div class="logs-header">
        <h3 @click="showLogs = !showLogs" class="logs-toggle">
          Logs ({{ logs.length }}) {{ showLogs ? '[-]' : '[+]' }}
        </h3>
        <button v-if="logs.length > 0" class="btn-clear" @click="handleClearLogs">Effacer</button>
      </div>
      <div v-if="showLogs" class="logs-list" ref="logsContainer">
        <div v-if="logs.length === 0" class="no-logs">Aucun log</div>
        <div
          v-for="log in [...logs].reverse().slice(0, 100)"
          :key="log.id"
          :class="['log-entry', `log-${log.type}`]"
        >
          <span class="log-icon">{{ logTypeIcon(log.type) }}</span>
          <span class="log-time">{{ new Date(log.timestamp).toLocaleTimeString('fr-FR') }}</span>
          <span class="log-msg">{{ log.message }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bots-panel {
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
  border-radius: 12px;
  padding: 20px;
  border: 1px solid #0f3460;
}

.header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 15px;
  border-bottom: 2px solid #0f3460;
  padding-bottom: 10px;
}

h2 {
  color: #e94560;
  font-size: 1.3rem;
  margin: 0;
}

.state-badge {
  padding: 4px 12px;
  border-radius: 20px;
  font-size: 0.8rem;
  font-weight: 600;
  border: 1px solid;
}

.error-msg {
  background: rgba(239, 68, 68, 0.2);
  color: #ef4444;
  padding: 8px 12px;
  border-radius: 8px;
  margin-bottom: 12px;
  font-size: 0.85rem;
}

.controls {
  display: flex;
  gap: 8px;
  margin-bottom: 15px;
}

.btn {
  padding: 10px 20px;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 600;
  font-size: 0.9rem;
  transition: all 0.2s;
  flex: 1;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-start {
  background: linear-gradient(135deg, #22c55e, #16a34a);
  color: white;
}

.btn-start:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(34, 197, 94, 0.4);
}

.btn-pause {
  background: linear-gradient(135deg, #f59e0b, #d97706);
  color: white;
}

.btn-resume {
  background: linear-gradient(135deg, #60a5fa, #3b82f6);
  color: white;
}

.btn-stop {
  background: linear-gradient(135deg, #ef4444, #dc2626);
  color: white;
}

.btn:hover:not(:disabled) {
  transform: translateY(-1px);
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin-bottom: 15px;
}

.stat-item {
  background: rgba(15, 52, 96, 0.5);
  padding: 10px 8px;
  border-radius: 8px;
  text-align: center;
}

.stat-value {
  display: block;
  color: #fff;
  font-weight: 700;
  font-size: 1.2rem;
}

.stat-label {
  display: block;
  color: #64748b;
  font-size: 0.7rem;
  margin-top: 2px;
}

.info-section {
  background: rgba(15, 52, 96, 0.3);
  border-radius: 8px;
  padding: 10px;
  margin-bottom: 15px;
}

.info-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 0;
}

.info-label {
  color: #94a3b8;
  font-size: 0.8rem;
}

.info-value {
  color: #fff;
  font-weight: 600;
  font-size: 0.85rem;
}

.info-value.coords {
  font-family: monospace;
  color: #60a5fa;
}

.energy-mini {
  flex: 1;
  max-width: 80px;
  height: 6px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 4px;
  margin: 0 10px;
  overflow: hidden;
}

.energy-mini-bar {
  height: 100%;
  background: linear-gradient(90deg, #22c55e, #16a34a);
  border-radius: 4px;
  transition: width 0.3s;
}

.logs-section {
  border-top: 1px solid #0f3460;
  padding-top: 10px;
}

.logs-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

h3 {
  color: #94a3b8;
  font-size: 0.85rem;
  margin: 0;
}

.logs-toggle {
  cursor: pointer;
  user-select: none;
}

.logs-toggle:hover {
  color: #e94560;
}

.btn-clear {
  background: rgba(15, 52, 96, 0.5);
  border: 1px solid #0f3460;
  color: #64748b;
  padding: 3px 10px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.7rem;
}

.btn-clear:hover {
  color: #ef4444;
  border-color: #ef4444;
}

.logs-list {
  max-height: 250px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.no-logs {
  color: #64748b;
  text-align: center;
  padding: 20px;
  font-size: 0.85rem;
}

.log-entry {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 0.75rem;
  line-height: 1.3;
}

.log-icon {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.6rem;
  font-weight: 700;
  flex-shrink: 0;
  margin-top: 1px;
}

.log-info { background: rgba(96, 165, 250, 0.1); }
.log-info .log-icon { background: rgba(96, 165, 250, 0.3); color: #60a5fa; }

.log-success { background: rgba(34, 197, 94, 0.1); }
.log-success .log-icon { background: rgba(34, 197, 94, 0.3); color: #22c55e; }

.log-warn { background: rgba(245, 158, 11, 0.1); }
.log-warn .log-icon { background: rgba(245, 158, 11, 0.3); color: #f59e0b; }

.log-error { background: rgba(239, 68, 68, 0.1); }
.log-error .log-icon { background: rgba(239, 68, 68, 0.3); color: #ef4444; }

.log-time {
  color: #64748b;
  font-family: monospace;
  white-space: nowrap;
  flex-shrink: 0;
}

.log-msg {
  color: #cbd5e1;
  word-break: break-word;
}
</style>
