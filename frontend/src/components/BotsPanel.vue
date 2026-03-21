<script setup>
import { ref, watch, nextTick } from 'vue';
import { useBotStore } from '../stores/bot';

const botStore = useBotStore();
const bot = botStore.bots[0];
const logs = ref([]);
const logsContainer = ref(null);

const toggleBot = () => {
  botStore.toggleBot(bot.id);
};

// Auto-scroll des logs
watch(
  () => botStore.getBotLogs(bot.id).length,
  () => {
    logs.value = botStore.getBotLogs(bot.id);
    nextTick(() => {
      if (logsContainer.value) {
        logsContainer.value.scrollTop = logsContainer.value.scrollHeight;
      }
    });
  }
);

const clearLogs = () => {
  botStore.clearBotLogs(bot.id);
  logs.value = [];
};
</script>

<template>
  <div class="bots-panel">
    <!-- Contrôle -->
    <div class="bot-control">
      <div class="bot-info">
        <span class="bot-icon">🗺️</span>
        <div>
          <h3>Cartographe <span class="tag">Python</span></h3>
          <p class="status">
            <span :class="['dot', bot.isActive ? 'on' : 'off']"></span>
            {{ bot.isActive ? 'En cours' : 'Arrêté' }}
          </p>
        </div>
      </div>
      <div class="bot-actions">
        <button :class="bot.isActive ? 'stop-btn' : 'start-btn'" @click="toggleBot">
          {{ bot.isActive ? '⏹ Arrêter' : '▶ Démarrer' }}
        </button>
        <button class="clear-btn" @click="clearLogs" v-if="logs.length">🗑️</button>
      </div>
    </div>

    <!-- Logs -->
    <div class="logs-box" ref="logsContainer">
      <div v-if="logs.length === 0" class="no-logs">
        <p>Aucun log. Lance le bot pour commencer.</p>
        <p class="hint">N'oublie pas de lancer <code>python bot/explorer.py</code> d'abord.</p>
      </div>
      <div
        v-for="(log, i) in logs"
        :key="i"
        :class="['log-line', log.type]"
      >
        <span class="log-time">{{ log.timestamp }}</span>
        <span class="log-msg">{{ log.message }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bots-panel {
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
  border-radius: 12px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 500px;
}

.bot-control {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 15px;
  padding-bottom: 15px;
  border-bottom: 1px solid #1e293b;
}

.bot-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.bot-icon {
  font-size: 2rem;
  background: rgba(233, 69, 96, 0.1);
  padding: 10px;
  border-radius: 10px;
}

.bot-info h3 {
  margin: 0;
  color: #fff;
  font-size: 1.1rem;
}

.tag {
  font-size: 0.65rem;
  background: #3b82f6;
  color: #fff;
  padding: 2px 6px;
  border-radius: 4px;
  margin-left: 6px;
  vertical-align: middle;
}

.status {
  color: #94a3b8;
  font-size: 0.85rem;
  margin: 4px 0 0;
  display: flex;
  align-items: center;
  gap: 6px;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}
.dot.on { background: #22c55e; box-shadow: 0 0 6px #22c55e; }
.dot.off { background: #64748b; }

.bot-actions {
  display: flex;
  gap: 8px;
}

.start-btn, .stop-btn, .clear-btn {
  padding: 10px 20px;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 600;
  font-size: 0.9rem;
  transition: all 0.2s;
}

.start-btn {
  background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
  color: #fff;
}
.start-btn:hover { transform: scale(1.03); box-shadow: 0 4px 15px rgba(34,197,94,0.4); }

.stop-btn {
  background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
  color: #fff;
}
.stop-btn:hover { transform: scale(1.03); box-shadow: 0 4px 15px rgba(239,68,68,0.4); }

.clear-btn {
  background: rgba(15, 52, 96, 0.5);
  color: #94a3b8;
  padding: 10px 12px;
}
.clear-btn:hover { background: rgba(15, 52, 96, 0.8); color: #fff; }

/* Logs */
.logs-box {
  flex: 1;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid #1e293b;
  border-radius: 8px;
  padding: 10px;
  overflow-y: auto;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 0.8rem;
}

.no-logs {
  text-align: center;
  color: #64748b;
  padding: 40px 20px;
}
.no-logs .hint { font-size: 0.75rem; margin-top: 8px; color: #475569; }
.no-logs code {
  background: rgba(15, 52, 96, 0.5);
  padding: 2px 6px;
  border-radius: 4px;
  color: #94a3b8;
}

.log-line {
  display: flex;
  gap: 10px;
  padding: 4px 8px;
  margin-bottom: 2px;
  border-radius: 3px;
  line-height: 1.4;
}

.log-line.info { border-left: 3px solid #3b82f6; }
.log-line.warn { border-left: 3px solid #f59e0b; background: rgba(245,158,11,0.05); }
.log-line.error { border-left: 3px solid #ef4444; background: rgba(239,68,68,0.05); }

.log-time {
  color: #64748b;
  flex-shrink: 0;
  min-width: 65px;
}

.log-msg {
  color: #cbd5e1;
  word-break: break-word;
}

.logs-box::-webkit-scrollbar { width: 6px; }
.logs-box::-webkit-scrollbar-track { background: transparent; }
.logs-box::-webkit-scrollbar-thumb { background: #0f3460; border-radius: 3px; }
</style>
