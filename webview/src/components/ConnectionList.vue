<script setup lang="ts">
import { Plus, Pencil, Plug, Trash2, Unplug } from 'lucide-vue-next'
import { useConnectionStore } from '../stores/connection'

const store = useConnectionStore()

function typeLabel(type: string): string {
  switch (type) {
    case 'mysql':
      return 'MySQL'
    case 'mariadb':
      return 'MariaDB'
    case 'postgresql':
      return 'PostgreSQL'
    case 'sqlite':
      return 'SQLite'
    default:
      return type
  }
}

function endpoint(conn: { type: string; host: string; port: number; filePath?: string }): string {
  if (conn.type === 'sqlite') {
    return conn.filePath || conn.host || 'database file'
  }
  return `${conn.host}:${conn.port}`
}

function displayName(conn: { type: string; database?: string; filePath?: string }): string {
  if (conn.type === 'sqlite') {
    return conn.database || conn.filePath || 'SQLite'
  }
  return conn.database || 'default database'
}
</script>

<template>
  <section class="border-b border-slate-800">
    <div class="flex items-center justify-between px-4 pt-3">
      <h2 class="text-xs font-semibold uppercase tracking-wider text-slate-400">Connections</h2>
      <button
        class="flex items-center gap-1 rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-500"
        @click="store.startNew()"
      >
        <Plus :size="14" />
        New
      </button>
    </div>

    <div class="max-h-64 overflow-y-auto px-2 py-2">
      <p v-if="store.connections.length === 0" class="px-2 py-6 text-center text-sm text-slate-500">
        No saved connections yet.<br />Click <span class="font-semibold text-emerald-400">New</span> to create
        one.
      </p>

      <ul class="space-y-2">
        <li
          v-for="connection in store.connections"
          :key="connection.id"
          class="rounded-lg border border-slate-800 bg-slate-900 p-3"
          :class="{ 'border-emerald-700': store.isConnected(connection.id) }"
        >
          <div class="flex items-center justify-between gap-2">
            <span
              class="inline-flex items-center gap-1.5 text-sm font-medium"
              :class="store.isConnected(connection.id) ? 'text-emerald-300' : 'text-slate-200'"
            >
              <span
                class="h-2 w-2 rounded-full"
                :class="store.isConnected(connection.id) ? 'bg-emerald-400' : 'bg-slate-600'"
              ></span>
              {{ connection.name }}
            </span>
            <span class="text-[10px] uppercase tracking-wide text-slate-500">
              {{ store.isConnected(connection.id) ? 'Connected' : 'Disconnected' }}
            </span>
          </div>

          <p class="mt-1 text-xs text-slate-400">
            {{ typeLabel(connection.type) }} • {{ endpoint(connection) }}
            <span v-if="displayName(connection) && connection.type !== 'sqlite'" class="text-slate-500">
              → {{ displayName(connection) }}
            </span>
          </p>

          <div class="mt-2 flex items-center gap-1.5">
            <button
              v-if="!store.isConnected(connection.id)"
              class="flex flex-1 items-center justify-center gap-1 rounded bg-emerald-600/90 px-2 h-8 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
              :disabled="store.busyId === connection.id"
              @click="store.connect(connection.id)"
            >
              <Plug :size="14" />
              Connect
            </button>
            <button
              v-else
              class="flex flex-1 items-center justify-center gap-1 rounded bg-amber-600/90 px-2 h-8 text-xs font-medium text-white hover:bg-amber-500 disabled:opacity-50"
              :disabled="store.busyId === connection.id"
              @click="store.disconnect(connection.id)"
            >
              <Unplug :size="14" />
              Disconnect
            </button>
            <button
              class="flex h-8 w-8 items-center justify-center rounded bg-slate-700 text-slate-200 hover:bg-slate-600"
              title="Edit"
              @click="store.edit(connection.id)"
            >
              <Pencil :size="14" />
            </button>
            <button
              class="flex h-8 w-8 items-center justify-center rounded bg-slate-700 text-red-300 hover:bg-slate-600"
              title="Delete"
              @click="store.remove(connection.id)"
            >
              <Trash2 :size="14" />
            </button>
          </div>
        </li>
      </ul>
    </div>
  </section>
</template>