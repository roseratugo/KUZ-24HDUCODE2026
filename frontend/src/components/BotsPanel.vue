<script setup>
import { useBotStore } from '../stores/bot';

const botStore = useBotStore();

const bot = botStore.bots[0];

const toggleBot = () => {
  botStore.toggleBot(bot.id);
};
</script>

<template>
  <div class="bots-panel">
    <div class="bot-card">
      <span class="bot-icon">🗺️</span>
      <h3>Cartographe</h3>
      <p class="status">{{ bot.isActive ? '🟢 En cours' : '⚪ Arrêté' }}</p>
      <button
        class="start-btn"
        @click="toggleBot"
      >
        {{ bot.isActive ? '⏹ Arrêter' : '▶ Démarrer' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.bots-panel {
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
  border-radius: 12px;
  padding: 25px;
  display: flex;
  justify-content: center;
}

.bot-card {
  background: rgba(10, 10, 15, 0.6);
  border: 1px solid #1e293b;
  border-radius: 12px;
  padding: 30px;
  text-align: center;
  min-width: 250px;
}

.bot-icon {
  font-size: 3rem;
  display: block;
  margin-bottom: 10px;
}

h3 {
  color: #fff;
  margin: 0 0 10px;
}

.status {
  color: #94a3b8;
  margin: 0 0 20px;
  font-size: 0.9rem;
}

.start-btn {
  width: 100%;
  padding: 12px;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 600;
  font-size: 1rem;
  background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
  color: #fff;
  transition: all 0.2s;
}

.start-btn:hover {
  transform: scale(1.02);
  box-shadow: 0 4px 15px rgba(34, 197, 94, 0.4);
}
</style>
