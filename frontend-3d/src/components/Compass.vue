<script setup>
import { ref, onMounted, onUnmounted } from 'vue';

const props = defineProps({
  getCamera: { type: Function, default: null },
  getTarget: { type: Function, default: null },
});

const angle = ref(0);
let rafId = null;

function update() {
  if (props.getCamera && props.getTarget) {
    const cam = props.getCamera();
    const target = props.getTarget();
    if (cam && target) {
      const dx = cam.position.x - target.x;
      const dz = cam.position.z - target.z;
      angle.value = Math.atan2(dx, dz);
    }
  }
  rafId = requestAnimationFrame(update);
}

onMounted(() => {
  rafId = requestAnimationFrame(update);
});

onUnmounted(() => {
  if (rafId) cancelAnimationFrame(rafId);
});
</script>

<template>
  <div class="compass">
    <svg
      viewBox="0 0 120 120"
      class="compass-svg"
      :style="{ transform: `rotate(${angle}rad)` }"
    >
      <!-- Outer ring -->
      <circle cx="60" cy="60" r="56" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="2" />
      <circle cx="60" cy="60" r="50" fill="rgba(0,0,0,0.3)" stroke="rgba(255,255,255,0.08)" stroke-width="1" />

      <!-- Tick marks -->
      <line v-for="i in 36" :key="i"
        :x1="60 + 46 * Math.sin((i * 10) * Math.PI / 180)"
        :y1="60 - 46 * Math.cos((i * 10) * Math.PI / 180)"
        :x2="60 + (i % 9 === 0 ? 38 : i % 3 === 0 ? 41 : 43) * Math.sin((i * 10) * Math.PI / 180)"
        :y2="60 - (i % 9 === 0 ? 38 : i % 3 === 0 ? 41 : 43) * Math.cos((i * 10) * Math.PI / 180)"
        :stroke="i % 9 === 0 ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.2)'"
        :stroke-width="i % 9 === 0 ? 2 : 1"
      />

      <!-- Cardinal labels -->
      <text x="60" y="24" class="cardinal north">N</text>
      <text x="60" y="102" class="cardinal">S</text>
      <text x="99" y="64" class="cardinal">E</text>
      <text x="21" y="64" class="cardinal">W</text>

      <!-- North arrow (red) -->
      <polygon points="60,14 54,42 60,36 66,42" fill="#e94560" opacity="0.9" />
      <!-- South arrow (white) -->
      <polygon points="60,106 54,78 60,84 66,78" fill="rgba(255,255,255,0.4)" />
    </svg>

    <!-- Fixed center dot (doesn't rotate) -->
    <div class="compass-center"></div>
  </div>
</template>

<style scoped>
.compass {
  position: fixed;
  bottom: 20px;
  left: 20px;
  z-index: 100;
  width: 150px;
  height: 150px;
  pointer-events: none;
}

.compass-svg {
  width: 100%;
  height: 100%;
  filter: drop-shadow(0 2px 8px rgba(0, 0, 0, 0.5));
  transition: transform 0.15s ease-out;
}

.cardinal {
  fill: rgba(255, 255, 255, 0.6);
  font-size: 11px;
  font-weight: 700;
  font-family: system-ui, sans-serif;
  text-anchor: middle;
  dominant-baseline: central;
}

.cardinal.north {
  fill: #e94560;
}

.compass-center {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 8px;
  height: 8px;
  background: #fff;
  border-radius: 50%;
  box-shadow: 0 0 6px rgba(233, 69, 96, 0.6);
}
</style>
