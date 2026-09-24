import { createApp } from 'vue'
import { createPinia } from 'pinia'
import '../style.css'
import PanelApp from './PanelApp.vue'

createApp(PanelApp).use(createPinia()).mount('#app')