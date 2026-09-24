<script setup lang="ts">
function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return 'NULL'
  }
  if (typeof value === 'object') {
    return String(value)
  }
  return String(value)
}

defineProps<{
  columns: string[]
  rows: Record<string, unknown>[]
  loading?: boolean
}>()
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="flex-1 overflow-auto">
      <table class="w-full border-collapse text-xs">
        <thead class="sticky top-0 z-10">
          <tr class="bg-slate-900">
            <th
              v-for="column in columns"
              :key="column"
              class="border-b border-slate-800 px-3 py-2 text-left font-semibold text-slate-300"
            >
              {{ column }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading">
            <td :colspan="Math.max(columns.length, 1)" class="px-3 py-8 text-center text-slate-500">
              Loading…
            </td>
          </tr>
          <tr v-else-if="columns.length === 0">
            <td class="px-3 py-8 text-center text-slate-500">No rows to display</td>
          </tr>
          <tr
            v-for="(row, index) in rows"
            v-else
            :key="index"
            class="odd:bg-slate-950 odd:bg-opacity-40"
          >
            <td
              v-for="column in columns"
              :key="column"
              class="max-w-[320px] truncate whitespace-nowrap border-b border-slate-800/50 px-3 py-1.5 text-slate-300"
            >
              {{ formatValue(row[column]) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>