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
          <span class="broker-dot"></span>
          <span class="broker-label">{{ brokerConnected ? 'Broker OK' : 'Broker OFF' }}</span>
        </div>
        <div class="auto-refresh-toggle">
          <button
            :class="['toggle-btn', { active: autoRefreshEnabled }]"
            @click="toggleAutoRefresh"
            :title="autoRefreshEnabled ? 'Desactiver auto-refresh' : 'Activer auto-refresh'"
          >
            <span v-if="autoRefreshEnabled">🔄 {{ countdown }}s</span>
            <span v-else>⏸️ Pause</span>
          </button>
        </div>
        <span v-if="lastRefresh" class="last-refresh">
          MaJ: {{ lastRefresh }}
        </span>
        <button class="refresh-btn" @click="refresh">↻</button>
      </div>
    </header>

    <main class="dashboard-content">
      <div class="tabs">
        <button
          :class="['tab', { active: activeTab === 'map' }]"
          @click="activeTab = 'map'"
        >
          Carte & Navigation
        </button>
        <button
          :class="['tab', { active: activeTab === 'ship-upgrade' }]"
          @click="activeTab = 'ship-upgrade'"
        >
          Bateau
        </button>
        <button
          :class="['tab', { active: activeTab === 'storage-upgrade' }]"
          @click="activeTab = 'storage-upgrade'"
        >
          Entrepot
        </button>
        <button
          :class="['tab', { active: activeTab === 'thefts' }]"
          @click="activeTab = 'thefts'"
        >
          Vols
        </button>
        <button
          :class="['tab', { active: activeTab === 'history' }]"
          @click="activeTab = 'history'"
        >
          Historique Requetes
        </button>
        <button
          :class="['tab', { active: activeTab === 'marketplace' }]"
          @click="activeTab = 'marketplace'"
        >
          Marketplace
        </button>
        <button
          :class="['tab', { active: activeTab === 'broker' }]"
          @click="activeTab = 'broker'"
        >
          Broker
        </button>
      </div>

      <div :class="['grid-layout', { 'marketplace-mode': activeTab === 'marketplace' || activeTab === 'broker' }]">
        <div v-show="activeTab !== 'marketplace' && activeTab !== 'broker'" class="col-left">
          <PlayerInfo />
          <ResourcesDisplay />
          <IslandsDisplay />
        </div>
        <div :class="['col-center', { 'col-full': activeTab === 'marketplace' || activeTab === 'broker' }]">
          <div v-show="activeTab === 'map'" class="tab-content">
            <WorldMap />
          </div>
          <div v-show="activeTab === 'ship-upgrade'" class="tab-content">
            <ShipUpgradePanel />
          </div>
          <div v-show="activeTab === 'storage-upgrade'" class="tab-content">
            <StorageUpgradePanel />
          </div>
          <div v-show="activeTab === 'thefts'" class="tab-content">
            <TheftsPanel />
          </div>
          <div v-show="activeTab === 'history'" class="tab-content">
            <RequestHistory />
          </div>
          <div v-show="activeTab === 'marketplace'" class="tab-content">
            <Marketplace />
          </div>
          <div v-show="activeTab === 'broker'" class="tab-content">
            <BrokerPanel />
          </div>
        </div>
        <div v-show="activeTab !== 'marketplace' && activeTab !== 'broker'" class="col-right">
          <ShipControl />
        </div>
      </div>
    </main>

    <footer class="dashboard-footer">
      <p>24h du Code 2026 - Equipe KUZ</p>
    </footer>
  </div>
</template>

<style scoped>
.dashboard {
  min-height: 100vh;
  background: #0a0a0f;
  color: #fff;
}

.dashboard-header {
  background: linear-gradient(135deg, #1a1a2e 0%, #0f3460 100%);
  padding: 15px 30px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 2px solid #e94560;
}

.header-content h1 {
  font-size: 1.8rem;
  color: #e94560;
  margin: 0;
}

.subtitle {
  color: #94a3b8;
  margin: 3px 0 0;
  font-size: 0.85rem;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.broker-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 20px;
  font-size: 0.8rem;
  font-weight: 500;
}

.broker-indicator.connected {
  background: rgba(34, 197, 94, 0.2);
  border: 1px solid #22c55e;
}

.broker-indicator.disconnected {
  background: rgba(248, 81, 73, 0.2);
  border: 1px solid #f85149;
}

.broker-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.broker-indicator.connected .broker-dot {
  background: #22c55e;
  box-shadow: 0 0 6px #22c55e;
  animation: broker-pulse 2s infinite;
}

.broker-indicator.disconnected .broker-dot {
  background: #f85149;
}

.broker-indicator.connected .broker-label {
  color: #22c55e;
}

.broker-indicator.disconnected .broker-label {
  color: #f85149;
}

@keyframes broker-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.auto-refresh-toggle .toggle-btn {
  background: rgba(15, 52, 96, 0.8);
  border: 1px solid #0f3460;
  color: #94a3b8;
  padding: 8px 14px;
  border-radius: 20px;
  cursor: pointer;
  font-size: 0.85rem;
  transition: all 0.2s;
  min-width: 80px;
}

.auto-refresh-toggle .toggle-btn.active {
  background: rgba(34, 197, 94, 0.2);
  border-color: #22c55e;
  color: #22c55e;
}

.auto-refresh-toggle .toggle-btn:hover {
  transform: scale(1.02);
}

.last-refresh {
  color: #64748b;
  font-size: 0.8rem;
}

.refresh-btn {
  background: #e94560;
  color: white;
  border: none;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  cursor: pointer;
  font-size: 1.1rem;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.refresh-btn:hover:not(:disabled) {
  background: #d1304a;
  transform: rotate(180deg);
}

.refresh-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.dashboard-content {
  padding: 20px;
  max-width: 1800px;
  margin: 0 auto;
}

.tabs {
  display: flex;
  gap: 10px;
  margin-bottom: 20px;
  justify-content: center;
}

.tab {
  background: rgba(15, 52, 96, 0.5);
  border: 1px solid #0f3460;
  color: #94a3b8;
  padding: 10px 25px;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.2s;
}

.tab:hover {
  background: rgba(15, 52, 96, 0.8);
  color: #fff;
}

.tab.active {
  background: #e94560;
  border-color: #e94560;
  color: #fff;
}

.grid-layout {
  display: grid;
  grid-template-columns: 300px 1fr 350px;
  gap: 20px;
}

.col-left, .col-right {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.col-center {
  min-height: 500px;
}

.col-center.col-full {
  grid-column: 1 / -1;
}

.grid-layout.marketplace-mode {
  grid-template-columns: 1fr;
}

.tab-content {
  height: 100%;
}

.dashboard-footer {
  text-align: center;
  padding: 20px;
  color: #64748b;
  font-size: 0.875rem;
  border-top: 1px solid #1e293b;
  margin-top: 20px;
}

@media (max-width: 1400px) {
  .grid-layout {
    grid-template-columns: 1fr 1fr;
  }

  .col-center {
    grid-column: span 2;
    order: 3;
  }
}

@media (max-width: 900px) {
  .grid-layout {
    grid-template-columns: 1fr;
  }

  .col-center {
    grid-column: span 1;
  }

  .dashboard-header {
    flex-direction: column;
    gap: 15px;
    text-align: center;
  }
}
</style>
