import { defineStore } from 'pinia';
import { ref, computed, markRaw } from 'vue';
import { ExplorationBot } from '../bots/ExplorationBot';
import { useShipStore } from './ship';
import { useMapStore } from './map';
import { usePlayerStore } from './player';

export const useBotStore = defineStore('bot', () => {
  // Instances des bots réels (markRaw pour éviter la réactivité profonde)
  const botInstances = ref({});

  // Logs des bots
  const botLogs = ref({});

  const bots = ref([
    // Exploration bot - Le seul bot fonctionnel pour l'instant
    {
      id: 'exploration-bot',
      name: 'Cartographe',
      category: 'exploration',
      icon: '🗺️',
      description: 'Explore automatiquement la carte, découvre les îles et gère l\'énergie pour ne jamais se bloquer. Retourne sur les îles connues pour valider les découvertes.',
      isActive: false,
      isAvailable: true,
      startTime: null,
      actionsCount: 0,
      cellsDiscovered: 0,
      islandsDiscovered: 0,
      currentPosition: null,
      energy: 0,
      maxEnergy: 0,
      status: 'stopped', // stopped, running, paused
      config: {
        'Pattern': 'Linéaire',
        'Énergie réserve': '3',
        'Délai (ms)': '100'
      }
    },
    // Bots futurs - Non disponibles pour l'instant
    {
      id: 'island-validator',
      name: 'Validateur d\'îles',
      category: 'exploration',
      icon: '✅',
      description: 'Se concentre sur la validation des îles découvertes en faisant des allers-retours.',
      isActive: false,
      isAvailable: false,
      unavailableReason: 'En développement',
      startTime: null,
      actionsCount: 0,
      config: null
    },
    {
      id: 'auto-trader',
      name: 'Auto Trader',
      category: 'marketplace',
      icon: '📈',
      description: 'Achète et vend automatiquement des ressources selon les seuils de prix configurés.',
      isActive: false,
      isAvailable: false,
      unavailableReason: 'En développement',
      startTime: null,
      actionsCount: 0,
      config: null
    },
    {
      id: 'price-sniper',
      name: 'Price Sniper',
      category: 'marketplace',
      icon: '🎯',
      description: 'Surveille les offres et achète instantanément les bonnes affaires.',
      isActive: false,
      isAvailable: false,
      unavailableReason: 'En développement',
      startTime: null,
      actionsCount: 0,
      config: null
    },
    {
      id: 'auto-collector',
      name: 'Auto Collector',
      category: 'resources',
      icon: '⛏️',
      description: 'Collecte automatiquement les ressources sur les îles visitées.',
      isActive: false,
      isAvailable: false,
      unavailableReason: 'En développement',
      startTime: null,
      actionsCount: 0,
      config: null
    },
    {
      id: 'auto-thief',
      name: 'Auto Thief',
      category: 'combat',
      icon: '🦹',
      description: 'Vole automatiquement les ressources des autres joueurs.',
      isActive: false,
      isAvailable: false,
      unavailableReason: 'En développement',
      startTime: null,
      actionsCount: 0,
      config: null
    }
  ]);

  const getBotsByCategory = (category) => {
    return bots.value.filter(bot => bot.category === category);
  };

  const activeBotsCount = computed(() => {
    return bots.value.filter(bot => bot.isActive).length;
  });

  const totalActions = computed(() => {
    return bots.value.reduce((sum, bot) => sum + (bot.actionsCount || 0), 0);
  });

  const toggleBot = async (botId) => {
    const bot = bots.value.find(b => b.id === botId);
    if (!bot || !bot.isAvailable) return;

    if (bot.isActive) {
      await stopBot(bot);
    } else {
      await startBot(bot);
    }
  };

  const startBot = async (bot) => {
    if (bot.id === 'exploration-bot') {
      await startExplorationBot(bot);
    } else {
      console.warn(`Bot ${bot.id} n'a pas d'implémentation`);
    }
  };

  const startExplorationBot = async (bot) => {
    const shipStore = useShipStore();
    const mapStore = useMapStore();
    const playerStore = usePlayerStore();

    // Convertir le pattern en format interne
    const patternMap = {
      'linéaire': 'linear',
      'lineaire': 'linear',
      'linear': 'linear',
      'spirale': 'spiral',
      'spiral': 'spiral',
      'aléatoire': 'random',
      'aleatoire': 'random',
      'random': 'random'
    };
    const pattern = patternMap[bot.config['Pattern']?.toLowerCase()] || 'linear';

    // Créer l'instance du bot
    const explorationBot = new ExplorationBot({
      minEnergyReserve: parseInt(bot.config['Énergie réserve']) || 3,
      moveDelay: parseInt(bot.config['Délai (ms)']) || 100,
      explorationPattern: pattern
    });

    // Initialiser les logs
    if (!botLogs.value[bot.id]) {
      botLogs.value[bot.id] = [];
    }

    // Callbacks
    explorationBot.onLog = (logEntry) => {
      botLogs.value[bot.id].push(logEntry);
      // Garder seulement les 100 derniers logs
      if (botLogs.value[bot.id].length > 100) {
        botLogs.value[bot.id] = botLogs.value[bot.id].slice(-100);
      }
    };

    explorationBot.onMove = (moveData) => {
      bot.actionsCount++;
      bot.currentPosition = moveData.position;
      bot.energy = moveData.energy;
    };

    explorationBot.onDiscovery = (discovery) => {
      if (discovery.type === 'island') {
        bot.islandsDiscovered += discovery.cells.length;
      }
      bot.cellsDiscovered += discovery.cells?.length || 0;
    };

    explorationBot.onStatusChange = (status) => {
      bot.status = status;
      if (status === 'stopped') {
        bot.isActive = false;
      }
    };

    // Sauvegarder l'instance (markRaw pour éviter la réactivité)
    botInstances.value[bot.id] = markRaw(explorationBot);

    // Mettre à jour l'état
    bot.isActive = true;
    bot.startTime = Date.now();
    bot.actionsCount = 0;
    bot.cellsDiscovered = 0;
    bot.islandsDiscovered = 0;
    bot.status = 'running';

    // Démarrer le bot (ne pas await car runLoop est une boucle infinie)
    explorationBot.start(shipStore, mapStore, playerStore).catch(err => {
      console.error('Erreur démarrage bot:', err);
      botLogs.value[bot.id].push({
        timestamp: new Date().toLocaleTimeString(),
        message: `❌ ERREUR FATALE: ${err.message}`,
        type: 'error'
      });
      bot.isActive = false;
      bot.status = 'stopped';
    });
  };

  const stopBot = async (bot) => {
    const instance = botInstances.value[bot.id];
    if (instance) {
      instance.stop();
      delete botInstances.value[bot.id];
    }

    bot.isActive = false;
    bot.status = 'stopped';
  };

  const pauseBot = (botId) => {
    const bot = bots.value.find(b => b.id === botId);
    const instance = botInstances.value[botId];
    if (instance && bot) {
      instance.pause();
      bot.status = 'paused';
    }
  };

  const resumeBot = (botId) => {
    const bot = bots.value.find(b => b.id === botId);
    const instance = botInstances.value[botId];
    if (instance && bot) {
      instance.resume();
      bot.status = 'running';
    }
  };

  const stopAllBots = () => {
    bots.value.forEach(bot => {
      if (bot.isActive) {
        stopBot(bot);
      }
    });
  };

  const getBotById = (botId) => {
    return bots.value.find(b => b.id === botId);
  };

  const getBotLogs = (botId) => {
    return botLogs.value[botId] || [];
  };

  const clearBotLogs = (botId) => {
    botLogs.value[botId] = [];
  };

  const getBotStats = (botId) => {
    const instance = botInstances.value[botId];
    if (instance) {
      return instance.getStats();
    }
    return null;
  };

  const updateBotConfig = (botId, config) => {
    const bot = bots.value.find(b => b.id === botId);
    if (bot && !bot.isActive) {
      bot.config = { ...bot.config, ...config };
    }
  };

  // Mettre à jour les stats périodiquement
  const updateActiveBotsStats = () => {
    bots.value.forEach(bot => {
      if (bot.isActive && botInstances.value[bot.id]) {
        const stats = botInstances.value[bot.id].getStats();
        if (stats) {
          bot.actionsCount = stats.actionsCount;
          bot.cellsDiscovered = stats.cellsDiscovered;
          bot.islandsDiscovered = stats.islandsDiscovered;
          bot.currentPosition = stats.currentPosition;
          bot.energy = stats.energy;
          bot.maxEnergy = stats.maxEnergy;
        }
      }
    });
  };

  // Lancer la mise à jour périodique
  setInterval(updateActiveBotsStats, 1000);

  return {
    bots,
    botLogs,
    getBotsByCategory,
    activeBotsCount,
    totalActions,
    toggleBot,
    pauseBot,
    resumeBot,
    stopAllBots,
    getBotById,
    getBotLogs,
    clearBotLogs,
    getBotStats,
    updateBotConfig
  };
});
