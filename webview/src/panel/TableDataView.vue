<script setup lang="ts">
import { computed } from 'vue'
import { usePanelStore } from './panelStore'
import DataGrid from './DataGrid.vue'

const store = usePanelStore()

const totalPages = computed(() => Math.max(1, Math.ceil(store.total / store.pageSize)))

const pageSizes = [25, 50, 100, 200, 500]
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="flex items-center gap-3 border-b border-slate-800 px-4 py-2">
      <span class="text-xs text-slate-400">Table</span>
      <span class="font-medium">{{ store.tableName }}</span>

      <span class="ml-auto text-xs text-slate-500">Page</span>
      <button
        class="rounded bg-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-600 disabled:opacity-40"
        :disabled="store.page <= 1 || store.loading"
        @click="store.prevPage()"
      >
        ‹
      </button>
      <span class="text-xs tabular-nums text-slate-300">{{ store.page }} / {{ totalPages }}</span>
      <button
        class="rounded bg-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-600 disabled:opacity-40"
        :disabled="store.page >= totalPages || store.loading"
        @click="store.nextPage()"
      >
        ›
      </button>

      <select
        class="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 outline-none focus:border-emerald-500"
        :value="store.pageSize"
        @change="store.setPageSize(Number(($event.target as HTMLSelectElement).value))"
      >
        <option v-for="size in pageSizes" :key="size" :value="size">{{ size }} / page</option>
      </select>
    </div>

    <div v-if="store.error" class="bg-red-500/10 px-4 py-2 text-red-300" role="alert">
      {{ store.error }}
    </div>

    <DataGrid :columns="store.columns" :rows="store.rows" :loading="store.loading" />
  </div>
</template>