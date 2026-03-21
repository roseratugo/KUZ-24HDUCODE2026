<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { Line } from 'vue-chartjs';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import { marketplaceApi } from '../api/client';
import { pricesApi } from '../api/mapApi';
import { usePlayerStore } from '../stores/player';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

const playerStore = usePlayerStore();

const offers = ref([]);
const loading = ref(false);
const initialLoading = ref(true);
const error = ref(null);
const showCreateForm = ref(false);
const editingOffer = ref(null);
const selectedResource = ref('BOISIUM');
const countdown = ref(5);
const priceHistory = ref({
  BOISIUM: [],
  FERONIUM: [],
  CHARBONIUM: []
});

const newOffer = ref({
  resourceType: 'BOISIUM',
  quantityIn: 1,
  pricePerResource: 1
});

const purchaseQuantity = ref({});
let refreshInterval = null;
let countdownInterval = null;

const resourceConfig = {
  BOISIUM: { color: '#cd853f', bgColor: 'rgba(205, 133, 63, 0.2)', chartColor: 'rgb(205, 133, 63)', icon: '🪵', label: 'Boisium' },
  FERONIUM: { color: '#a1a1aa', bgColor: 'rgba(161, 161, 170, 0.2)', chartColor: 'rgb(161, 161, 170)', icon: '⚙️', label: 'Feronium' },
  CHARBONIUM: { color: '#525252', bgColor: 'rgba(82, 82, 82, 0.2)', chartColor: 'rgb(82, 82, 82)', icon: '⬛', label: 'Charbonium' }
};

const playerName = computed(() => playerStore.details?.name || '');
const playerMoney = computed(() => playerStore.details?.money || 0);
const myOffers = computed(() => offers.value.filter(o => o.owner?.name === playerName.value));
const otherOffers = computed(() => offers.value.filter(o => o.owner?.name !== playerName.value));

// Stats par ressource
const resourceStats = computed(() => {
  const stats = {};
  for (const type of ['BOISIUM', 'FERONIUM', 'CHARBONIUM']) {
    const typeOffers = offers.value.filter(o => o.resourceType === type);
    const prices = typeOffers.map(o => o.pricePerResource);
    const totalQuantity = typeOffers.reduce((sum, o) => sum + o.quantityIn, 0);

    stats[type] = {
      count: typeOffers.length,
      totalQuantity,
      minPrice: prices.length ? Math.min(...prices) : 0,
      maxPrice: prices.length ? Math.max(...prices) : 0,
      avgPrice: prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : 0
    };
  }
  return stats;
});

// Offres filtrees par ressource selectionnee
const filteredOffers = computed(() => {
  return otherOffers.value.filter(o => o.resourceType === selectedResource.value);
});

// Chart.js configuration
const chartData = computed(() => {
  const history = priceHistory.value[selectedResource.value] || [];
  const config = resourceConfig[selectedResource.value];

  return {
    labels: history.map(h => h.time),
    datasets: [
      {
        label: 'Prix moyen',
        data: history.map(h => h.avg),
        borderColor: config.chartColor,
        backgroundColor: config.bgColor,
        fill: true,
        tension: 0.4,
        pointRadius: 4,
        pointHoverRadius: 6,
        pointBackgroundColor: config.chartColor,
        pointBorderColor: '#161b22',
        pointBorderWidth: 2
      },
      {
        label: 'Prix min',
        data: history.map(h => h.min),
        borderColor: '#3fb950',
        backgroundColor: 'transparent',
        borderDash: [5, 5],
        tension: 0.4,
        pointRadius: 2,
        pointHoverRadius: 4
      }
    ]
  };
});

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: {
    intersect: false,
    mode: 'index'
  },
  plugins: {
    legend: {
      display: true,
      position: 'top',
      labels: {
        color: '#8b949e',
        usePointStyle: true,
        pointStyle: 'circle',
        padding: 15,
        font: { size: 11 }
      }
    },
    tooltip: {
      backgroundColor: '#21262d',
      titleColor: '#c9d1d9',
      bodyColor: '#8b949e',
      borderColor: '#30363d',
      borderWidth: 1,
      padding: 10,
      displayColors: true,
      callbacks: {
        label: (context) => `${context.dataset.label}: ${context.raw} 💰`
      }
    }
  },
  scales: {
    x: {
      grid: {
        color: 'rgba(48, 54, 61, 0.5)',
        drawBorder: false
      },
      ticks: {
        color: '#6e7681',
        maxRotation: 45,
        font: { size: 10 }
      }
    },
    y: {
      grid: {
        color: 'rgba(48, 54, 61, 0.5)',
        drawBorder: false
      },
      ticks: {
        color: '#6e7681',
        font: { size: 10 },
        callback: (value) => value + ' 💰'
      },
      beginAtZero: true
    }
  }
};

const fetchOffers = async (showLoading = false) => {
  if (showLoading) {
    loading.value = true;
  }
  error.value = null;
  try {
    const response = await marketplaceApi.getOffers();
    offers.value = response.data || [];
    updatePriceHistory();
  } catch (err) {
    error.value = err.response?.data?.message || 'Erreur lors du chargement des offres';
    console.error('Error fetching offers:', err);
  } finally {
    loading.value = false;
    initialLoading.value = false;
  }
};

const updatePriceHistory = async () => {
  const now = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const snapshots = [];

  for (const type of ['BOISIUM', 'FERONIUM', 'CHARBONIUM']) {
    const typeOffers = offers.value.filter(o => o.resourceType === type);
    if (typeOffers.length > 0) {
      const avgPrice = Math.round(typeOffers.reduce((sum, o) => sum + o.pricePerResource, 0) / typeOffers.length);
      const minPrice = Math.min(...typeOffers.map(o => o.pricePerResource));
      const maxPrice = Math.max(...typeOffers.map(o => o.pricePerResource));
      const totalQuantity = typeOffers.reduce((sum, o) => sum + o.quantityIn, 0);

      const entry = {
        time: now,
        avg: avgPrice,
        min: minPrice,
        max: maxPrice,
        count: typeOffers.length,
        totalQuantity
      };

      priceHistory.value[type].push(entry);

      // Garder les 50 derniers points en local
      if (priceHistory.value[type].length > 50) {
        priceHistory.value[type].shift();
      }

      // Prepare for DB save
      snapshots.push({
        resourceType: type,
        avgPrice,
        minPrice,
        maxPrice,
        offerCount: typeOffers.length,
        totalQuantity
      });
    }
  }

  // Save to DB (fire and forget)
  if (snapshots.length > 0) {
    pricesApi.saveBulk(snapshots).catch(err => {
      console.error('Failed to save price history to DB:', err);
    });
  }
};

const loadPriceHistory = async () => {
  try {
    const response = await pricesApi.getAll();
    const dbHistory = response.data;

    // Merge DB history with local format
    for (const type of ['BOISIUM', 'FERONIUM', 'CHARBONIUM']) {
      if (dbHistory[type] && dbHistory[type].length > 0) {
        priceHistory.value[type] = dbHistory[type].map(h => ({
          time: new Date(h.time).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          avg: h.avg,
          min: h.min,
          max: h.max,
          count: h.count
        }));
      }
    }
  } catch (err) {
    console.error('Failed to load price history from DB:', err);
  }
};

const startAutoRefresh = () => {
  // Refresh toutes les 5 secondes
  refreshInterval = setInterval(() => {
    fetchOffers();
    countdown.value = 5;
  }, 5000);

  // Countdown
  countdownInterval = setInterval(() => {
    countdown.value = countdown.value > 0 ? countdown.value - 1 : 5;
  }, 1000);
};

const createOffer = async () => {
  error.value = null;
  try {
    await marketplaceApi.createOffer({
      resourceType: newOffer.value.resourceType,
      quantityIn: parseInt(newOffer.value.quantityIn),
      pricePerResource: parseInt(newOffer.value.pricePerResource)
    });
    showCreateForm.value = false;
    newOffer.value = { resourceType: 'BOISIUM', quantityIn: 1, pricePerResource: 1 };
    await fetchOffers();
    await playerStore.fetchResources();
  } catch (err) {
    error.value = err.response?.data?.message || 'Erreur lors de la creation de l\'offre';
    console.error('Error creating offer:', err);
  }
};

const updateOffer = async () => {
  if (!editingOffer.value) return;
  error.value = null;

  const payload = {
    resourceType: editingOffer.value.resourceType,
    quantityIn: Math.floor(Number(editingOffer.value.quantityIn)),
    pricePerResource: Math.floor(Number(editingOffer.value.pricePerResource))
  };

  console.log('=== UPDATE OFFER DEBUG ===');
  console.log('Offer ID:', editingOffer.value.id);
  console.log('Payload:', JSON.stringify(payload));
  console.log('Full URL: /marketplace/offers/' + editingOffer.value.id);

  try {
    const response = await marketplaceApi.updateOffer(editingOffer.value.id, payload);
    console.log('Update success:', response.data);
    editingOffer.value = null;
    await fetchOffers();
  } catch (err) {
    console.error('=== UPDATE OFFER ERROR ===');
    console.error('Status:', err.response?.status);
    console.error('Status Text:', err.response?.statusText);
    console.error('Response Data:', JSON.stringify(err.response?.data, null, 2));
    console.error('Response Headers:', err.response?.headers);
    console.error('Full Error:', err);
    error.value = err.response?.data?.message || JSON.stringify(err.response?.data) || 'Erreur lors de la mise a jour';
  }
};

const deleteOffer = async (id) => {
  if (!confirm('Supprimer cette offre?')) return;
  error.value = null;
  try {
    await marketplaceApi.deleteOffer(id);
    await fetchOffers();
    await playerStore.fetchResources();
  } catch (err) {
    error.value = err.response?.data?.message || 'Erreur lors de la suppression';
    console.error('Error deleting offer:', err);
  }
};

const purchaseOffer = async (offer) => {
  const qty = purchaseQuantity.value[offer.id] || 1;
  if (qty < 1 || qty > offer.quantityIn) {
    error.value = 'Quantite invalide';
    return;
  }
  error.value = null;
  try {
    await marketplaceApi.purchase(offer.id, qty);
    purchaseQuantity.value[offer.id] = 1;
    await fetchOffers();
    await playerStore.refreshAll();
  } catch (err) {
    error.value = err.response?.data?.message || 'Erreur lors de l\'achat';
    console.error('Error purchasing:', err);
  }
};

const startEdit = (offer) => {
  editingOffer.value = { ...offer };
};

const cancelEdit = () => {
  editingOffer.value = null;
};

const getResourceStyle = (type) => {
  return resourceConfig[type] || { color: '#666', bgColor: 'rgba(102,102,102,0.2)', icon: '?', label: type };
};

const totalPrice = (offer, qty) => {
  return (qty || 1) * offer.pricePerResource;
};

const getPriceChange = (type) => {
  const history = priceHistory.value[type];
  if (history.length < 2) return { value: 0, percent: 0 };
  const current = history[history.length - 1]?.avg || 0;
  const previous = history[history.length - 2]?.avg || current;
  const change = current - previous;
  const percent = previous > 0 ? Math.round((change / previous) * 100) : 0;
  return { value: change, percent };
};

onMounted(async () => {
  await loadPriceHistory(); // Load history from DB first
  fetchOffers(true); // Show loading only on initial load
  startAutoRefresh();
});

onUnmounted(() => {
  if (refreshInterval) clearInterval(refreshInterval);
  if (countdownInterval) clearInterval(countdownInterval);
});
</script>

<template>
  <div class="marketplace-trading">
    <!-- Header avec solde -->
    <div class="trading-header">
      <div class="header-left">
        <h2>Marketplace</h2>
        <span class="subtitle">Trading & Echanges</span>
      </div>
      <div class="header-right">
        <div class="auto-refresh">
          <span class="refresh-indicator">🔄 {{ countdown }}s</span>
        </div>
        <div class="balance">
          <span class="balance-label">Solde</span>
          <span class="balance-value">{{ playerMoney.toLocaleString() }} 💰</span>
        </div>
        <button class="refresh-btn" @click="() => fetchOffers(true)" :disabled="loading">
          {{ loading ? '...' : '↻' }}
        </button>
      </div>
    </div>

    <div v-if="error" class="error">{{ error }}</div>

    <div class="trading-layout">
      <!-- Panneau gauche: Stats marche -->
      <div class="market-overview">
        <h3>Apercu du Marche</h3>

        <div class="resource-cards">
          <div
            v-for="(config, type) in resourceConfig"
            :key="type"
            :class="['resource-stat-card', { active: selectedResource === type }]"
            :style="{ '--res-color': config.color, '--res-bg': config.bgColor }"
            @click="selectedResource = type"
          >
            <div class="stat-header">
              <span class="stat-icon">{{ config.icon }}</span>
              <span class="stat-name">{{ config.label }}</span>
            </div>
            <div class="stat-price">
              <span class="current-price">{{ resourceStats[type]?.avgPrice || '-' }} 💰</span>
              <span
                v-if="getPriceChange(type).value !== 0"
                :class="['price-change', getPriceChange(type).value > 0 ? 'up' : 'down']"
              >
                {{ getPriceChange(type).value > 0 ? '▲' : '▼' }}
                {{ Math.abs(getPriceChange(type).percent) }}%
              </span>
            </div>
            <div class="stat-details">
              <span>{{ resourceStats[type]?.count || 0 }} offres</span>
              <span>{{ resourceStats[type]?.totalQuantity || 0 }} dispo</span>
            </div>
            <div class="price-range">
              <span v-if="resourceStats[type]?.minPrice">
                Min: {{ resourceStats[type].minPrice }} - Max: {{ resourceStats[type].maxPrice }}
              </span>
              <span v-else>Aucune offre</span>
            </div>
          </div>
        </div>

        <!-- Mes offres -->
        <div class="my-offers-section">
          <div class="section-header">
            <h4>Mes Offres ({{ myOffers.length }})</h4>
            <button class="add-offer-btn" @click="showCreateForm = !showCreateForm">
              {{ showCreateForm ? '✕' : '+' }}
            </button>
          </div>

          <!-- Formulaire creation -->
          <div v-if="showCreateForm" class="create-form-compact">
            <select v-model="newOffer.resourceType">
              <option value="BOISIUM">🪵 Boisium</option>
              <option value="FERONIUM">⚙️ Feronium</option>
              <option value="CHARBONIUM">⬛ Charbonium</option>
            </select>
            <input type="number" v-model="newOffer.quantityIn" min="1" placeholder="Qte" />
            <input type="number" v-model="newOffer.pricePerResource" min="1" placeholder="Prix" />
            <button @click="createOffer">Creer</button>
          </div>

          <div class="my-offers-list">
            <div v-for="offer in myOffers" :key="offer.id" class="my-offer-item">
              <div class="offer-info">
                <span class="offer-icon">{{ getResourceStyle(offer.resourceType).icon }}</span>
                <span class="offer-qty">x{{ offer.quantityIn }}</span>
                <span class="offer-price">{{ offer.pricePerResource }} 💰/u</span>
              </div>
              <div class="offer-actions-mini">
                <button @click="startEdit(offer)" title="Modifier">✏️</button>
                <button @click="deleteOffer(offer.id)" title="Supprimer">🗑️</button>
              </div>
            </div>
            <div v-if="!myOffers.length" class="no-offers">Aucune offre active</div>
          </div>
        </div>
      </div>

      <!-- Panneau central: Order Book + Chart -->
      <div class="center-panel">
        <!-- Graphique -->
        <div class="chart-section">
          <div class="chart-header">
            <h3>
              <span class="selected-icon">{{ getResourceStyle(selectedResource).icon }}</span>
              Evolution des Prix - {{ getResourceStyle(selectedResource).label }}
            </h3>
            <div class="resource-tabs">
              <button
                v-for="(config, type) in resourceConfig"
                :key="type"
                :class="['res-tab', { active: selectedResource === type }]"
                @click="selectedResource = type"
              >
                {{ config.icon }}
              </button>
            </div>
          </div>
          <div class="chart-wrapper">
            <Line
              v-if="priceHistory[selectedResource].length >= 2"
              :data="chartData"
              :options="chartOptions"
            />
            <div v-else class="no-chart-data">
              <span>📊</span>
              <p>En attente de donnees...</p>
              <small>Les prix seront affiches apres quelques actualisations</small>
            </div>
          </div>
        </div>

        <!-- Order Book -->
        <div class="order-book">
          <div class="order-book-header">
            <h3>Carnet d'Ordres</h3>
            <span class="offers-count">{{ filteredOffers.length }} offre(s)</span>
          </div>

          <div class="orders-table">
            <div class="table-header">
              <span>Vendeur</span>
              <span>Quantite</span>
              <span>Prix/u</span>
              <span>Total</span>
              <span>Action</span>
            </div>

            <div v-if="initialLoading" class="loading-orders">Chargement...</div>
            <div v-else-if="!filteredOffers.length" class="no-orders">
              Aucune offre pour {{ getResourceStyle(selectedResource).label }}
            </div>
            <div v-else class="orders-list">
              <div
                v-for="offer in filteredOffers"
                :key="offer.id"
                class="order-row"
              >
                <span class="seller">{{ offer.owner?.name || '?' }}</span>
                <span class="quantity">{{ offer.quantityIn }}</span>
                <span class="price">{{ offer.pricePerResource }} 💰</span>
                <span class="total">{{ offer.quantityIn * offer.pricePerResource }} 💰</span>
                <div class="buy-action">
                  <div class="buy-input-group">
                    <input
                      type="number"
                      v-model="purchaseQuantity[offer.id]"
                      :min="1"
                      :max="offer.quantityIn"
                      placeholder="1"
                      class="qty-input"
                    />
                    <span class="buy-total-preview">
                      = {{ totalPrice(offer, purchaseQuantity[offer.id] || 1) }} 💰
                    </span>
                  </div>
                  <button
                    class="buy-btn"
                    @click="purchaseOffer(offer)"
                    :disabled="playerMoney < totalPrice(offer, purchaseQuantity[offer.id] || 1)"
                    :title="playerMoney < totalPrice(offer, purchaseQuantity[offer.id] || 1) ? 'Solde insuffisant' : ''"
                  >
                    Acheter
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Panneau droit: Achat Rapide -->
      <div class="trading-panel">
        <h3>Achat Rapide</h3>

        <div class="quick-trade-form">
          <div class="form-row">
            <label>Ressource</label>
            <select v-model="selectedResource" class="trade-select">
              <option v-for="(config, type) in resourceConfig" :key="type" :value="type">
                {{ config.icon }} {{ config.label }}
              </option>
            </select>
          </div>

          <div class="market-summary">
            <div class="summary-item">
              <span class="summary-label">Offres disponibles</span>
              <span class="summary-value">{{ filteredOffers.length }}</span>
            </div>
            <div class="summary-item">
              <span class="summary-label">Prix moyen</span>
              <span class="summary-value">{{ resourceStats[selectedResource]?.avgPrice || '-' }} 💰</span>
            </div>
            <div class="summary-item">
              <span class="summary-label">Meilleur prix</span>
              <span class="summary-value highlight">{{ resourceStats[selectedResource]?.minPrice || '-' }} 💰</span>
            </div>
          </div>

          <div v-if="filteredOffers.length" class="best-offer">
            <h4>Meilleure Offre</h4>
            <div class="best-offer-card">
              <div class="best-seller">{{ filteredOffers.sort((a,b) => a.pricePerResource - b.pricePerResource)[0]?.owner?.name }}</div>
              <div class="best-price">{{ filteredOffers.sort((a,b) => a.pricePerResource - b.pricePerResource)[0]?.pricePerResource }} 💰/u</div>
              <div class="best-qty">{{ filteredOffers.sort((a,b) => a.pricePerResource - b.pricePerResource)[0]?.quantityIn }} disponibles</div>
              <button
                class="buy-best-btn"
                @click="purchaseOffer(filteredOffers.sort((a,b) => a.pricePerResource - b.pricePerResource)[0])"
              >
                Acheter au meilleur prix
              </button>
            </div>
          </div>
        </div>

        <!-- Conseils trading -->
        <div class="trading-tips">
          <h4>Conseils</h4>
          <ul>
            <li v-if="resourceStats[selectedResource]?.avgPrice > 0">
              Prix moyen actuel: {{ resourceStats[selectedResource].avgPrice }} 💰
            </li>
            <li v-if="resourceStats[selectedResource]?.count === 0">
              Aucune offre - opportunite de vente!
            </li>
            <li v-if="resourceStats[selectedResource]?.count > 5">
              Marche actif avec {{ resourceStats[selectedResource].count }} vendeurs
            </li>
            <li v-if="getPriceChange(selectedResource).value < 0">
              Prix en baisse - bon moment pour acheter
            </li>
            <li v-if="getPriceChange(selectedResource).value > 0">
              Prix en hausse - surveillez le marche
            </li>
          </ul>
        </div>
      </div>
    </div>

    <!-- Modal Edition -->
    <div v-if="editingOffer" class="edit-modal-overlay" @click="cancelEdit">
      <div class="edit-modal" @click.stop>
        <h3>Modifier l'offre</h3>
        <div class="edit-form">
          <div class="form-group">
            <label>Quantite</label>
            <input type="number" v-model="editingOffer.quantityIn" min="1" />
          </div>
          <div class="form-group">
            <label>Prix par unite</label>
            <input type="number" v-model="editingOffer.pricePerResource" min="1" />
          </div>
          <div class="edit-actions">
            <button class="cancel-btn" @click="cancelEdit">Annuler</button>
            <button class="save-btn" @click="updateOffer">Sauvegarder</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.marketplace-trading {
  background: linear-gradient(135deg, #0d1117 0%, #161b22 100%);
  border-radius: 12px;
  padding: 20px;
  height: 100%;
  overflow-y: auto;
  color: #c9d1d9;
}

.trading-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  padding-bottom: 15px;
  border-bottom: 1px solid #30363d;
}

.header-left h2 {
  color: #58a6ff;
  margin: 0;
  font-size: 1.5rem;
}

.subtitle {
  color: #8b949e;
  font-size: 0.85rem;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 15px;
}

.auto-refresh {
  background: rgba(34, 197, 94, 0.15);
  border: 1px solid #22c55e;
  padding: 8px 14px;
  border-radius: 20px;
}

.refresh-indicator {
  color: #22c55e;
  font-size: 0.85rem;
  font-weight: 600;
}

.balance {
  background: linear-gradient(135deg, #238636 0%, #2ea043 100%);
  padding: 10px 20px;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

.balance-label {
  font-size: 0.7rem;
  opacity: 0.8;
}

.balance-value {
  font-size: 1.2rem;
  font-weight: 700;
}

.refresh-btn {
  background: #21262d;
  border: 1px solid #30363d;
  color: #c9d1d9;
  width: 40px;
  height: 40px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 1.2rem;
  transition: all 0.2s;
}

.refresh-btn:hover:not(:disabled) {
  background: #30363d;
  transform: rotate(180deg);
}

.error {
  background: rgba(248, 81, 73, 0.1);
  border: 1px solid #f85149;
  color: #f85149;
  padding: 12px;
  border-radius: 8px;
  margin-bottom: 15px;
}

.trading-layout {
  display: grid;
  grid-template-columns: 260px 1fr 240px;
  gap: 20px;
  height: calc(100% - 80px);
}

/* Market Overview Panel */
.market-overview {
  background: #161b22;
  border-radius: 10px;
  padding: 15px;
  border: 1px solid #30363d;
  overflow-y: auto;
}

.market-overview h3 {
  color: #58a6ff;
  font-size: 1rem;
  margin: 0 0 15px;
}

.resource-cards {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 20px;
}

.resource-stat-card {
  background: var(--res-bg);
  border: 1px solid #30363d;
  border-radius: 8px;
  padding: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.resource-stat-card:hover, .resource-stat-card.active {
  border-color: var(--res-color);
  transform: translateX(5px);
}

.stat-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.stat-icon {
  font-size: 1.3rem;
}

.stat-name {
  font-weight: 600;
  color: #fff;
}

.stat-price {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 5px;
}

.current-price {
  font-size: 1.1rem;
  font-weight: 700;
  color: #ffd700;
}

.price-change {
  font-size: 0.75rem;
  padding: 2px 6px;
  border-radius: 4px;
}

.price-change.up {
  background: rgba(35, 134, 54, 0.3);
  color: #3fb950;
}

.price-change.down {
  background: rgba(248, 81, 73, 0.3);
  color: #f85149;
}

.stat-details {
  display: flex;
  justify-content: space-between;
  font-size: 0.75rem;
  color: #8b949e;
}

.price-range {
  font-size: 0.7rem;
  color: #6e7681;
  margin-top: 5px;
}

/* My Offers Section */
.my-offers-section {
  border-top: 1px solid #30363d;
  padding-top: 15px;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.section-header h4 {
  color: #c9d1d9;
  font-size: 0.9rem;
  margin: 0;
}

.add-offer-btn {
  background: #238636;
  border: none;
  color: #fff;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 1rem;
  transition: all 0.2s;
}

.add-offer-btn:hover {
  background: #2ea043;
}

.create-form-compact {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
  margin-bottom: 10px;
}

.create-form-compact select,
.create-form-compact input {
  background: #0d1117;
  border: 1px solid #30363d;
  color: #c9d1d9;
  padding: 8px;
  border-radius: 6px;
  font-size: 0.85rem;
}

.create-form-compact button {
  background: #238636;
  border: none;
  color: #fff;
  padding: 8px 12px;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 600;
}

.my-offers-list {
  max-height: 150px;
  overflow-y: auto;
}

.my-offer-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px;
  background: #0d1117;
  border-radius: 6px;
  margin-bottom: 5px;
}

.offer-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.offer-icon {
  font-size: 1.1rem;
}

.offer-qty {
  color: #8b949e;
}

.offer-price {
  color: #ffd700;
  font-weight: 600;
}

.offer-actions-mini {
  display: flex;
  gap: 5px;
}

.offer-actions-mini button {
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px;
  font-size: 0.9rem;
  transition: transform 0.2s;
}

.offer-actions-mini button:hover {
  transform: scale(1.2);
}

.no-offers {
  color: #6e7681;
  font-size: 0.85rem;
  text-align: center;
  padding: 15px;
}

/* Center Panel */
.center-panel {
  display: flex;
  flex-direction: column;
  gap: 15px;
}

/* Chart Section */
.chart-section {
  background: #161b22;
  border-radius: 10px;
  padding: 15px;
  border: 1px solid #30363d;
}

.chart-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 15px;
}

.chart-header h3 {
  color: #c9d1d9;
  font-size: 1rem;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.selected-icon {
  font-size: 1.2rem;
}

.resource-tabs {
  display: flex;
  gap: 5px;
}

.res-tab {
  background: #21262d;
  border: 1px solid #30363d;
  padding: 6px 12px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 1rem;
  transition: all 0.2s;
}

.res-tab:hover, .res-tab.active {
  background: #30363d;
  border-color: #58a6ff;
}

.chart-wrapper {
  height: 200px;
  position: relative;
}

.no-chart-data {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #6e7681;
}

.no-chart-data span {
  font-size: 2rem;
  margin-bottom: 10px;
}

.no-chart-data p {
  margin: 0;
  font-size: 0.95rem;
}

.no-chart-data small {
  margin-top: 5px;
  font-size: 0.8rem;
  opacity: 0.7;
}

/* Order Book */
.order-book {
  background: #161b22;
  border-radius: 10px;
  padding: 15px;
  border: 1px solid #30363d;
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.order-book-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 15px;
}

.order-book-header h3 {
  color: #c9d1d9;
  font-size: 1rem;
  margin: 0;
}

.offers-count {
  color: #8b949e;
  font-size: 0.85rem;
}

.orders-table {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.table-header {
  display: grid;
  grid-template-columns: 1fr 80px 80px 100px 180px;
  gap: 10px;
  padding: 10px;
  background: #0d1117;
  border-radius: 6px;
  font-size: 0.8rem;
  color: #8b949e;
  font-weight: 600;
}

.orders-list {
  flex: 1;
  overflow-y: auto;
  margin-top: 10px;
}

.order-row {
  display: grid;
  grid-template-columns: 1fr 80px 80px 100px 180px;
  gap: 10px;
  padding: 12px 10px;
  border-bottom: 1px solid #21262d;
  align-items: center;
  transition: background 0.2s;
}

.order-row:hover {
  background: rgba(88, 166, 255, 0.05);
}

.seller {
  color: #58a6ff;
  font-weight: 500;
}

.quantity {
  color: #c9d1d9;
}

.price {
  color: #ffd700;
  font-weight: 600;
}

.total {
  color: #8b949e;
}

.buy-action {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.buy-input-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.qty-input {
  width: 50px;
  background: #0d1117;
  border: 1px solid #30363d;
  color: #c9d1d9;
  padding: 6px;
  border-radius: 4px;
  text-align: center;
}

.buy-total-preview {
  color: #ffd700;
  font-weight: 600;
  font-size: 0.85rem;
  white-space: nowrap;
}

.buy-btn {
  background: linear-gradient(135deg, #238636 0%, #2ea043 100%);
  border: none;
  color: #fff;
  padding: 6px 12px;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 600;
  font-size: 0.8rem;
  transition: all 0.2s;
}

.buy-btn:hover:not(:disabled) {
  transform: scale(1.05);
}

.buy-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.loading-orders, .no-orders {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  color: #6e7681;
  padding: 30px;
}

/* Trading Panel */
.trading-panel {
  background: #161b22;
  border-radius: 10px;
  padding: 15px;
  border: 1px solid #30363d;
  overflow-y: auto;
}

.trading-panel h3 {
  color: #58a6ff;
  font-size: 1rem;
  margin: 0 0 15px;
}

.quick-trade-form {
  margin-bottom: 20px;
}

.form-row {
  margin-bottom: 12px;
}

.form-row label {
  display: block;
  color: #8b949e;
  font-size: 0.8rem;
  margin-bottom: 5px;
}

.trade-select {
  width: 100%;
  background: #0d1117;
  border: 1px solid #30363d;
  color: #c9d1d9;
  padding: 10px;
  border-radius: 6px;
  font-size: 0.95rem;
}

.market-summary {
  background: #0d1117;
  border-radius: 8px;
  padding: 12px;
  margin-top: 15px;
}

.summary-item {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
}

.summary-item:last-child {
  margin-bottom: 0;
}

.summary-label {
  color: #8b949e;
  font-size: 0.8rem;
}

.summary-value {
  color: #c9d1d9;
  font-weight: 600;
}

.summary-value.highlight {
  color: #3fb950;
}

.best-offer {
  margin-top: 15px;
}

.best-offer h4 {
  color: #8b949e;
  font-size: 0.85rem;
  margin: 0 0 10px;
}

.best-offer-card {
  background: linear-gradient(135deg, rgba(35, 134, 54, 0.2) 0%, rgba(46, 160, 67, 0.1) 100%);
  border: 1px solid #238636;
  border-radius: 8px;
  padding: 12px;
  text-align: center;
}

.best-seller {
  color: #58a6ff;
  font-weight: 500;
  margin-bottom: 5px;
}

.best-price {
  color: #ffd700;
  font-size: 1.3rem;
  font-weight: 700;
  margin-bottom: 5px;
}

.best-qty {
  color: #8b949e;
  font-size: 0.8rem;
  margin-bottom: 10px;
}

.buy-best-btn {
  width: 100%;
  background: linear-gradient(135deg, #238636 0%, #2ea043 100%);
  border: none;
  color: #fff;
  padding: 10px;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 600;
  transition: all 0.2s;
}

.buy-best-btn:hover {
  transform: scale(1.02);
}

.trading-tips {
  border-top: 1px solid #30363d;
  padding-top: 15px;
}

.trading-tips h4 {
  color: #8b949e;
  font-size: 0.85rem;
  margin: 0 0 10px;
}

.trading-tips ul {
  margin: 0;
  padding-left: 20px;
}

.trading-tips li {
  color: #6e7681;
  font-size: 0.8rem;
  margin-bottom: 5px;
}

/* Edit Modal */
.edit-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.edit-modal {
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 12px;
  padding: 25px;
  width: 350px;
}

.edit-modal h3 {
  color: #c9d1d9;
  margin: 0 0 20px;
}

.edit-form .form-group {
  margin-bottom: 15px;
}

.edit-form label {
  display: block;
  color: #8b949e;
  font-size: 0.85rem;
  margin-bottom: 5px;
}

.edit-form input {
  width: 100%;
  background: #0d1117;
  border: 1px solid #30363d;
  color: #c9d1d9;
  padding: 10px;
  border-radius: 6px;
  font-size: 1rem;
}

.edit-actions {
  display: flex;
  gap: 10px;
  margin-top: 20px;
}

.cancel-btn {
  flex: 1;
  background: #21262d;
  border: 1px solid #30363d;
  color: #c9d1d9;
  padding: 10px;
  border-radius: 6px;
  cursor: pointer;
}

.save-btn {
  flex: 1;
  background: #238636;
  border: none;
  color: #fff;
  padding: 10px;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 600;
}

@media (max-width: 1200px) {
  .trading-layout {
    grid-template-columns: 1fr;
  }

  .market-overview {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 15px;
  }

  .resource-cards {
    flex-direction: row;
    grid-column: span 3;
  }

  .resource-stat-card {
    flex: 1;
  }

  .my-offers-section {
    grid-column: span 3;
  }
}
</style>
