<script setup lang="ts">
import { onMounted } from 'vue'
import { usePanelStore } from './panelStore'
import TableDataView from './TableDataView.vue'
import QueryConsoleView from './QueryConsoleView.vue'

const store = usePanelStore()

onMounted(() => {
  window.addEventListener('message', (event: MessageEvent) => {
    store.handleMessage(event.data)
  })
  store.post('ready')
})
</script>

<template>
  <div class="flex h-screen flex-col bg-slate-950 text-sm text-slate-100">
    <header class="flex items-center gap-2 border-b border-slate-800 px-4 py-2">
      <span
        class="flex h-6 w-6 items-center justify-center rounded bg-emerald-600 text-[10px] font-bold text-white"
      >
        DB
      </span>
      <span class="truncate font-medium">{{ store.title }}</span>
      <span v-if="store.mode === 'table'" class="ml-auto text-xs text-slate-400">
        {{ store.total.toLocaleString() }} rows
      </span>
    </header>

    <div v-if="store.error" class="bg-red-500/10 px-4 py-2 text-red-300" role="alert">
      {{ store.error }}
    </div>

    <main class="min-h-0 flex-1 overflow-hidden">
      <TableDataView v-if="store.mode === 'table'" />
      <QueryConsoleView v-else-if="store.mode === 'query'" />
    </main>
  </div>
</template>