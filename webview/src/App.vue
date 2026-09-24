<script setup lang="ts">
import { onMounted } from 'vue'
import ConnectionList from './components/ConnectionList.vue'
import ConnectionForm from './components/ConnectionForm.vue'
import { useConnectionStore } from './stores/connection'

const store = useConnectionStore()

onMounted(() => {
  window.addEventListener('message', (event: MessageEvent) => {
    store.handleMessage(event.data)
  })
  store.post('ready')
})
</script>

<template>
  <div class="flex h-screen flex-col bg-slate-950 text-slate-100">
    <header class="flex items-center gap-3 border-b border-slate-800 px-4 py-3">
      <span class="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-xs font-bold text-white">
        DB
      </span>
      <div>
        <h1 class="text-sm font-semibold tracking-wide">Database Manager</h1>
        <p class="text-xs text-slate-400">MySQL • MariaDB • PostgreSQL • SQLite</p>
      </div>
    </header>

    <div v-if="store.error" class="bg-red-500/10 px-4 py-2 text-sm text-red-300" role="alert">
      {{ store.error }}
    </div>

    <main class="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <ConnectionList />
      <ConnectionForm />
    </main>
  </div>
</template>