<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { moveShip, fetchPlayerDetails } from '../three/api.js';

const emit = defineEmits(['moved']);

const energy = ref(0);
const maxEnergy = ref(100);
const shipSpeed = ref(5000);
const cooldownRemaining = ref(0);
const error = ref(null);
const moveCount = ref(0);

const isOnCooldown = computed(() => cooldownRemaining.value > 0);
const cooldownPercent = computed(() => {
  if (!shipSpeed.value || cooldownRemaining.value <= 0) return 0;
  return (cooldownRemaining.value / shipSpeed.value) * 100;
});
const energyPercent = computed(() => {
  if (!maxEnergy.value) return 0;
  return Math.round((energy.value / maxEnergy.value) * 100);
});

const directions = [
  { key: 'NW', row: 1, col: 1, icon: '↖' },
  { key: 'N', row: 1, col: 2, icon: '↑' },
  { key: 'NE', row: 1, col: 3, icon: '↗' },
  { key: 'W', row: 2, col: 1, icon: '←' },
  { key: null, row: 2, col: 2, icon: '⚓' },
  { key: 'E', row: 2, col: 3, icon: '→' },
  { key: 'SW', row: 3, col: 1, icon: '↙' },
  { key: 'S', row: 3, col: 2, icon: '↓' },
  { key: 'SE', row: 3, col: 3, icon: '↘' },
];

let cooldownTimer = null;
let detailsPollTimer = null;

function startCooldown() {
  cooldownRemaining.value = shipSpeed.value;
  if (cooldownTimer) clearInterval(cooldownTimer);
  cooldownTimer = setInterval(() => {
    cooldownRemaining.value = Math.max(0, cooldownRemaining.value - 100);
    if (cooldownRemaining.value <= 0) {
      clearInterval(cooldownTimer);
      cooldownTimer = null;
    }
  }, 100);
}

async function move(direction) {
  if (!direction || isOnCooldown.value || energy.value === 0) return;
  error.value = null;
  startCooldown();

  try {
    const data = await moveShip(direction);
    energy.value = data.energy;
    moveCount.value++;
    if (data.position) {
      emit('moved', data.position);
    }
  } catch (err) {
    error.value = err.response?.data?.message || 'Erreur de deplacement';
    console.error('Move failed:', err);
  }
}

function handleKeydown(e) {
  const keyMap = {
    ArrowUp: 'N', ArrowDown: 'S', ArrowLeft: 'W', ArrowRight: 'E',
    z: 'N', s: 'S', q: 'W', d: 'E',
    a: 'NW', e: 'NE', w: 'SW', c: 'SE',
  };
  const dir = keyMap[e.key];
  if (dir) {
    e.preventDefault();
    move(dir);
  }
}

async function refreshEnergy() {
  try {
    const details = await fetchPlayerDetails();
    if (details.ship) {
      energy.value = details.ship.availableMove ?? 0;
      maxEnergy.value = details.ship.level?.maxMovement ?? 100;
      shipSpeed.value = details.ship.level?.speed ?? 5000;
    }
  } catch (e) { /* ignore */ }
}

onMounted(async () => {
  window.addEventListener('keydown', handleKeydown);
  await refreshEnergy();
  detailsPollTimer = setInterval(refreshEnergy, 5000);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown);
  if (detailsPollTimer) clearInterval(detailsPollTimer);
  if (cooldownTimer) clearInterval(cooldownTimer);
});
</script>

<template>
  <div class="ship-controls">
    <div class="energy-bar-wrap">
      <div class="energy-bar" :style="{ width: energyPercent + '%' }"></div>
      <span class="energy-text">{{ energy }} / {{ maxEnergy }}</span>
    </div>

    <div v-if="error" class="ctrl-error">{{ error }}</div>

    <div v-if="isOnCooldown" class="cooldown-wrap">
      <div class="cooldown-bar" :style="{ width: cooldownPercent + '%' }"></div>
    </div>

    <div class="direction-grid" :class="{ 'on-cooldown': isOnCooldown }">
      <button
        v-for="dir in directions"
        :key="dir.row + '-' + dir.col"
        :class="['dir-btn', { empty: !dir.key }]"
        :disabled="isOnCooldown || !dir.key || energy === 0"
        :style="{ gridRow: dir.row, gridColumn: dir.col }"
        @click="move(dir.key)"
        :title="dir.key ? dir.key : ''"
      >
        <span class="dir-icon">{{ dir.icon }}</span>
        <span v-if="dir.key" class="dir-label">{{ dir.key }}</span>
      </button>
    </div>

    <div class="ctrl-hint">{{ moveCount }} mouvement(s) - ZQSD / fleches</div>
  </div>
</template>

<style scoped>
.ship-controls {
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: 100;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(233, 69, 96, 0.3);
  border-radius: 14px;
  padding: 14px;
  min-width: 200px;
}

.energy-bar-wrap {
  position: relative;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  height: 22px;
  margin-bottom: 10px;
  overflow: hidden;
}

.energy-bar {
  height: 100%;
  border-radius: 6px;
  background: linear-gradient(90deg, #22c55e, #4ade80);
  transition: width 0.3s;
}

.energy-text {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
}

.ctrl-error {
  background: rgba(239, 68, 68, 0.2);
  color: #ef4444;
  padding: 6px 10px;
  border-radius: 6px;
  margin-bottom: 8px;
  font-size: 11px;
  text-align: center;
}

.cooldown-wrap {
  background: rgba(239, 68, 68, 0.15);
  border-radius: 4px;
  height: 4px;
  margin-bottom: 8px;
  overflow: hidden;
}

.cooldown-bar {
  height: 100%;
  background: linear-gradient(90deg, #ef4444, #f59e0b);
  transition: width 0.1s linear;
}

.direction-grid {
  display: grid;
  grid-template-columns: repeat(3, 52px);
  grid-template-rows: repeat(3, 52px);
  gap: 5px;
  justify-content: center;
  transition: opacity 0.2s;
}

.direction-grid.on-cooldown {
  opacity: 0.5;
}

.dir-btn {
  background: rgba(15, 52, 96, 0.8);
  border: 2px solid #e94560;
  color: #fff;
  border-radius: 10px;
  cursor: pointer;
  font-weight: 600;
  transition: all 0.15s;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  user-select: none;
  -webkit-user-select: none;
}

.dir-btn:hover:not(:disabled):not(.empty) {
  background: #e94560;
  transform: scale(1.1);
  box-shadow: 0 0 14px rgba(233, 69, 96, 0.5);
}

.dir-btn:active:not(:disabled):not(.empty) {
  transform: scale(0.95);
}

.dir-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.dir-btn.empty {
  background: rgba(15, 52, 96, 0.2);
  border: 2px dashed rgba(255, 255, 255, 0.15);
  cursor: default;
}

.dir-icon {
  font-size: 1.1rem;
  line-height: 1;
}

.dir-label {
  font-size: 0.55rem;
  color: #94a3b8;
}

.ctrl-hint {
  color: #64748b;
  font-size: 10px;
  text-align: center;
  margin-top: 8px;
}
</style>
