<script setup>
import { ref, computed, watch } from 'vue';
import { useBotStore } from '../stores/bot';

const botStore = useBotStore();

const categories = [
  { id: 'exploration', name: 'Exploration', icon: '🗺️', description: 'Bots d\'exploration de la carte' },
  { id: 'marketplace', name: 'Marketplace', icon: '💰', description: 'Bots de trading automatique' },
  { id: 'resources', name: 'Ressources', icon: '📦', description: 'Bots de gestion des ressources' },
  { id: 'combat', name: 'Combat', icon: '⚔️', description: 'Bots de vol et défense' }
];

const activeCategory = ref('exploration');
const selectedBotId = ref(null);
const showLogs = ref(false);

const botsInCategory = computed(() => {
  return botStore.getBotsByCategory(activeCategory.value);
});

const selectedBot = computed(() => {
  if (!selectedBotId.value) return null;
  return botStore.getBotById(selectedBotId.value);
});

const selectedBotLogs = computed(() => {
  if (!selectedBotId.value) return [];
  return botStore.getBotLogs(selectedBotId.value);
});

const toggleBot = (botId) => {
  botStore.toggleBot(botId);
  // Sélectionner automatiquement le bot et afficher les logs
  selectedBotId.value = botId;
  showLogs.value = true;
};

const pauseBot = (botId) => {
  botStore.pauseBot(botId);
};

const resumeBot = (botId) => {
  botStore.resumeBot(botId);
};

const selectBot = (botId) => {
  if (selectedBotId.value === botId) {
    selectedBotId.value = null;
    showLogs.value = false;
  } else {
    selectedBotId.value = botId;
    showLogs.value = true; // Afficher les logs automatiquement
  }
};

const clearLogs = () => {
  if (selectedBotId.value) {
    botStore.clearBotLogs(selectedBotId.value);
  }
};

const formatUptime = (startTime) => {
  if (!startTime) return '-';
  const seconds = Math.floor((Date.now() - startTime) / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
};

const getStatusColor = (status) => {
  switch (status) {
    case 'running': return '#22c55e';
    case 'paused': return '#f59e0b';
    case 'stopped': return '#64748b';
    default: return '#64748b';
  }
};

const getStatusText = (status) => {
  switch (status) {
    case 'running': return 'En cours';
    case 'paused': return 'En pause';
    case 'stopped': return 'Arrêté';
    default: return 'Inconnu';
  }
};

// Auto-scroll logs
watch(selectedBotLogs, () => {
  if (showLogs.value) {
    setTimeout(() => {
      const logsContainer = document.querySelector('.logs-content');
      if (logsContainer) {
        logsContainer.scrollTop = logsContainer.scrollHeight;
      }
    }, 50);
  }
}, { deep: true });
</script>

<template>
  <div class="bots-panel">
    <div class="panel-header">
      <h2>Centre de Contrôle des Bots</h2>
      <p class="subtitle">Automatisez vos actions avec des bots intelligents</p>
    </div>

    <div class="categories">
      <button
        v-for="cat in categories"
        :key="cat.id"
        :class="['category-btn', { active: activeCategory === cat.id }]"
        @click="activeCategory = cat.id; selectedBotId = null;"
      >
        <span class="icon">{{ cat.icon }}</span>
        <span class="name">{{ cat.name }}</span>
      </button>
    </div>

    <div class="category-description">
      <p>{{ categories.find(c => c.id === activeCategory)?.description }}</p>
    </div>

    <div class="main-content">
      <div class="bots-grid">
        <div
          v-for="bot in botsInCategory"
          :key="bot.id"
          :class="['bot-card', {
            active: bot.isActive,
            disabled: !bot.isAvailable,
            selected: selectedBotId === bot.id
          }]"
          @click="selectBot(bot.id)"
        >
          <div class="bot-header">
            <span class="bot-icon">{{ bot.icon }}</span>
            <div class="bot-title">
              <h3>{{ bot.name }}</h3>
              <span
                class="status-badge"
                :style="{ backgroundColor: getStatusColor(bot.status) + '33', color: getStatusColor(bot.status) }"
              >
                {{ getStatusText(bot.status) }}
              </span>
            </div>
          </div>

          <p class="bot-description">{{ bot.description }}</p>

          <div class="bot-stats" v-if="bot.isActive">
            <div class="stat">
              <span class="label">Uptime</span>
              <span class="value">{{ formatUptime(bot.startTime) }}</span>
            </div>
            <div class="stat">
              <span class="label">Actions</span>
              <span class="value">{{ bot.actionsCount || 0 }}</span>
            </div>
            <div class="stat" v-if="bot.cellsDiscovered !== undefined">
              <span class="label">Cellules</span>
              <span class="value">{{ bot.cellsDiscovered || 0 }}</span>
            </div>
            <div class="stat" v-if="bot.energy !== undefined">
              <span class="label">Energie</span>
              <span class="value">{{ bot.energy }}/{{ bot.maxEnergy }}</span>
            </div>
          </div>

          <div class="bot-position" v-if="bot.isActive && bot.currentPosition">
            <span class="pos-label">Position:</span>
            <span class="pos-value">({{ bot.currentPosition.x }}, {{ bot.currentPosition.y }})</span>
          </div>

          <div class="bot-config" v-if="bot.config && !bot.isActive">
            <div v-for="(value, key) in bot.config" :key="key" class="config-item">
              <span class="config-label">{{ key }}:</span>
              <span class="config-value">{{ value }}</span>
            </div>
          </div>

          <div class="bot-actions" @click.stop>
            <template v-if="bot.isActive">
              <button
                v-if="bot.status === 'running'"
                class="pause-btn"
                @click="pauseBot(bot.id)"
              >
                ⏸ Pause
              </button>
              <button
                v-else-if="bot.status === 'paused'"
                class="resume-btn"
                @click="resumeBot(bot.id)"
              >
                ▶ Reprendre
              </button>
              <button
                class="stop-btn"
                @click="toggleBot(bot.id)"
              >
                ⏹ Arrêter
              </button>
            </template>
            <template v-else>
              <button
                class="start-btn"
                :disabled="!bot.isAvailable"
                @click="toggleBot(bot.id)"
              >
                ▶ Démarrer
              </button>
            </template>
          </div>

          <div v-if="!bot.isAvailable" class="unavailable-overlay">
            <span>{{ bot.unavailableReason || 'Non disponible' }}</span>
          </div>
        </div>

        <div v-if="botsInCategory.length === 0" class="no-bots">
          <span class="empty-icon">🤖</span>
          <p>Aucun bot disponible dans cette catégorie</p>
          <p class="hint">Les bots seront ajoutés prochainement...</p>
        </div>
      </div>

      <!-- Panneau de logs (toujours visible si un bot est sélectionné) -->
      <div v-if="selectedBot" class="logs-panel">
        <div class="logs-header">
          <h3>{{ selectedBot.icon }} {{ selectedBot.name }} - Logs</h3>
          <div class="logs-actions">
            <button class="toggle-logs-btn" @click="showLogs = !showLogs">
              {{ showLogs ? '▼ Masquer' : '▶ Afficher' }}
            </button>
            <button class="clear-logs-btn" @click="clearLogs" v-if="showLogs">
              🗑️ Effacer
            </button>
          </div>
        </div>
        <div v-if="showLogs" class="logs-content">
          <div v-if="selectedBotLogs.length === 0" class="no-logs">
            Aucun log disponible
          </div>
          <div
            v-for="(log, index) in selectedBotLogs"
            :key="index"
            :class="['log-entry', log.type]"
          >
            <span class="log-time">{{ log.timestamp }}</span>
            <span class="log-message">{{ log.message }}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="global-stats">
      <div class="stat-card">
        <span class="stat-icon">🟢</span>
        <div class="stat-info">
          <span class="stat-value">{{ botStore.activeBotsCount }}</span>
          <span class="stat-label">Bots actifs</span>
        </div>
      </div>
      <div class="stat-card">
        <span class="stat-icon">📊</span>
        <div class="stat-info">
          <span class="stat-value">{{ botStore.totalActions }}</span>
          <span class="stat-label">Actions totales</span>
        </div>
      </div>
      <div class="stat-card">
        <span class="stat-icon">⚡</span>
        <div class="stat-info">
          <span class="stat-value">{{ botStore.bots.filter(b => b.isAvailable).length }}</span>
          <span class="stat-label">Bots disponibles</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bots-panel {
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
  border-radius: 12px;
  padding: 25px;
  min-height: 600px;
}

.panel-header {
  text-align: center;
  margin-bottom: 25px;
}

.panel-header h2 {
  color: #e94560;
  font-size: 1.5rem;
  margin: 0 0 5px;
}

.panel-header .subtitle {
  color: #94a3b8;
  font-size: 0.9rem;
  margin: 0;
}

.categories {
  display: flex;
  gap: 10px;
  justify-content: center;
  margin-bottom: 15px;
  flex-wrap: wrap;
}

.category-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  background: rgba(15, 52, 96, 0.5);
  border: 1px solid #0f3460;
  border-radius: 25px;
  color: #94a3b8;
  cursor: pointer;
  transition: all 0.2s;
}

.category-btn:hover {
  background: rgba(15, 52, 96, 0.8);
  color: #fff;
  transform: translateY(-2px);
}

.category-btn.active {
  background: linear-gradient(135deg, #e94560 0%, #c73659 100%);
  border-color: #e94560;
  color: #fff;
}

.category-btn .icon {
  font-size: 1.2rem;
}

.category-description {
  text-align: center;
  color: #64748b;
  font-size: 0.85rem;
  margin-bottom: 20px;
}

.main-content {
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
}

.bots-grid {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 20px;
  margin-bottom: 25px;
  min-width: 300px;
}

.bot-card {
  background: rgba(10, 10, 15, 0.6);
  border: 1px solid #1e293b;
  border-radius: 12px;
  padding: 20px;
  position: relative;
  transition: all 0.3s;
  cursor: pointer;
}

.bot-card:hover {
  border-color: #0f3460;
  transform: translateY(-3px);
  box-shadow: 0 8px 25px rgba(0, 0, 0, 0.3);
}

.bot-card.active {
  border-color: #22c55e;
  box-shadow: 0 0 20px rgba(34, 197, 94, 0.2);
}

.bot-card.selected {
  border-color: #e94560;
  box-shadow: 0 0 20px rgba(233, 69, 96, 0.3);
}

.bot-card.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.bot-header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 12px;
}

.bot-icon {
  font-size: 2rem;
  background: rgba(233, 69, 96, 0.1);
  padding: 10px;
  border-radius: 10px;
}

.bot-title {
  flex: 1;
}

.bot-title h3 {
  margin: 0 0 5px;
  font-size: 1.1rem;
  color: #fff;
}

.status-badge {
  font-size: 0.7rem;
  padding: 3px 8px;
  border-radius: 10px;
  font-weight: 500;
}

.bot-description {
  color: #94a3b8;
  font-size: 0.85rem;
  margin: 0 0 15px;
  line-height: 1.4;
}

.bot-stats {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  margin-bottom: 15px;
  padding: 10px;
  background: rgba(34, 197, 94, 0.1);
  border-radius: 8px;
}

.bot-stats .stat {
  display: flex;
  flex-direction: column;
}

.bot-stats .label {
  font-size: 0.7rem;
  color: #64748b;
  text-transform: uppercase;
}

.bot-stats .value {
  font-size: 0.95rem;
  color: #22c55e;
  font-weight: 600;
}

.bot-position {
  background: rgba(15, 52, 96, 0.3);
  padding: 8px 12px;
  border-radius: 6px;
  margin-bottom: 15px;
  font-size: 0.85rem;
}

.pos-label {
  color: #64748b;
}

.pos-value {
  color: #94a3b8;
  font-weight: 500;
  margin-left: 5px;
}

.bot-config {
  background: rgba(15, 52, 96, 0.3);
  border-radius: 8px;
  padding: 10px;
  margin-bottom: 15px;
}

.config-item {
  display: flex;
  justify-content: space-between;
  font-size: 0.8rem;
  padding: 3px 0;
}

.config-label {
  color: #64748b;
}

.config-value {
  color: #94a3b8;
  font-weight: 500;
}

.bot-actions {
  display: flex;
  gap: 10px;
}

.start-btn, .stop-btn, .pause-btn, .resume-btn {
  flex: 1;
  padding: 10px;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 600;
  transition: all 0.2s;
}

.start-btn {
  background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
  color: #fff;
}

.start-btn:hover:not(:disabled) {
  transform: scale(1.02);
  box-shadow: 0 4px 15px rgba(34, 197, 94, 0.4);
}

.stop-btn {
  background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
  color: #fff;
}

.stop-btn:hover {
  transform: scale(1.02);
  box-shadow: 0 4px 15px rgba(239, 68, 68, 0.4);
}

.pause-btn {
  background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
  color: #fff;
}

.pause-btn:hover {
  transform: scale(1.02);
  box-shadow: 0 4px 15px rgba(245, 158, 11, 0.4);
}

.resume-btn {
  background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
  color: #fff;
}

.resume-btn:hover {
  transform: scale(1.02);
  box-shadow: 0 4px 15px rgba(59, 130, 246, 0.4);
}

.start-btn:disabled, .stop-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.unavailable-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(10, 10, 15, 0.8);
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ef4444;
  font-weight: 500;
}

.no-bots {
  grid-column: 1 / -1;
  text-align: center;
  padding: 50px;
  color: #64748b;
}

.no-bots .empty-icon {
  font-size: 3rem;
  display: block;
  margin-bottom: 15px;
  opacity: 0.5;
}

.no-bots p {
  margin: 5px 0;
}

.no-bots .hint {
  font-size: 0.85rem;
  color: #475569;
}

/* Logs panel */
.logs-panel {
  flex: 1;
  min-width: 350px;
  max-width: 500px;
  background: rgba(10, 10, 15, 0.6);
  border: 1px solid #1e293b;
  border-radius: 12px;
  overflow: hidden;
}

.logs-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 15px;
  background: rgba(15, 52, 96, 0.3);
  border-bottom: 1px solid #1e293b;
}

.logs-header h3 {
  margin: 0;
  font-size: 1rem;
  color: #fff;
}

.logs-actions {
  display: flex;
  gap: 10px;
}

.toggle-logs-btn, .clear-logs-btn {
  padding: 5px 10px;
  background: rgba(15, 52, 96, 0.5);
  border: 1px solid #0f3460;
  border-radius: 5px;
  color: #94a3b8;
  cursor: pointer;
  font-size: 0.8rem;
  transition: all 0.2s;
}

.toggle-logs-btn:hover, .clear-logs-btn:hover {
  background: rgba(15, 52, 96, 0.8);
  color: #fff;
}

.logs-content {
  max-height: 400px;
  overflow-y: auto;
  padding: 10px;
}

.no-logs {
  text-align: center;
  color: #64748b;
  padding: 30px;
}

.log-entry {
  display: flex;
  gap: 10px;
  padding: 6px 10px;
  margin-bottom: 4px;
  background: rgba(15, 52, 96, 0.2);
  border-radius: 4px;
  font-size: 0.8rem;
  font-family: monospace;
}

.log-entry.error {
  background: rgba(239, 68, 68, 0.1);
  border-left: 3px solid #ef4444;
}

.log-entry.warn {
  background: rgba(245, 158, 11, 0.1);
  border-left: 3px solid #f59e0b;
}

.log-entry.info {
  border-left: 3px solid #3b82f6;
}

.log-time {
  color: #64748b;
  flex-shrink: 0;
}

.log-message {
  color: #94a3b8;
  word-break: break-word;
}

.global-stats {
  display: flex;
  gap: 20px;
  justify-content: center;
  flex-wrap: wrap;
  margin-top: 25px;
}

.stat-card {
  display: flex;
  align-items: center;
  gap: 12px;
  background: rgba(15, 52, 96, 0.3);
  padding: 15px 25px;
  border-radius: 10px;
  border: 1px solid #1e293b;
}

.stat-icon {
  font-size: 1.5rem;
}

.stat-info {
  display: flex;
  flex-direction: column;
}

.stat-value {
  font-size: 1.3rem;
  font-weight: 700;
  color: #fff;
}

.stat-label {
  font-size: 0.75rem;
  color: #64748b;
  text-transform: uppercase;
}

/* Scrollbar pour les logs */
.logs-content::-webkit-scrollbar {
  width: 6px;
}

.logs-content::-webkit-scrollbar-track {
  background: rgba(15, 52, 96, 0.2);
}

.logs-content::-webkit-scrollbar-thumb {
  background: #0f3460;
  border-radius: 3px;
}

.logs-content::-webkit-scrollbar-thumb:hover {
  background: #1a5490;
}
</style>
