<script setup>
import { ref, watch, onUnmounted, computed } from 'vue';
import {
  fetchPlayerDetails, fetchResources, purchaseOffer,
  createOffer, deleteOffer, fetchThefts, launchTheft, fetchIslands,
  botStart, botStop, botPause, botResume, botStatus, botLogs, botClearLogs
} from '../three/api.js';

const props = defineProps({ visible: Boolean });
const emit = defineEmits(['close']);

const activeTab = ref('resources');
const loading = ref(false);
const error = ref(null);

// Resources
const player = ref(null);
const resources = ref([]);
const money = ref(0);

// Marketplace
const offers = ref([]);
const buyQty = ref({});
const newOffer = ref({ resourceType: 'BOISIUM', quantity: 1, unitPrice: 1 });

// Islands
const discoveredIslands = ref([]);
const homeIsland = ref(null);

// Thefts
const thefts = ref([]);
const newTheft = ref({ resourceType: 'BOISIUM', moneySpent: 100 });
const sending = ref(false);

// Bot
const bot = ref({
  running: false, paused: false, state: 'IDLE',
  position: null, energy: 0, maxEnergy: 15,
  moveCount: 0, cellsDiscovered: 0, islandsFound: 0,
  knownRechargePoints: 0, uptime: 0
});
const botLogsData = ref([]);
const botLastLogId = ref(0);
const botLoading = ref(false);
const botError = ref(null);
const showBotLogs = ref(true);
let botPollTimer = null;

const botStateLabel = computed(() => {
  const labels = { IDLE: 'Arrete', EXPLORING: 'Exploration', RETURNING: 'Retour', RECHARGING: 'Recharge' };
  return labels[bot.value.state] || bot.value.state;
});
const botStateColor = computed(() => {
  const colors = { IDLE: '#64748b', EXPLORING: '#22c55e', RETURNING: '#f59e0b', RECHARGING: '#60a5fa' };
  return colors[bot.value.state] || '#64748b';
});
const energyPercent = computed(() => {
  if (!bot.value.maxEnergy) return 0;
  return Math.round((bot.value.energy / bot.value.maxEnergy) * 100);
});
const uptimeFormatted = computed(() => {
  const ms = bot.value.uptime || 0;
  const s = Math.floor(ms / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
});

async function fetchBotStatus() {
  try { bot.value = await botStatus(); } catch (e) { /* ignore */ }
}
async function fetchBotLogs() {
  try {
    const data = await botLogs(botLastLogId.value);
    if (data.length > 0) {
      botLogsData.value.push(...data);
      botLastLogId.value = data[data.length - 1].id + 1;
      if (botLogsData.value.length > 200) botLogsData.value = botLogsData.value.slice(-200);
    }
  } catch (e) { /* ignore */ }
}
function startBotPolling() {
  stopBotPolling();
  botPollTimer = setInterval(() => { fetchBotStatus(); fetchBotLogs(); }, 2000);
}
function stopBotPolling() {
  if (botPollTimer) { clearInterval(botPollTimer); botPollTimer = null; }
}
async function handleBotStart() {
  botLoading.value = true; botError.value = null;
  try {
    const res = await botStart();
    if (res.success) startBotPolling(); else botError.value = res.message;
  } catch (e) { botError.value = e.response?.data?.message || e.message; }
  finally { botLoading.value = false; }
}
async function handleBotStop() {
  botLoading.value = true;
  try { await botStop(); stopBotPolling(); await fetchBotStatus(); }
  catch (e) { botError.value = e.response?.data?.message || e.message; }
  finally { botLoading.value = false; }
}
async function handleBotPause() {
  try { await botPause(); await fetchBotStatus(); } catch (e) { botError.value = e.response?.data?.message || e.message; }
}
async function handleBotResume() {
  try { await botResume(); await fetchBotStatus(); } catch (e) { botError.value = e.response?.data?.message || e.message; }
}
async function handleBotClearLogs() {
  try { await botClearLogs(); botLogsData.value = []; botLastLogId.value = 0; } catch (e) { /* ignore */ }
}
function logTypeIcon(type) {
  return { info: 'i', success: '+', warn: '!', error: 'x' }[type] || 'i';
}

// Broker
const brokerWs = ref(null);
const brokerStatus = ref('disconnected');
const brokerError = ref(null);
const brokerMessages = ref([]);
const brokerFilter = ref('all');
let brokerReconnectTimer = null;
let brokerReconnectAttempts = 0;

const brokerStatusLabel = computed(() => {
  if (brokerStatus.value === 'connected') return 'Connecte';
  if (brokerStatus.value === 'connecting') return 'Connexion...';
  if (brokerStatus.value === 'ws_ready') return 'WS OK';
  if (brokerStatus.value === 'error') return 'Erreur';
  return 'Deconnecte';
});
const brokerFilteredMessages = computed(() => {
  if (brokerFilter.value === 'all') return brokerMessages.value;
  return brokerMessages.value.filter(m => m.type === brokerFilter.value);
});
const brokerStats = computed(() => {
  const c = {};
  brokerMessages.value.forEach(m => { c[m.type] = (c[m.type] || 0) + 1; });
  return c;
});
function getEventIcon(type) {
  return { ACHAT: '🛒', OFFRE: '📦', OFFRE_SUPPRIMEE: '🗑️', DISCOVERED_ISLAND: '🏝️', VOL: '🦹', RESSOURCE: '💎' }[type] || '📨';
}
function getEventColor(type) {
  return { ACHAT: '#22c55e', OFFRE: '#3b82f6', OFFRE_SUPPRIMEE: '#f97316', DISCOVERED_ISLAND: '#a855f7', VOL: '#ef4444', RESSOURCE: '#eab308' }[type] || '#8b949e';
}
function connectBroker() {
  if (brokerWs.value && brokerWs.value.readyState === WebSocket.OPEN) return;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${window.location.host}/broker`;
  brokerStatus.value = 'connecting'; brokerError.value = null;
  try {
    const ws = new WebSocket(url);
    ws.onopen = () => {
      brokerStatus.value = 'ws_ready';
      ws.send(JSON.stringify({ type: 'connect', username: 'Zak', password: 'e462a5eb-9d16-43d6-8816-3767c336bf73', playerId: 'e462a5eb-9d16-43d6-8816-3767c336bf73' }));
    };
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'status' && data.status === 'ready') { brokerStatus.value = 'connected'; brokerError.value = null; brokerReconnectAttempts = 0; }
        else if (data.type === 'error') brokerError.value = data.message;
        else if (data.type === 'message') {
          const ev = data.data || data.raw;
          if (ev) {
            brokerMessages.value.unshift({ id: Date.now(), type: ev.type, data: ev.message, timestamp: new Date().toISOString() });
            if (brokerMessages.value.length > 100) brokerMessages.value = brokerMessages.value.slice(0, 100);
            handleMarketplaceBrokerEvent(ev.type, ev.message);
          }
        }
      } catch (e) { /* ignore */ }
    };
    ws.onerror = () => { brokerStatus.value = 'error'; brokerError.value = 'Erreur WebSocket'; };
    ws.onclose = () => { brokerStatus.value = 'disconnected'; brokerWs.value = null; scheduleBrokerReconnect(); };
    brokerWs.value = ws;
  } catch (e) { brokerStatus.value = 'error'; brokerError.value = e.message; }
}
function scheduleBrokerReconnect() {
  if (brokerReconnectAttempts < 10) {
    brokerReconnectAttempts++;
    brokerReconnectTimer = setTimeout(connectBroker, 5000);
  }
}
function disconnectBroker() {
  brokerReconnectAttempts = 10;
  if (brokerReconnectTimer) { clearTimeout(brokerReconnectTimer); brokerReconnectTimer = null; }
  if (brokerWs.value) { brokerWs.value.close(); brokerWs.value = null; }
}
function toggleBrokerMsg(msg) { msg.expanded = !msg.expanded; }

// Marketplace live updates via broker
function handleMarketplaceBrokerEvent(eventType, data) {
  if (!data) return;
  if (eventType === 'OFFRE') {
    const normalized = {
      id: data.id,
      resourceType: data.resourceType,
      quantity: data.quantityIn || data.quantity || 0,
      quantityIn: data.quantityIn || data.quantity || 0,
      unitPrice: data.pricePerResource || data.unitPrice || 0,
      pricePerResource: data.pricePerResource || data.unitPrice || 0,
      owner: data.owner
    };
    const idx = offers.value.findIndex(o => o.id === data.id);
    if (idx >= 0) {
      offers.value[idx] = { ...offers.value[idx], ...normalized };
    } else {
      offers.value.push(normalized);
    }
  } else if (eventType === 'ACHAT') {
    const idx = offers.value.findIndex(o => o.id === data.offerId);
    if (idx >= 0) {
      offers.value[idx].quantity = Math.max(0, (offers.value[idx].quantity || 0) - (data.quantity || 0));
      if (offers.value[idx].quantity <= 0) offers.value.splice(idx, 1);
    }
  } else if (eventType === 'OFFRE_SUPPRIMEE') {
    const idx = offers.value.findIndex(o => o.id === data.id);
    if (idx >= 0) offers.value.splice(idx, 1);
  }
}

const resourceConfig = {
  BOISIUM: { color: '#8B4513', icon: '🪵', label: 'Boisium' },
  FERONIUM: { color: '#71717a', icon: '⚙️', label: 'Feronium' },
  CHARBONIUM: { color: '#1f1f1f', icon: '⬛', label: 'Charbonium' },
};

const tabs = [
  { key: 'resources', label: 'Ressources', icon: '💎' },
  { key: 'marketplace', label: 'Marketplace', icon: '🏪' },
  { key: 'islands', label: 'Iles', icon: '🏝️' },
  { key: 'thefts', label: 'Vols', icon: '🗡️' },
  { key: 'bot', label: 'Bot', icon: '🤖' },
  { key: 'broker', label: 'Broker', icon: '📡' },
];

async function loadTab(tab) {
  if (tab === 'bot') {
    await fetchBotStatus();
    if (bot.value.running) startBotPolling();
    return;
  }
  if (tab === 'broker') {
    connectBroker();
    return;
  }
  loading.value = true;
  error.value = null;
  try {
    if (tab === 'resources') {
      const details = await fetchPlayerDetails();
      player.value = details;
      money.value = details.money ?? 0;
      resources.value = details.resources || [];
      discoveredIslands.value = details.discoveredIslands || [];
      homeIsland.value = details.home || null;
    } else if (tab === 'marketplace') {
      const details = await fetchPlayerDetails();
      money.value = details.money ?? 0;
      resources.value = details.resources || [];
    } else if (tab === 'islands') {
      const [details, islandsDb] = await Promise.all([fetchPlayerDetails(), fetchIslands()]);
      discoveredIslands.value = details.discoveredIslands || [];
      homeIsland.value = details.home || null;
    } else if (tab === 'thefts') {
      const [t, details] = await Promise.all([fetchThefts(), fetchPlayerDetails()]);
      thefts.value = Array.isArray(t) ? t : [];
      money.value = details.money ?? 0;
    }
  } catch (err) {
    error.value = err.response?.data?.message || err.message;
  } finally {
    loading.value = false;
  }
}

watch(activeTab, (tab) => loadTab(tab));
watch(() => props.visible, (v) => {
  if (v) {
    connectBroker();
    loadTab(activeTab.value);
  } else {
    stopBotPolling();
  }
});

onUnmounted(() => { stopBotPolling(); disconnectBroker(); });

async function refreshPlayerInfo() {
  try {
    const details = await fetchPlayerDetails();
    money.value = details.money ?? 0;
    resources.value = details.resources || [];
  } catch (e) { /* ignore */ }
}

async function doPurchase(offerId) {
  const qty = buyQty.value[offerId] || 1;
  try {
    await purchaseOffer(offerId, qty);
    buyQty.value[offerId] = 1;
    await refreshPlayerInfo();
  } catch (err) {
    error.value = err.response?.data?.message || 'Achat echoue';
  }
}

async function doCreateOffer() {
  try {
    await createOffer(newOffer.value.resourceType, newOffer.value.quantity, newOffer.value.unitPrice);
    newOffer.value = { resourceType: 'BOISIUM', quantity: 1, unitPrice: 1 };
    await refreshPlayerInfo();
  } catch (err) {
    error.value = err.response?.data?.message || 'Creation echouee';
  }
}

async function doDeleteOffer(offerId) {
  try {
    await deleteOffer(offerId);
  } catch (err) {
    error.value = err.response?.data?.message || 'Suppression echouee';
  }
}

async function doTheft() {
  sending.value = true;
  try {
    await launchTheft(newTheft.value.resourceType, newTheft.value.moneySpent);
    await loadTab('thefts');
  } catch (err) {
    error.value = err.response?.data?.message || 'Vol echoue';
  } finally {
    sending.value = false;
  }
}

function statusColor(status) {
  return { PENDING: '#f59e0b', SUCCESS: '#22c55e', FAILED: '#ef4444' }[status] || '#94a3b8';
}

function chanceLabel(c) {
  return { FORTE: '🟢 Forte', MOYENNE: '🟡 Moyenne', FAIBLE: '🔴 Faible' }[c] || c;
}

function formatDate(d) {
  if (!d) return '-';
  return new Date(d).toLocaleTimeString('fr-FR');
}

function getResourceQty(type) {
  const r = resources.value.find(r => r.type === type);
  return r ? r.quantity : 0;
}
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="overlay" @click.self="emit('close')">
      <div class="menu-panel">
        <!-- Header -->
        <div class="menu-header">
          <h2>Menu</h2>
          <div class="player-money" v-if="money">💰 {{ money.toLocaleString() }}</div>
          <button class="close-btn" @click="emit('close')">✕</button>
        </div>

        <!-- Tabs -->
        <div class="tab-bar">
          <button
            v-for="tab in tabs" :key="tab.key"
            :class="['tab-btn', { active: activeTab === tab.key }]"
            @click="activeTab = tab.key"
          >
            <span class="tab-icon">{{ tab.icon }}</span>
            <span class="tab-label">{{ tab.label }}</span>
          </button>
        </div>

        <!-- Error -->
        <div v-if="error" class="error-bar">{{ error }}</div>

        <!-- Loading -->
        <div v-if="loading && activeTab !== 'bot' && activeTab !== 'broker'" class="loading">Chargement...</div>

        <!-- Content -->
        <div v-else class="tab-content">

          <!-- RESOURCES -->
          <div v-if="activeTab === 'resources'" class="resources-tab">
            <div class="resource-grid">
              <div v-for="(cfg, type) in resourceConfig" :key="type" class="resource-card"
                :style="{ borderLeftColor: cfg.color }">
                <span class="res-icon">{{ cfg.icon }}</span>
                <div class="res-info">
                  <span class="res-label">{{ cfg.label }}</span>
                  <span class="res-qty">{{ getResourceQty(type).toLocaleString() }}</span>
                </div>
              </div>
            </div>
            <div v-if="player?.storage" class="storage-section">
              <h3>Stockage — {{ player.storage.name }}</h3>
              <div v-for="(max, type) in player.storage.maxResources" :key="type" class="storage-row">
                <span class="storage-label">{{ resourceConfig[type]?.icon }} {{ type }}</span>
                <div class="storage-bar-wrap">
                  <div class="storage-bar"
                    :style="{
                      width: Math.min(100, (getResourceQty(type) / max) * 100) + '%',
                      background: (getResourceQty(type) / max) >= 0.9 ? '#ef4444' : (getResourceQty(type) / max) >= 0.7 ? '#f59e0b' : '#22c55e'
                    }"
                  ></div>
                </div>
                <span class="storage-text">{{ getResourceQty(type) }}/{{ max }}</span>
              </div>
            </div>
          </div>

          <!-- MARKETPLACE -->
          <div v-if="activeTab === 'marketplace'" class="marketplace-tab">
            <div class="section-box">
              <h3>Creer une offre</h3>
              <div class="form-row">
                <select v-model="newOffer.resourceType">
                  <option v-for="(cfg, type) in resourceConfig" :key="type" :value="type">
                    {{ cfg.icon }} {{ cfg.label }}
                  </option>
                </select>
                <input type="number" v-model.number="newOffer.quantity" min="1" placeholder="Qte" />
                <input type="number" v-model.number="newOffer.unitPrice" min="1" placeholder="Prix/u" />
                <button class="action-btn create" @click="doCreateOffer">Creer</button>
              </div>
            </div>
            <div class="section-box">
              <h3>Offres disponibles ({{ offers.length }})</h3>
              <div class="offers-list">
                <div v-for="offer in offers" :key="offer.id" class="offer-card">
                  <div class="offer-header">
                    <span class="offer-resource">
                      {{ resourceConfig[offer.resourceType]?.icon }} {{ offer.resourceType }}
                    </span>
                    <span class="offer-seller">{{ offer.owner?.name || offer.owner || '?' }}</span>
                  </div>
                  <div class="offer-details">
                    <span>Qte: {{ offer.quantityIn ?? offer.quantity }}</span>
                    <span>Prix: {{ offer.pricePerResource ?? offer.unitPrice }}💰/u</span>
                  </div>
                  <div class="offer-actions">
                    <input type="number" v-model.number="buyQty[offer.id]"
                      :max="offer.quantityIn ?? offer.quantity" min="1" placeholder="1" />
                    <button class="action-btn buy" @click="doPurchase(offer.id)">Acheter</button>
                  </div>
                </div>
                <div v-if="offers.length === 0" class="empty">Aucune offre disponible</div>
              </div>
            </div>
          </div>

          <!-- ISLANDS -->
          <div v-if="activeTab === 'islands'" class="islands-tab">
            <div v-if="homeIsland" class="home-card">
              <span class="home-badge">Ile de depart</span>
              <span class="home-name">{{ homeIsland.name }}</span>
              <span class="home-bonus">+{{ homeIsland.bonusQuotient }} prod</span>
            </div>
            <h3>Iles decouvertes ({{ discoveredIslands.length }})</h3>
            <div class="islands-grid">
              <div v-for="item in discoveredIslands" :key="item.island?.id" class="island-card">
                <div class="island-top">
                  <span class="island-name">🏝️ {{ item.island?.name }}</span>
                  <span :class="['island-state', item.islandState?.toLowerCase()]">
                    {{ item.islandState === 'KNOWN' ? 'Validee' : 'Decouverte' }}
                  </span>
                </div>
                <div class="island-bonus">+{{ item.island?.bonusQuotient }} production</div>
              </div>
              <div v-if="discoveredIslands.length === 0" class="empty">Aucune ile decouverte</div>
            </div>
          </div>

          <!-- THEFTS -->
          <div v-if="activeTab === 'thefts'" class="thefts-tab">
            <div class="section-box">
              <h3>Lancer un vol</h3>
              <div class="form-row">
                <select v-model="newTheft.resourceType">
                  <option value="BOISIUM">🪵 Boisium</option>
                  <option value="FERONIUM">⚙️ Feronium</option>
                  <option value="CHARBONIUM">⬛ Charbonium</option>
                </select>
                <input type="number" v-model.number="newTheft.moneySpent" min="1" placeholder="Or" />
                <button class="action-btn steal" @click="doTheft" :disabled="sending">
                  {{ sending ? '...' : 'Voler' }}
                </button>
              </div>
            </div>
            <h3>Historique ({{ thefts.length }})</h3>
            <div class="thefts-grid">
              <div v-for="theft in thefts" :key="theft.id" class="theft-card">
                <div class="theft-header">
                  <span>{{ resourceConfig[theft.resourceType]?.icon }} {{ theft.resourceType }}</span>
                  <span class="theft-status" :style="{ color: statusColor(theft.status) }">
                    {{ theft.status }}
                  </span>
                </div>
                <div class="theft-details">
                  <div><span class="det-label">Or</span> {{ theft.moneySpent }}</div>
                  <div><span class="det-label">Qte</span> {{ theft.amountAttempted }}</div>
                  <div><span class="det-label">Chance</span> {{ chanceLabel(theft.chance) }}</div>
                  <div><span class="det-label">Heure</span> {{ formatDate(theft.createdAt) }}</div>
                </div>
              </div>
              <div v-if="thefts.length === 0" class="empty">Aucun vol</div>
            </div>
          </div>

          <!-- BOT -->
          <div v-if="activeTab === 'bot'" class="bot-tab">
            <div class="bot-header-row">
              <h3>Bot Explorateur</h3>
              <div class="state-badge" :style="{ backgroundColor: botStateColor + '30', color: botStateColor, borderColor: botStateColor }">
                {{ botStateLabel }}
              </div>
            </div>
            <div v-if="botError" class="error-bar">{{ botError }}</div>
            <div class="bot-controls">
              <button v-if="!bot.running" class="action-btn bot-start" :disabled="botLoading" @click="handleBotStart">
                {{ botLoading ? 'Demarrage...' : 'Demarrer' }}
              </button>
              <template v-else>
                <button v-if="!bot.paused" class="action-btn bot-pause" @click="handleBotPause">Pause</button>
                <button v-else class="action-btn bot-resume" @click="handleBotResume">Reprendre</button>
                <button class="action-btn bot-stop" @click="handleBotStop">Arreter</button>
              </template>
            </div>
            <div class="stats-grid" v-if="bot.moveCount > 0 || bot.running">
              <div class="stat-item"><span class="stat-value">{{ bot.moveCount }}</span><span class="stat-label">Mouvements</span></div>
              <div class="stat-item"><span class="stat-value">{{ bot.cellsDiscovered }}</span><span class="stat-label">Cellules</span></div>
              <div class="stat-item"><span class="stat-value">{{ bot.islandsFound }}</span><span class="stat-label">Iles</span></div>
              <div class="stat-item"><span class="stat-value">{{ uptimeFormatted }}</span><span class="stat-label">Duree</span></div>
            </div>
            <div class="info-section" v-if="bot.running || bot.position">
              <div class="info-row">
                <span class="info-label">Position</span>
                <span class="info-value coords" v-if="bot.position">({{ bot.position.x }}, {{ bot.position.y }})</span>
                <span class="info-value" v-else>?</span>
              </div>
              <div class="info-row">
                <span class="info-label">Energie</span>
                <div class="energy-mini"><div class="energy-mini-bar" :style="{ width: energyPercent + '%' }"></div></div>
                <span class="info-value">{{ bot.energy }}/{{ bot.maxEnergy }}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Points recharge</span>
                <span class="info-value">{{ bot.knownRechargePoints }}</span>
              </div>
            </div>
            <div class="logs-section">
              <div class="logs-header">
                <h3 @click="showBotLogs = !showBotLogs" class="logs-toggle">
                  Logs ({{ botLogsData.length }}) {{ showBotLogs ? '[-]' : '[+]' }}
                </h3>
                <button v-if="botLogsData.length > 0" class="btn-clear" @click="handleBotClearLogs">Effacer</button>
              </div>
              <div v-if="showBotLogs" class="logs-list">
                <div v-if="botLogsData.length === 0" class="empty">Aucun log</div>
                <div v-for="log in [...botLogsData].reverse().slice(0, 100)" :key="log.id"
                  :class="['log-entry', `log-${log.type}`]">
                  <span class="log-icon">{{ logTypeIcon(log.type) }}</span>
                  <span class="log-time">{{ new Date(log.timestamp).toLocaleTimeString('fr-FR') }}</span>
                  <span class="log-msg">{{ log.message }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- BROKER -->
          <div v-if="activeTab === 'broker'" class="broker-tab">
            <div class="broker-header">
              <div>
                <h3>Broker AMQP</h3>
                <span class="broker-subtitle">Evenements temps reel</span>
              </div>
              <div class="broker-header-right">
                <div :class="['status-badge', brokerStatus]">
                  <span class="status-dot"></span>
                  <span>{{ brokerStatusLabel }}</span>
                </div>
                <button class="btn-clear" @click="brokerMessages = []">Effacer</button>
              </div>
            </div>
            <div v-if="brokerError" class="error-bar">{{ brokerError }}</div>
            <div class="broker-stats" v-if="brokerMessages.length > 0">
              <div v-for="(count, type) in brokerStats" :key="type"
                :class="['stat-chip', { active: brokerFilter === type }]"
                :style="{ '--chip-color': getEventColor(type) }"
                @click="brokerFilter = brokerFilter === type ? 'all' : type">
                <span>{{ getEventIcon(type) }}</span>
                <span class="chip-label">{{ type }}</span>
                <span class="chip-count">{{ count }}</span>
              </div>
            </div>
            <div class="broker-messages">
              <div v-if="brokerFilteredMessages.length === 0" class="empty">
                {{ brokerStatus === 'connected' ? 'En attente d\'evenements...' : 'Connexion au broker...' }}
              </div>
              <div v-for="msg in brokerFilteredMessages" :key="msg.id"
                class="broker-msg" :style="{ borderLeftColor: getEventColor(msg.type) }"
                @click="toggleBrokerMsg(msg)">
                <div class="broker-msg-header">
                  <span>{{ getEventIcon(msg.type) }}</span>
                  <span class="broker-msg-type" :style="{ color: getEventColor(msg.type) }">{{ msg.type }}</span>
                  <span class="broker-msg-time">{{ formatDate(msg.timestamp) }}</span>
                </div>
                <div v-if="!msg.expanded" class="broker-msg-preview">
                  {{ JSON.stringify(msg.data).substring(0, 100) }}{{ JSON.stringify(msg.data).length > 100 ? '...' : '' }}
                </div>
                <pre v-if="msg.expanded" class="broker-msg-full">{{ JSON.stringify(msg.data, null, 2) }}</pre>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
}

.menu-panel {
  background: linear-gradient(135deg, #0d1b2a 0%, #1b2838 100%);
  border: 1px solid rgba(233, 69, 96, 0.3);
  border-radius: 16px;
  width: 90vw;
  max-width: 720px;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
}

.menu-header {
  display: flex;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.menu-header h2 {
  color: #e94560;
  font-size: 1.3rem;
  flex: 1;
}
.player-money {
  color: #fbbf24;
  font-weight: 700;
  font-size: 1rem;
  margin-right: 16px;
}
.close-btn {
  background: none;
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #94a3b8;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 1rem;
  transition: all 0.15s;
}
.close-btn:hover {
  background: #e94560;
  color: #fff;
  border-color: #e94560;
}

/* Tabs */
.tab-bar {
  display: flex;
  gap: 2px;
  padding: 0 16px;
  background: rgba(0, 0, 0, 0.2);
  overflow-x: auto;
}
.tab-btn {
  flex: 1;
  background: none;
  border: none;
  color: #64748b;
  padding: 12px 8px;
  cursor: pointer;
  font-size: 0.85rem;
  font-weight: 600;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  border-bottom: 2px solid transparent;
  transition: all 0.15s;
  min-width: 60px;
}
.tab-btn:hover { color: #94a3b8; }
.tab-btn.active {
  color: #e94560;
  border-bottom-color: #e94560;
}
.tab-icon { font-size: 1.2rem; }
.tab-label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.5px; }

.error-bar {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
  padding: 8px 20px;
  font-size: 0.85rem;
}
.loading {
  padding: 40px;
  text-align: center;
  color: #64748b;
}

.tab-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
}

/* Resources */
.resource-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 10px;
  margin-bottom: 20px;
}
.resource-card {
  background: rgba(15, 52, 96, 0.4);
  border-left: 3px solid;
  border-radius: 10px;
  padding: 12px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.res-icon { font-size: 1.4rem; }
.res-info { display: flex; flex-direction: column; }
.res-label { color: #94a3b8; font-size: 0.75rem; }
.res-qty { color: #fff; font-weight: 700; font-size: 1.1rem; }

.storage-section { margin-top: 8px; }
.storage-section h3 { color: #94a3b8; font-size: 0.85rem; margin-bottom: 10px; }
.storage-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.storage-label { color: #94a3b8; font-size: 0.8rem; min-width: 100px; }
.storage-bar-wrap {
  flex: 1;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 4px;
  height: 8px;
  overflow: hidden;
}
.storage-bar {
  height: 100%;
  border-radius: 4px;
  transition: width 0.3s;
}
.storage-text { color: #64748b; font-size: 0.75rem; min-width: 70px; text-align: right; }

/* Marketplace */
.section-box {
  background: rgba(15, 52, 96, 0.2);
  border-radius: 10px;
  padding: 14px;
  margin-bottom: 14px;
}
.section-box h3 { color: #94a3b8; font-size: 0.85rem; margin-bottom: 10px; }

.form-row {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
.form-row select, .form-row input {
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: #fff;
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 0.85rem;
}
.form-row input { width: 80px; }
.form-row select { flex: 1; min-width: 120px; }

.action-btn {
  padding: 8px 14px;
  border: none;
  border-radius: 6px;
  font-weight: 600;
  font-size: 0.8rem;
  cursor: pointer;
  transition: all 0.15s;
}
.action-btn.create { background: #2563eb; color: #fff; }
.action-btn.create:hover { background: #3b82f6; }
.action-btn.buy { background: #22c55e; color: #fff; }
.action-btn.buy:hover { background: #16a34a; }
.action-btn.steal { background: #e94560; color: #fff; }
.action-btn.steal:hover { background: #f87171; }
.action-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.offers-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 340px;
  overflow-y: auto;
}
.offer-card {
  background: rgba(0, 0, 0, 0.2);
  border-radius: 8px;
  padding: 10px 12px;
}
.offer-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 6px;
}
.offer-resource { color: #fff; font-weight: 600; font-size: 0.9rem; }
.offer-seller { color: #64748b; font-size: 0.8rem; }
.offer-details {
  display: flex;
  gap: 16px;
  color: #94a3b8;
  font-size: 0.8rem;
  margin-bottom: 8px;
}
.offer-actions {
  display: flex;
  gap: 6px;
  align-items: center;
}
.offer-actions input {
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: #fff;
  padding: 5px 8px;
  border-radius: 4px;
  width: 60px;
  font-size: 0.8rem;
}

/* Islands */
.home-card {
  background: linear-gradient(135deg, rgba(34, 197, 94, 0.15), rgba(15, 52, 96, 0.3));
  border: 1px solid rgba(34, 197, 94, 0.3);
  border-radius: 10px;
  padding: 14px;
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}
.home-badge {
  background: rgba(34, 197, 94, 0.2);
  color: #22c55e;
  padding: 3px 8px;
  border-radius: 12px;
  font-size: 0.7rem;
  font-weight: 700;
}
.home-name { color: #fff; font-weight: 700; flex: 1; }
.home-bonus { color: #22c55e; font-size: 0.85rem; }

.islands-tab h3 { color: #94a3b8; font-size: 0.85rem; margin-bottom: 10px; }
.islands-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 8px;
}
.island-card {
  background: rgba(15, 52, 96, 0.4);
  border-radius: 8px;
  padding: 12px;
}
.island-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}
.island-name { color: #fff; font-weight: 600; font-size: 0.9rem; }
.island-state {
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 0.7rem;
  font-weight: 600;
}
.island-state.known { background: rgba(34, 197, 94, 0.2); color: #22c55e; }
.island-state.discovered { background: rgba(245, 158, 11, 0.2); color: #f59e0b; }
.island-bonus { color: #64748b; font-size: 0.8rem; }

/* Thefts */
.thefts-tab h3 { color: #94a3b8; font-size: 0.85rem; margin-bottom: 10px; }
.thefts-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 8px;
}
.theft-card {
  background: rgba(15, 52, 96, 0.4);
  border-radius: 8px;
  padding: 12px;
}
.theft-header {
  display: flex;
  justify-content: space-between;
  color: #fff;
  font-weight: 600;
  font-size: 0.9rem;
  margin-bottom: 8px;
}
.theft-status { font-weight: 700; font-size: 0.8rem; }
.theft-details {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  font-size: 0.8rem;
  color: #94a3b8;
}
.det-label { color: #64748b; margin-right: 4px; }

/* Bot */
.bot-header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.bot-header-row h3 { color: #e94560; font-size: 1.1rem; margin: 0; }
.state-badge {
  padding: 4px 12px;
  border-radius: 20px;
  font-size: 0.8rem;
  font-weight: 600;
  border: 1px solid;
}
.bot-controls {
  display: flex;
  gap: 8px;
  margin-bottom: 14px;
}
.bot-controls .action-btn { flex: 1; padding: 10px; font-size: 0.9rem; }
.action-btn.bot-start { background: linear-gradient(135deg, #22c55e, #16a34a); color: #fff; }
.action-btn.bot-pause { background: linear-gradient(135deg, #f59e0b, #d97706); color: #fff; }
.action-btn.bot-resume { background: linear-gradient(135deg, #60a5fa, #3b82f6); color: #fff; }
.action-btn.bot-stop { background: linear-gradient(135deg, #ef4444, #dc2626); color: #fff; }

.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin-bottom: 14px;
}
.stat-item {
  background: rgba(15, 52, 96, 0.5);
  padding: 10px 8px;
  border-radius: 8px;
  text-align: center;
}
.stat-value { display: block; color: #fff; font-weight: 700; font-size: 1.1rem; }
.stat-label { display: block; color: #64748b; font-size: 0.7rem; margin-top: 2px; }

.info-section {
  background: rgba(15, 52, 96, 0.3);
  border-radius: 8px;
  padding: 10px;
  margin-bottom: 14px;
}
.info-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 0;
}
.info-label { color: #94a3b8; font-size: 0.8rem; }
.info-value { color: #fff; font-weight: 600; font-size: 0.85rem; }
.info-value.coords { font-family: monospace; color: #60a5fa; }
.energy-mini {
  flex: 1; max-width: 80px; height: 6px;
  background: rgba(0, 0, 0, 0.3); border-radius: 4px; margin: 0 10px; overflow: hidden;
}
.energy-mini-bar {
  height: 100%; background: linear-gradient(90deg, #22c55e, #16a34a);
  border-radius: 4px; transition: width 0.3s;
}

.logs-section { border-top: 1px solid rgba(15, 52, 96, 0.5); padding-top: 10px; }
.logs-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.logs-header h3 { color: #94a3b8; font-size: 0.85rem; margin: 0; }
.logs-toggle { cursor: pointer; user-select: none; }
.logs-toggle:hover { color: #e94560; }
.btn-clear {
  background: rgba(15, 52, 96, 0.5); border: 1px solid rgba(15, 52, 96, 0.8);
  color: #64748b; padding: 3px 10px; border-radius: 6px; cursor: pointer; font-size: 0.7rem;
}
.btn-clear:hover { color: #ef4444; border-color: #ef4444; }
.logs-list { max-height: 200px; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
.log-entry {
  display: flex; align-items: flex-start; gap: 6px;
  padding: 4px 8px; border-radius: 4px; font-size: 0.75rem; line-height: 1.3;
}
.log-icon {
  width: 14px; height: 14px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 0.6rem; font-weight: 700; flex-shrink: 0; margin-top: 1px;
}
.log-info { background: rgba(96, 165, 250, 0.1); }
.log-info .log-icon { background: rgba(96, 165, 250, 0.3); color: #60a5fa; }
.log-success { background: rgba(34, 197, 94, 0.1); }
.log-success .log-icon { background: rgba(34, 197, 94, 0.3); color: #22c55e; }
.log-warn { background: rgba(245, 158, 11, 0.1); }
.log-warn .log-icon { background: rgba(245, 158, 11, 0.3); color: #f59e0b; }
.log-error { background: rgba(239, 68, 68, 0.1); }
.log-error .log-icon { background: rgba(239, 68, 68, 0.3); color: #ef4444; }
.log-time { color: #64748b; font-family: monospace; white-space: nowrap; flex-shrink: 0; }
.log-msg { color: #cbd5e1; word-break: break-word; }

/* Broker */
.broker-header {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 14px; padding-bottom: 10px; border-bottom: 1px solid rgba(15, 52, 96, 0.5);
}
.broker-header h3 { color: #58a6ff; font-size: 1.1rem; margin: 0; }
.broker-subtitle { color: #8b949e; font-size: 0.8rem; }
.broker-header-right { display: flex; align-items: center; gap: 10px; }
.status-badge {
  display: flex; align-items: center; gap: 6px;
  padding: 5px 12px; border-radius: 20px; font-size: 0.8rem; font-weight: 500;
}
.status-badge.connected { background: rgba(34, 197, 94, 0.15); border: 1px solid #22c55e; color: #22c55e; }
.status-badge.disconnected, .status-badge.error { background: rgba(248, 81, 73, 0.15); border: 1px solid #f85149; color: #f85149; }
.status-badge.connecting, .status-badge.ws_ready { background: rgba(234, 179, 8, 0.15); border: 1px solid #eab308; color: #eab308; }
.status-dot {
  width: 8px; height: 8px; border-radius: 50%;
}
.status-badge.connected .status-dot { background: #22c55e; animation: pulse 2s infinite; }
.status-badge.disconnected .status-dot, .status-badge.error .status-dot { background: #f85149; }
.status-badge.connecting .status-dot, .status-badge.ws_ready .status-dot { background: #eab308; animation: pulse 1s infinite; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }

.broker-stats { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
.stat-chip {
  display: flex; align-items: center; gap: 5px;
  padding: 4px 10px; background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--chip-color); border-radius: 20px;
  cursor: pointer; transition: all 0.2s; font-size: 0.8rem;
}
.stat-chip:hover, .stat-chip.active { background: rgba(255, 255, 255, 0.1); }
.chip-label { color: var(--chip-color); font-size: 0.7rem; font-weight: 600; }
.chip-count {
  background: var(--chip-color); color: #0d1117;
  padding: 1px 5px; border-radius: 10px; font-size: 0.65rem; font-weight: 700;
}

.broker-messages { display: flex; flex-direction: column; gap: 6px; max-height: 340px; overflow-y: auto; }
.broker-msg {
  background: rgba(0, 0, 0, 0.2); border: 1px solid rgba(255, 255, 255, 0.08);
  border-left: 3px solid; border-radius: 8px; padding: 10px; cursor: pointer; transition: all 0.15s;
}
.broker-msg:hover { background: rgba(0, 0, 0, 0.3); }
.broker-msg-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.broker-msg-type { font-weight: 600; font-size: 0.85rem; }
.broker-msg-time { color: #6e7681; font-size: 0.75rem; margin-left: auto; }
.broker-msg-preview { color: #8b949e; font-size: 0.8rem; font-family: monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.broker-msg-full {
  margin-top: 8px; padding: 8px; background: rgba(0, 0, 0, 0.3);
  border-radius: 6px; font-size: 0.75rem; color: #c9d1d9;
  overflow-x: auto; white-space: pre-wrap; word-break: break-all;
}

.empty {
  color: #475569;
  text-align: center;
  padding: 20px;
  font-style: italic;
  grid-column: 1 / -1;
}

/* Scrollbar */
.tab-content::-webkit-scrollbar,
.offers-list::-webkit-scrollbar,
.logs-list::-webkit-scrollbar,
.broker-messages::-webkit-scrollbar { width: 4px; }
.tab-content::-webkit-scrollbar-thumb,
.offers-list::-webkit-scrollbar-thumb,
.logs-list::-webkit-scrollbar-thumb,
.broker-messages::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.15);
  border-radius: 2px;
}
</style>
