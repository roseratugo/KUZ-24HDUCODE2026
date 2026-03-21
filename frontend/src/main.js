import { createApp } from 'vue';
import { createPinia } from 'pinia';
import router from './router';
import App from './App.vue';
import './style.css';
import { setHistoryStore } from './api/client';
import { useHistoryStore } from './stores/history';

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
app.use(router);

const historyStore = useHistoryStore(pinia);
setHistoryStore(historyStore);

app.mount('#app');
