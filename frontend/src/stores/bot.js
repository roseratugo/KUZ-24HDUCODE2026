import { defineStore } from 'pinia';
import { ref, computed, markRaw } from 'vue';
import { ExplorationBot } from '../bots/ExplorationBot';
import { useShipStore } from './ship';
import { useMapStore } from './map';
import { usePlayerStore } from './player';

export const useBotStore = defineStore('bot', () => {
  const botInstances = ref({});
  const botLogs = ref({});

  const bots = ref([
    {
      id: 'exploration-bot',
      name: 'Cartographe',
      icon: '🗺️',
      description: 'Bot d\'exploration automatique',
      isActive: false,
      isAvailable: true,
      status: 'stopped'
    }
  ]);

  const activeBotsCount = computed(() => bots.value.filter(b => b.isActive).length);
  const totalActions = computed(() => 0);

  const getBotsByCategory = () => bots.value;
  const getBotById = (id) => bots.value.find(b => b.id === id);
  const getBotLogs = (id) => botLogs.value[id] || [];
  const clearBotLogs = (id) => { botLogs.value[id] = []; };
  const getBotStats = (id) => botInstances.value[id]?.getStats() || null;
  const updateBotConfig = () => {};

  const toggleBot = async (botId) => {
    const bot = bots.value.find(b => b.id === botId);
    if (!bot) return;

    if (bot.isActive) {
      const instance = botInstances.value[bot.id];
      if (instance) instance.stop();
      delete botInstances.value[bot.id];
      bot.isActive = false;
      bot.status = 'stopped';
    } else {
      const shipStore = useShipStore();
      const mapStore = useMapStore();
      const playerStore = usePlayerStore();

      const instance = new ExplorationBot();
      botLogs.value[bot.id] = botLogs.value[bot.id] || [];

      instance.onLog = (entry) => {
        botLogs.value[bot.id].push(entry);
        if (botLogs.value[bot.id].length > 100) {
          botLogs.value[bot.id] = botLogs.value[bot.id].slice(-100);
        }
      };

      instance.onStatusChange = (status) => {
        bot.status = status;
        if (status === 'stopped') bot.isActive = false;
      };

      botInstances.value[bot.id] = markRaw(instance);
      bot.isActive = true;
      bot.status = 'running';

      instance.start(shipStore, mapStore, playerStore).catch(err => {
        console.error('Bot error:', err);
        bot.isActive = false;
        bot.status = 'stopped';
      });
    }
  };

  const pauseBot = (id) => {
    const bot = bots.value.find(b => b.id === id);
    const instance = botInstances.value[id];
    if (instance && bot) { instance.pause(); bot.status = 'paused'; }
  };

  const resumeBot = (id) => {
    const bot = bots.value.find(b => b.id === id);
    const instance = botInstances.value[id];
    if (instance && bot) { instance.resume(); bot.status = 'running'; }
  };

  const stopAllBots = () => bots.value.forEach(b => { if (b.isActive) toggleBot(b.id); });

  return {
    bots, botLogs, activeBotsCount, totalActions,
    getBotsByCategory, toggleBot, pauseBot, resumeBot, stopAllBots,
    getBotById, getBotLogs, clearBotLogs, getBotStats, updateBotConfig
  };
});
