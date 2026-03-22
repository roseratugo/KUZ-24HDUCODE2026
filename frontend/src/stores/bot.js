import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import mapClient from '../api/mapApi';

export const useBotStore = defineStore('bot', () => {
  const status = ref({
    running: false,
    paused: false,
    state: 'IDLE',
    position: null,
    energy: 0,
    maxEnergy: 15,
    moveCount: 0,
    cellsDiscovered: 0,
    islandsFound: 0,
    knownRechargePoints: 0,
    visitedPositions: 0,
    speed: 5000,
    uptime: 0
  });
  const logs = ref([]);
  const loading = ref(false);
  const error = ref(null);
  const lastLogId = ref(0);
  let pollTimer = null;

  const isRunning = computed(() => status.value.running);
  const isPaused = computed(() => status.value.paused);
  const botState = computed(() => status.value.state);

  async function start() {
    loading.value = true;
    error.value = null;
    try {
      const res = await mapClient.post('/bot/start');
      if (res.data.success) {
        startPolling();
      } else {
        error.value = res.data.message;
      }
      return res.data;
    } catch (err) {
      error.value = err.response?.data?.message || err.message;
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function stop() {
    loading.value = true;
    error.value = null;
    try {
      const res = await mapClient.post('/bot/stop');
      stopPolling();
      await fetchStatus();
      return res.data;
    } catch (err) {
      error.value = err.response?.data?.message || err.message;
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function pause() {
    try {
      const res = await mapClient.post('/bot/pause');
      await fetchStatus();
      return res.data;
    } catch (err) {
      error.value = err.response?.data?.message || err.message;
    }
  }

  async function resume() {
    try {
      const res = await mapClient.post('/bot/resume');
      await fetchStatus();
      return res.data;
    } catch (err) {
      error.value = err.response?.data?.message || err.message;
    }
  }

  async function fetchStatus() {
    try {
      const res = await mapClient.get('/bot/status');
      status.value = res.data;
    } catch (err) {
      console.error('Failed to fetch bot status:', err);
    }
  }

  async function fetchLogs() {
    try {
      const res = await mapClient.get(`/bot/logs?since=${lastLogId.value}`);
      if (res.data.length > 0) {
        logs.value.push(...res.data);
        lastLogId.value = res.data[res.data.length - 1].id + 1;
        // Keep last 200 logs in frontend
        if (logs.value.length > 200) {
          logs.value = logs.value.slice(-200);
        }
      }
    } catch (err) {
      console.error('Failed to fetch bot logs:', err);
    }
  }

  async function clearLogs() {
    try {
      await mapClient.delete('/bot/logs');
      logs.value = [];
      lastLogId.value = 0;
    } catch (err) {
      console.error('Failed to clear bot logs:', err);
    }
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(async () => {
      await Promise.all([fetchStatus(), fetchLogs()]);
    }, 2000);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  // Initialize: fetch status and start polling if bot is running
  async function init() {
    await fetchStatus();
    if (status.value.running) {
      startPolling();
    }
  }

  return {
    status, logs, loading, error,
    isRunning, isPaused, botState,
    start, stop, pause, resume,
    fetchStatus, fetchLogs, clearLogs,
    startPolling, stopPolling, init
  };
});
