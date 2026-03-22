<script setup>
import { ref, watch } from 'vue';
import {
  fetchPlayerDetails, fetchResources, fetchOffers, purchaseOffer,
  createOffer, deleteOffer, fetchThefts, launchTheft, fetchIslands
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
];

async function loadTab(tab) {
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
      const [off, details] = await Promise.all([fetchOffers(), fetchPlayerDetails()]);
      offers.value = Array.isArray(off) ? off : [];
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
watch(() => props.visible, (v) => { if (v) loadTab(activeTab.value); });

async function doPurchase(offerId) {
  const qty = buyQty.value[offerId] || 1;
  try {
    await purchaseOffer(offerId, qty);
    buyQty.value[offerId] = 1;
    await loadTab('marketplace');
  } catch (err) {
    error.value = err.response?.data?.message || 'Achat echoue';
  }
}

async function doCreateOffer() {
  try {
    await createOffer(newOffer.value.resourceType, newOffer.value.quantity, newOffer.value.unitPrice);
    newOffer.value = { resourceType: 'BOISIUM', quantity: 1, unitPrice: 1 };
    await loadTab('marketplace');
  } catch (err) {
    error.value = err.response?.data?.message || 'Creation echouee';
  }
}

async function doDeleteOffer(offerId) {
  try {
    await deleteOffer(offerId);
    await loadTab('marketplace');
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

// Escape is handled by the parent App.vue toggle
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
        <div v-if="loading" class="loading">Chargement...</div>

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
            <!-- Create offer -->
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

            <!-- Offers list -->
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

.empty {
  color: #475569;
  text-align: center;
  padding: 20px;
  font-style: italic;
  grid-column: 1 / -1;
}

/* Scrollbar */
.tab-content::-webkit-scrollbar,
.offers-list::-webkit-scrollbar { width: 4px; }
.tab-content::-webkit-scrollbar-thumb,
.offers-list::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.15);
  border-radius: 2px;
}
</style>
