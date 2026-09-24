<script setup lang="ts">
import { computed } from 'vue'
import { FlaskConical, FolderOpen, Save, X } from 'lucide-vue-next'
import { useConnectionStore, type DatabaseType } from '../stores/connection'

const store = useConnectionStore()

const isSqlite = computed(() => store.form.type === 'sqlite')

const typeOptions: { value: DatabaseType; label: string }[] = [
  { value: 'mysql', label: 'MySQL' },
  { value: 'mariadb', label: 'MariaDB' },
  { value: 'postgresql', label: 'PostgreSQL' },
  { value: 'sqlite', label: 'SQLite' },
]

const formValid = computed(() => {
  const f = store.form
  if (!f.name.trim()) return false
  if (isSqlite.value) {
    return (f.filePath ?? '').trim().length > 0
  }
  if (!f.host.trim() || !f.username.trim()) return false
  return f.port > 0
})
</script>

<template>
  <section v-if="store.showForm" class="px-4 py-4">
    <div class="mb-3 flex items-center justify-between">
      <h2 class="text-sm font-semibold">
        {{ store.hasEditing ? `Edit "${store.editing?.name}"` : 'New Connection' }}
      </h2>
      <span class="text-xs text-slate-500">Fields marked * are required</span>
    </div>

    <div class="grid grid-cols-2 gap-3">
      <label class="col-span-2 flex flex-col gap-1">
        <span class="text-xs font-medium text-slate-300">Name *</span>
        <input
          v-model="store.form.name"
          type="text"
          placeholder="My local database"
          class="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
        />
      </label>

      <label class="flex flex-col gap-1">
        <span class="text-xs font-medium text-slate-300">Database type *</span>
        <select
          :value="store.form.type"
          class="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
          @change="store.changeType(($event.target as HTMLSelectElement).value as DatabaseType)"
        >
          <option v-for="option in typeOptions" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </label>

      <template v-if="!isSqlite">
        <label class="flex flex-col gap-1">
          <span class="text-xs font-medium text-slate-300">Host *</span>
          <input
            v-model="store.form.host"
            type="text"
            placeholder="localhost"
            class="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
          />
        </label>

        <label class="flex flex-col gap-1">
          <span class="text-xs font-medium text-slate-300">Port *</span>
          <input
            v-model.number="store.form.port"
            type="number"
            min="1"
            max="65535"
            class="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
          />
        </label>

        <label class="flex flex-col gap-1">
          <span class="text-xs font-medium text-slate-300">Username *</span>
          <input
            v-model="store.form.username"
            type="text"
            placeholder="root"
            class="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
          />
        </label>

        <label class="flex flex-col gap-1">
          <span class="text-xs font-medium text-slate-300">Password</span>
          <input
            v-model="store.form.password"
            type="password"
            autocomplete="off"
            placeholder="••••••••"
            class="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
          />
        </label>

        <label class="flex flex-col gap-1">
          <span class="text-xs font-medium text-slate-300">Database</span>
          <input
            v-model="store.form.database"
            type="text"
            placeholder="my_app (optional)"
            class="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
          />
        </label>

        <label class="col-span-2 flex items-center gap-2 pt-1">
          <input
            v-model="store.form.ssl"
            type="checkbox"
            class="h-4 w-4 accent-emerald-500"
          />
          <span class="text-sm text-slate-300">Use SSL/TLS</span>
        </label>
      </template>

      <template v-else>
        <label class="col-span-2 flex flex-col gap-1">
          <span class="text-xs font-medium text-slate-300">Database file path *</span>
          <div class="flex gap-2">
            <input
              v-model="store.form.filePath"
              type="text"
              placeholder="/path/to/database.sqlite"
              class="flex-1 rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
            />
            <button
              class="flex items-center gap-1 rounded bg-slate-700 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-600"
              @click="store.pickFile()"
            >
              <FolderOpen :size="14" />
              Browse…
            </button>
          </div>
          <p class="text-xs text-slate-500">If the file does not exist it will be created.</p>
        </label>

        <label class="col-span-2 flex flex-col gap-1">
          <span class="text-xs font-medium text-slate-300">Display name (optional)</span>
          <input
            v-model="store.form.database"
            type="text"
            placeholder="Leave empty to use the file name"
            class="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
          />
        </label>
      </template>
    </div>

    <div
      v-if="store.testResult"
      class="mt-3 rounded border px-3 py-2 text-sm"
      :class="store.testResult.ok ? 'border-emerald-700 bg-emerald-500/10 text-emerald-300' : 'border-red-700 bg-red-500/10 text-red-300'"
    >
      {{ store.testResult.ok ? '✓ ' : '✕ ' }}{{ store.testResult.message }}
    </div>

    <div class="mt-4 flex gap-2">
      <button
        class="flex items-center gap-1 rounded bg-slate-700 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-600"
        @click="store.closeForm()"
      >
        <X :size="14" />
        Cancel
      </button>
      <button
        class="flex items-center gap-1 rounded bg-slate-600 px-3 py-2 text-sm font-medium text-white hover:bg-slate-500 disabled:opacity-50"
        :disabled="!formValid || store.testing"
        @click="store.test()"
      >
        <FlaskConical :size="14" />
        Test Connection
      </button>
      <button
        class="flex flex-1 items-center justify-center gap-1 rounded bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
        :disabled="!formValid || store.testing || store.saving"
        @click="store.save()"
      >
        <Save :size="14" />
        {{ store.saving ? 'Saving…' : store.hasEditing ? 'Save Changes' : 'Save Connection' }}
      </button>
    </div>
  </section>
</template>