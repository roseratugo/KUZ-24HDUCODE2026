<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue';

const props = defineProps({
  cells: { type: Map, default: () => new Map() },
  shipX: { type: Number, default: 0 },
  shipY: { type: Number, default: 0 }
});

const canvasRef = ref(null);
const SIZE = 220;
const RADIUS = 40; // cells visible on minimap

const cellColors = {
  SEA: { 1: '#7dd3fc', 2: '#2563eb', 3: '#1d4ed8', 4: '#1e3a8a', 5: '#172554', default: '#1e40af' },
  SAND: '#d4a050',
  ROCKS: '#57534e'
};

let cachedCtx = null;

function draw() {
  const canvas = canvasRef.value;
  if (!canvas) return;
  // Cache context and avoid resetting canvas dimensions every frame
  if (!cachedCtx) {
    canvas.width = SIZE;
    canvas.height = SIZE;
    cachedCtx = canvas.getContext('2d');
  }
  const ctx = cachedCtx;

  const cellPx = SIZE / (RADIUS * 2 + 1);
  const cx = props.shipX;
  const cy = props.shipY;

  // Background
  ctx.fillStyle = '#0a0a1a';
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Draw cells
  for (const [, cell] of props.cells) {
    const dx = cell.x - cx;
    const dy = cell.y - cy;
    if (Math.abs(dx) > RADIUS || Math.abs(dy) > RADIUS) continue;

    const sx = (dx + RADIUS) * cellPx;
    const sy = (dy + RADIUS) * cellPx;

    if (cell.type === 'SEA') {
      ctx.fillStyle = cellColors.SEA[cell.zone] || cellColors.SEA.default;
    } else if (cell.type === 'SAND') {
      ctx.fillStyle = cellColors.SAND;
    } else if (cell.type === 'ROCKS') {
      ctx.fillStyle = cellColors.ROCKS;
    } else {
      ctx.fillStyle = 'rgba(50,50,60,0.3)';
    }

    ctx.fillRect(sx, sy, cellPx, cellPx);

    // Island highlight
    if (cell.island) {
      ctx.fillStyle = '#22c55e';
      ctx.fillRect(sx, sy, cellPx, cellPx);
    }
  }

  // Ship indicator
  const shipSx = RADIUS * cellPx + cellPx / 2;
  const shipSy = RADIUS * cellPx + cellPx / 2;
  const shipSize = Math.max(4, cellPx * 1.5);

  // Glow
  ctx.shadowColor = '#e94560';
  ctx.shadowBlur = 8;
  ctx.fillStyle = '#e94560';
  ctx.beginPath();
  ctx.arc(shipSx, shipSy, shipSize, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  // White center
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(shipSx, shipSy, shipSize * 0.5, 0, Math.PI * 2);
  ctx.fill();

  // Border
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, SIZE, SIZE);

  // Crosshair lines
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(SIZE / 2, 0);
  ctx.lineTo(SIZE / 2, SIZE);
  ctx.moveTo(0, SIZE / 2);
  ctx.lineTo(SIZE, SIZE / 2);
  ctx.stroke();

  // Coordinates label
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`(${cx}, ${cy})`, SIZE / 2, SIZE - 5);
}

let needsRedraw = true;

function scheduleDraw() {
  needsRedraw = true;
}

let animFrame = null;
function loop() {
  if (needsRedraw) {
    draw();
    needsRedraw = false;
  }
  animFrame = requestAnimationFrame(loop);
}

onMounted(() => {
  draw();
  loop();
});

onUnmounted(() => {
  if (animFrame) cancelAnimationFrame(animFrame);
  cachedCtx = null;
});

// Redraw when cells or ship position change
watch(() => props.cells.size, scheduleDraw);
watch(() => props.shipX, scheduleDraw);
watch(() => props.shipY, scheduleDraw);
</script>

<template>
  <div class="minimap">
    <canvas ref="canvasRef" :width="SIZE" :height="SIZE"></canvas>
  </div>
</template>

<style scoped>
.minimap {
  position: fixed;
  bottom: 20px;
  right: 20px;
  border-radius: 10px;
  overflow: hidden;
  border: 2px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
  z-index: 100;
  backdrop-filter: blur(4px);
}

canvas {
  display: block;
}
</style>
