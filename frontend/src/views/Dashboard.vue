<script setup>
import { onMounted, onUnmounted, ref, computed } from 'vue';
import { usePlayerStore } from '../stores/player';
import { useShipStore } from '../stores/ship';
import { useBrokerStore } from '../stores/broker';
import { CREDENTIALS } from '../api/config';
import PlayerInfo from '../components/PlayerInfo.vue';
import ResourcesDisplay from '../components/ResourcesDisplay.vue';
import IslandsDisplay from '../components/IslandsDisplay.vue';
import ShipControl from '../components/ShipControl.vue';
import WorldMap from '../components/WorldMap.vue';
import RequestHistory from '../components/RequestHistory.vue';
import TheftsPanel from '../components/TheftsPanel.vue';
import ShipUpgradePanel from '../components/ShipUpgradePanel.vue';
import StorageUpgradePanel from '../components/StorageUpgradePanel.vue';
import Marketplace from '../components/Marketplace.vue';
import BotsPanel from '../components/BotsPanel.vue';
import BrokerPanel from '../components/BrokerPanel.vue';

const playerStore = usePlayerStore();
const shipStore = useShipStore();
const brokerStore = useBrokerStore();

const lastRefresh = ref(null);
const activeTab = ref('map');
const autoRefreshEnabled = ref(true);
const countdown = ref(30); // Polling reduit a 30s car broker en temps reel

let autoRefreshInterval = null;
let countdownInterval = null;

// Status broker
const brokerConnected = computed(() => brokerStore.isConnected);

const refresh = () => {
  playerStore.refreshAll().then(() => {
    lastRefresh.value = new Date().toLocaleTimeString();
  });
  countdown.value = 30;
};

const startAutoRefresh = () => {
  if (autoRefreshInterval) clearInterval(autoRefreshInterval);
  if (countdownInterval) clearInterval(countdownInterval);

  // Polling reduit a 30 secondes (le broker gere les mises a jour en temps reel)
  autoRefreshInterval = setInterval(() => {
    if (autoRefreshEnabled.value) {
      refresh();
    }
  }, 30000);

  countdownInterval = setInterval(() => {
    if (autoRefreshEnabled.value) {
      countdown.value = countdown.value > 0 ? countdown.value - 1 : 30;
    }
  }, 1000);
};

const toggleAutoRefresh = () => {
  autoRefreshEnabled.value = !autoRefreshEnabled.value;
  if (autoRefreshEnabled.value) {
    countdown.value = 30;
  }
};

onMounted(async () => {
  shipStore.loadPositionFromDB();

  // Charger les donnees initiales
  await playerStore.refreshAll();
  lastRefresh.value = new Date().toLocaleTimeString();

  // Connecter le broker si les donnees joueur sont disponibles
  if (playerStore.details?.id) {
    brokerStore.connect(playerStore.details.id, CREDENTIALS.brokerTeamName);
  }

  startAutoRefresh();
});

onUnmounted(() => {
  if (autoRefreshInterval) clearInterval(autoRefreshInterval);
  if (countdownInterval) clearInterval(countdownInterval);
  brokerStore.disconnect();
});
</script>

<template>
  <div class="dashboard">
    <header class="dashboard-header">
      <div class="header-content">
        <h1>3026 - Dashboard</h1>
        <p class="subtitle">Explorez, commercez, decouvrez le nouveau monde</p>
      </div>
      <div class="header-actions">
        <div :class="['broker-indicator', brokerConnected ? 'connected' : 'disconnected']">
          {{ brokerConnected ? 'Broker connecte' : 'Broker deconnecte' }}
        </div>
        <span v-if="lastRefresh" class="last-refresh">
          Refresh: {{ lastRefresh }}
          <span v-if="autoRefreshEnabled" class="countdown">({{ countdown }}s)</span>
        </span>
        <button @click="toggleAutoRefresh" :class="['auto-refresh-btn', { active: autoRefreshEnabled }]">
          {{ autoRefreshEnabled ? 'Auto ON' : 'Auto OFF' }}
        </button>
        <button @click="refresh" class="refresh-btn">Refresh</button>
      </div>
    </header>

    <nav class="dashboard-nav">
      <button 
        v-for="tab in ['map', 'marketplace', 'thefts', 'upgrades', 'bots', 'broker', 'history']" 
        :key="tab"
        :class="['nav-btn', { active: activeTab === tab }]"
        @click="activeTab = tab"
      >
        {{ tab === 'map' ? 'Carte' : 
           tab === 'marketplace' ? 'Marche' : 
           tab === 'thefts' ? 'Vols' : 
           tab === 'upgrades' ? 'Upgrades' : 
           tab === 'bots' ? 'Bots' :
           tab === 'broker' ? 'Broker' :
           'Historique' }}
      </button>
    </nav>

    <main class="dashboard-main">
      <aside class="sidebar">
        <PlayerInfo />
        <ResourcesDisplay />
        <IslandsDisplay />
        <ShipControl />
      </aside>

      <section class="content">
        <WorldMap v-show="activeTab === 'map'" />
        <Marketplace v-show="activeTab === 'marketplace'" />
        <TheftsPanel v-show="activeTab === 'thefts'" />
        <div v-show="activeTab === 'upgrades'" class="upgrades-container">
          <ShipUpgradePanel />
          <StorageUpgradePanel />
        </div>
        <BotsPanel v-show="activeTab === 'bots'" />
        <BrokerPanel v-show="activeTab === 'broker'" />
        <RequestHistory v-show="activeTab === 'history'" />
      </section>
    </main>
  </div>
</template>

<style scoped>
.dashboard {
  min-height: 100vh;
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
  color: #fff;
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
}

.dashboard-header {
  padding: 1rem 2rem;
  background: rgba(0, 0, 0, 0.3);
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.header-content h1 {
  margin: 0;
  font-size: 1.8rem;
  background: linear-gradient(135deg, #00d4ff, #9b59b6);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.subtitle {
  margin: 0.25rem 0 0;
  font-size: 0.9rem;
  opacity: 0.7;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.broker-indicator {
  padding: 0.4rem 0.8rem;
  border-radius: 20px;
  font-size: 0.8rem;
  font-weight: 500;
}

.broker-indicator.connected {
  background: rgba(39, 174, 96, 0.3);
  color: #27ae60;
  border: 1px solid #27ae60;
}

.broker-indicator.disconnected {
  background: rgba(231, 76, 60, 0.3);
  color: #e74c3c;
  border: 1px solid #e74c3c;
}

.last-refresh {
  font-size: 0.85rem;
  opacity: 0.8;
}

.countdown {
  color: #00d4ff;
}

.auto-refresh-btn,
.refresh-btn {
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.3s ease;
}

.auto-refresh-btn {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.auto-refresh-btn.active {
  background: rgba(39, 174, 96, 0.3);
  color: #27ae60;
}

.refresh-btn {
  background: linear-gradient(135deg, #00d4ff, #9b59b6);
  color: #fff;
}

.refresh-btn:hover {
  transform: scale(1.05);
}

.dashboard-nav {
  display: flex;
  gap: 0.5rem;
  padding: 1rem 2rem;
  background: rgba(0, 0, 0, 0.2);
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.nav-btn {
  padding: 0.6rem 1.2rem;
  border: none;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  transition: all 0.3s ease;
  font-weight: 500;
}

.nav-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.nav-btn.active {
  background: linear-gradient(135deg, #00d4ff, #9b59b6);
  color: #fff;
}

.dashboard-main {
  display: flex;
  gap: 1.5rem;
  padding: 1.5rem 2rem;
  min-height: calc(100vh - 140px);
}

.sidebar {
  width: 320px;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  flex-shrink: 0;
}

.content {
  flex: 1;
  min-width: 0;
}

.upgrades-container {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
  gap: 1.5rem;
}

@media (max-width: 1200px) {
  .dashboard-main {
    flex-direction: column;
  }

  .sidebar {
    width: 100%;
    flex-direction: row;
    flex-wrap: wrap;
  }

  .sidebar > * {
    flex: 1;
    min-width: 280px;
  }
}
</style>
