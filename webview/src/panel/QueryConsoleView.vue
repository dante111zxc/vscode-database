<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { usePanelStore } from './panelStore'
import { highlightSql, escapeHtml } from './sqlHighlight'
import { buildSuggestions, canShowSuggestion, formatSql, isKeywordToken, kindLabel, splitStatements, suggestionStart } from './sqlCompletion'
import type { Suggestion } from './sqlCompletion'
import DataGrid from './DataGrid.vue'

const store = usePanelStore()

const editor = ref<HTMLTextAreaElement | null>(null)
const highlight = ref<HTMLElement | null>(null)
const mirror = ref<HTMLElement | null>(null)

const highlightedHtml = computed(() => highlightSql(store.sql))

interface SuggestState {
  open: boolean
  items: Suggestion[]
  index: number
  start: number
}
const suggest = ref<SuggestState>({ open: false, items: [], index: 0, start: 0 })
const caret = ref({ left: 0, top: 0 })
const dismissed = ref(false)

const suggestStyle = computed(() => ({
  left: `${caret.value.left}px`,
  top: `${caret.value.top + 18}px`,
}))

const pageInput = ref(1)

const contextMenu = ref({ open: false, x: 0, y: 0 })
const contextEdit = ref({ hasSelection: false })

const editorHeight = ref(220)

const MIN_EDITOR_HEIGHT = 120
const MAX_EDITOR_HEIGHT = 560

function startResize(event: PointerEvent): void {
  event.preventDefault()
  const startY = event.clientY
  const startHeight = editorHeight.value
  const onMove = (moveEvent: PointerEvent) => {
    editorHeight.value = Math.min(
      MAX_EDITOR_HEIGHT,
      Math.max(MIN_EDITOR_HEIGHT, startHeight + (moveEvent.clientY - startY))
    )
  }
  const onUp = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

const activeResult = computed(() => store.activeResult())

const totalPages = computed(() => {
  const result = activeResult.value
  if (!result || result.total == null || result.pageSize <= 0) {
    return 1
  }
  return Math.max(1, Math.ceil(result.total / result.pageSize))
})

const hasPrevPage = computed(() => {
  const result = activeResult.value
  return result != null && (pageInput.value > 1 || result.page > 1) && !store.running
})

const hasNextPage = computed(() => {
  const result = activeResult.value
  if (!result) {
    return false
  }
  return result.page < totalPages.value && !store.running
})

watch(
  () => activeResult.value?.page,
  (page) => {
    if (typeof page === 'number') {
      pageInput.value = page
    }
  },
  { immediate: true }
)

function onPageSizeChange(event: Event): void {
  const size = Number((event.target as HTMLSelectElement).value)
  store.setQueryPageSize(size)
}

function onGotoPage(): void {
  const input = Math.round(pageInput.value)
  if (!Number.isFinite(input)) {
    return
  }
  const clamped = Math.min(Math.max(1, input), totalPages.value)
  pageInput.value = clamped
  store.goToPage(clamped)
}

function onPrevPage(): void {
  store.goToPage(pageInput.value - 1)
}

function onNextPage(): void {
  store.goToPage(pageInput.value + 1)
}

function editorEl(): HTMLTextAreaElement | null {
  return editor.value
}

function syncHighlight(): void {
  const el = editorEl()
  const pre = highlight.value
  if (!el || !pre) {
    return
  }
  pre.style.transform = `translate(${-el.scrollLeft}px, ${-el.scrollTop}px)`
}

function updateMirror(): void {
  const el = editorEl()
  const m = mirror.value
  if (!el || !m) {
    return
  }
  const text = el.value.slice(0, el.selectionStart)
  m.innerHTML = `${escapeHtml(text)}<span id="caret-marker">&nbsp;</span>`
  const marker = m.querySelector<HTMLElement>('#caret-marker')
  caret.value.left = marker ? marker.offsetLeft - el.scrollLeft : 0
  caret.value.top = marker ? marker.offsetTop - el.scrollTop : 0
}

function refreshSuggestions(): void {
  const el = editorEl()
  if (!el) {
    return
  }
  if (dismissed.value) {
    suggest.value = { open: false, items: [], index: 0, start: el.selectionEnd }
    return
  }
  const pos = el.selectionEnd
  if (el.selectionStart !== pos) {
    suggest.value = { open: false, items: [], index: 0, start: pos }
    return
  }
  if (!canShowSuggestion(store.sql, pos)) {
    suggest.value = { open: false, items: [], index: 0, start: pos }
    return
  }
  const items = buildSuggestions(store.schemaInfo, store.sql, pos)
  if (items.length === 0) {
    suggest.value = { open: false, items: [], index: 0, start: pos }
    return
  }
  const start = suggestionStart(store.sql, pos)
  const current = suggest.value.items[suggest.value.index]?.text
  const index = current ? Math.max(0, items.findIndex((i) => i.text === current)) : 0
  suggest.value = { open: true, items, index, start }
}

function insertSpaces(): void {
  const el = editorEl()
  if (!el) {
    return
  }
  const start = el.selectionStart ?? el.value.length
  const end = el.selectionEnd ?? el.value.length
  const before = el.value.slice(0, start)
  const after = el.value.slice(end)
  const firstChar = before.trimStart().length > 0 ? '\n' : ''
  const value = `${before}${firstChar}  ${after}`
  el.value = value
  store.sql = value
  const newPos = start + 2
  el.setSelectionRange(newPos, newPos)
  store.notifySql(value)
  void nextTick(updateMirror)
  void nextTick(syncHighlight)
}

function acceptSuggestion(index?: number): void {
  const el = editorEl()
  const target = index ?? suggest.value.index
  const item = suggest.value.items[target]
  if (!el || !item) {
    return
  }
  const pos = el.selectionStart
  const replace = suggestionStart(store.sql, pos)
  const value = `${store.sql.slice(0, replace)}${item.text}${store.sql.slice(pos)}`
  el.value = value
  store.sql = value
  const newPos = replace + item.text.length
  el.setSelectionRange(newPos, newPos)
  suggest.value = { open: false, items: [], index: 0, start: newPos }
  store.notifySql(value)
  void nextTick(updateMirror)
  void nextTick(syncHighlight)
}

function runSelectionOrAll(): void {
  const el = editorEl()
  if (!el) {
    return
  }
  const selected = el.value.slice(el.selectionStart, el.selectionEnd).trim()
  const source = selected || el.value
  store.runStatements(splitStatements(source))
}

watch(
  () => store.runRequest,
  () => {
    runSelectionOrAll()
  }
)

function openContextMenu(event: MouseEvent): void {
  event.preventDefault()
  const el = editorEl()
  contextEdit.value.hasSelection = !!el && el.selectionStart !== el.selectionEnd
  contextMenu.value = { open: true, x: event.clientX, y: event.clientY }
}

function hideContextMenu(): void {
  contextMenu.value.open = false
}

function focusEditor(): HTMLTextAreaElement | null {
  const el = editorEl()
  el?.focus()
  return el
}

function onCut(): void {
  hideContextMenu()
  const el = focusEditor()
  if (!el || el.selectionStart === el.selectionEnd) {
    return
  }
  document.execCommand('cut')
}

function onCopy(): void {
  hideContextMenu()
  const el = focusEditor()
  if (!el || el.selectionStart === el.selectionEnd) {
    return
  }
  document.execCommand('copy')
}

function onPaste(): void {
  hideContextMenu()
  const el = focusEditor()
  if (!el) {
    return
  }
  const committed = document.execCommand('paste')
  if (!committed) {
    void navigator.clipboard
      .readText()
      .then((text) => {
        if (!text || !el.isConnected) {
          return
        }
        const start = el.selectionStart
        const end = el.selectionEnd
        const value = `${el.value.slice(0, start)}${text}${el.value.slice(end)}`
        el.value = value
        store.sql = value
        const pos = start + text.length
        el.setSelectionRange(pos, pos)
        store.notifySql(value)
        void nextTick(updateMirror)
        void nextTick(syncHighlight)
      })
      .catch(() => undefined)
  }
}

function onSelectAll(): void {
  const el = focusEditor()
  if (!el) {
    return
  }
  el.select()
}

function onCaretMove(): void {
  void nextTick(() => {
    updateMirror()
  })
}

function onDismissSuggest(): void {
  suggest.value = { open: false, items: [], index: 0, start: 0 }
  dismissed.value = true
}

function onRequestSuggest(): void {
  dismissed.value = false
  refreshSuggestions()
}

function maybeAutoSpaceKeyword(event: Event): void {
  const input = event as InputEvent
  if (input.inputType?.startsWith('delete')) {
    return
  }
  const el = editorEl()
  if (!el) {
    return
  }
  const pos = el.selectionStart
  const before = el.value.slice(0, pos)
  const word = /[A-Za-z_][A-Za-z0-9_]*$/.exec(before)
  if (!word || !isKeywordToken(word[0])) {
    return
  }
  const next = el.value[pos] ?? ''
  if (/\s/.test(next) || next === '.' || /[A-Za-z0-9_$]/.test(next)) {
    return
  }
  if (document.execCommand) {
    requestAnimationFrame(() => {
      if (document.execCommand('insertText', false, ' ')) {
        store.notifySql(el.value)
      }
    })
  }
}

function onInput(event: Event): void {
  const el = editorEl()
  if (!el) {
    return
  }
  maybeAutoSpaceKeyword(event)
  syncHighlight()
  updateMirror()
  dismissed.value = false
  refreshSuggestions()
  store.notifySql(el.value)
}

function onScroll(): void {
  syncHighlight()
}

function onFormat(): void {
  const el = editorEl()
  if (!el) {
    return
  }
  const formatted = formatSql(store.sql)
  el.value = formatted
  store.sql = formatted
  store.notifySql(formatted)
  void nextTick(updateMirror)
  void nextTick(syncHighlight)
}

function onKeydown(event: KeyboardEvent): void {
  const el = editorEl()
  if (!el) {
    return
  }
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && (event.key === 'F' || event.key === 'f')) {
    event.preventDefault()
    onFormat()
    return
  }
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault()
    runSelectionOrAll()
    return
  }
  if (suggest.value.open && suggest.value.items.length > 0) {
    const { items, index } = suggest.value
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      suggest.value.index = (index + 1) % items.length
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      suggest.value.index = (index - 1 + items.length) % items.length
      return
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      acceptSuggestion()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      onDismissSuggest()
      return
    }
  }
  if ((event.ctrlKey || event.metaKey) && event.key === ' ') {
    event.preventDefault()
    onRequestSuggest()
    return
  }
  if (event.key === 'Tab') {
    event.preventDefault()
    insertSpaces()
  }
}

function onBlur(): void {
  suggest.value = { open: false, items: [], index: 0, start: 0 }
  store.flushSql()
}

watch(
  () => store.sql,
  () => {
    void nextTick(() => {
      syncHighlight()
      updateMirror()
    })
  }
)

onMounted(() => {
  editorEl()?.focus()
  window.addEventListener('pointerdown', hideContextMenu)
})
</script>

<template>
  <div class="flex h-full flex-col">
<div class="border-b border-slate-800 px-4 py-2">
        <div
          class="ql-shell relative"
          :style="{ height: `${editorHeight}px` }"
          @contextmenu="openContextMenu"
        >
        <pre ref="highlight" class="ql-layer" aria-hidden="true" v-html="highlightedHtml"></pre>
        <div ref="mirror" class="ql-layer ql-mirror" aria-hidden="true"></div>
        <textarea
          ref="editor"
          v-model="store.sql"
          class="ql-layer ql-input"
          wrap="off"
          spellcheck="false"
          placeholder="SELECT * FROM my_table LIMIT 100;"
          @input="onInput"
          @keydown="onKeydown"
          @keyup="onCaretMove"
          @scroll="onScroll"
          @blur="onBlur"
        ></textarea>
        <div
          v-if="suggest.open && suggest.items.length > 0"
          class="ql-suggest"
          :style="suggestStyle"
        >
          <div
            v-for="(item, i) in suggest.items"
            :key="`${item.kind}:${item.text}`"
            class="ql-suggest-item"
            :class="{ active: i === suggest.index }"
            @mousedown.prevent="acceptSuggestion(i)"
          >
            <span class="ql-suggest-text">{{ item.text }}</span>
            <span class="ql-suggest-kind">{{ kindLabel(item.kind) }}</span>
          </div>
        </div>
      </div>
      <div class="mt-2 flex items-center gap-2">
        <span class="text-[10px] text-slate-500">Ctrl+Enter run • Ctrl+Shift+F format</span>
        <span v-if="store.queryError" class="text-xs text-red-300">{{ store.queryError }}</span>
        <span
          v-if="activeResult && !activeResult.error && activeResult.rowCount > 0"
          class="ml-auto text-xs text-slate-400"
        >
          {{ activeResult.rowCount.toLocaleString() }} rows
          <template v-if="activeResult.countExecutionTime != null">
            • count in {{ activeResult.countExecutionTime.toFixed(2) }} ms
          </template>
        </span>
      </div>
      <div
        class="ql-resizer"
        title="Kéo để điều chỉnh chiều cao editor"
        @pointerdown="startResize"
      ></div>
    </div>

    <div
      v-if="contextMenu.open"
      class="fixed z-50 min-w-44 rounded-md border border-slate-700 bg-slate-900 py-1 shadow-lg"
      :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
      @pointerdown.stop
    >
      <button
        class="flex w-full items-center justify-between gap-4 px-3 py-1.5 text-left text-xs text-slate-200 hover:bg-slate-800 disabled:cursor-default disabled:opacity-40"
        :disabled="!contextEdit.hasSelection"
        @click="onCut"
      >
        <span>Cut</span>
        <kbd class="text-[10px] text-slate-500">Ctrl+X</kbd>
      </button>
      <button
        class="flex w-full items-center justify-between gap-4 px-3 py-1.5 text-left text-xs text-slate-200 hover:bg-slate-800 disabled:cursor-default disabled:opacity-40"
        :disabled="!contextEdit.hasSelection"
        @click="onCopy"
      >
        <span>Copy</span>
        <kbd class="text-[10px] text-slate-500">Ctrl+C</kbd>
      </button>
      <button
        class="flex w-full items-center justify-between gap-4 px-3 py-1.5 text-left text-xs text-slate-200 hover:bg-slate-800"
        @click="onPaste"
      >
        <span>Paste</span>
        <kbd class="text-[10px] text-slate-500">Ctrl+V</kbd>
      </button>
      <button
        class="flex w-full items-center justify-between gap-4 px-3 py-1.5 text-left text-xs text-slate-200 hover:bg-slate-800"
        @click="onSelectAll"
      >
        <span>Select All</span>
        <kbd class="text-[10px] text-slate-500">Ctrl+A</kbd>
      </button>
      <div class="my-1 border-t border-slate-800"></div>
      <button
        class="flex w-full items-center justify-between gap-4 px-3 py-1.5 text-left text-xs text-slate-200 hover:bg-slate-800"
        @click="onFormat"
      >
        <span>Format SQL</span>
        <kbd class="text-[10px] text-slate-500">Ctrl+Shift+F</kbd>
      </button>
    </div>

    <div class="flex min-h-0 flex-1 flex-col">
      <div v-if="store.queryTabs.length > 0" class="flex gap-1 overflow-x-auto border-b border-slate-800 px-2 pt-1.5">
        <button
          v-for="(tab, i) in store.queryTabs"
          :key="tab.id"
          class="group flex max-w-56 flex-none items-center gap-1.5 rounded-t border-b-2 px-2.5 py-1.5 text-xs transition-colors"
          :class="
            i === store.activeTab
              ? 'border-emerald-500 bg-slate-900 text-slate-100'
              : 'border-transparent text-slate-400 hover:bg-slate-900/50 hover:text-slate-200'
          "
          @click="store.activeTab = i"
        >
          <span class="truncate">{{ tab.title }}</span>
          <span
            v-if="tab.state === 'running'"
            class="h-3 w-3 flex-none animate-spin rounded-full border border-slate-400 border-t-transparent"
          ></span>
          <span
            v-else-if="tab.error"
            class="flex-none text-red-400"
            title="Query failed"
          >!</span>
          <span
            v-else
            class="flex-none text-slate-500 opacity-0 transition-opacity group-hover:opacity-100 hover:text-slate-200"
            @click.stop="store.closeTab(i)"
          >×</span>
        </button>
      </div>
      <template v-if="activeResult">
        <div
          v-if="activeResult.error"
          class="flex flex-1 items-center justify-center overflow-auto p-4 text-center text-xs text-red-300"
        >
          {{ activeResult.error }}
        </div>
        <DataGrid
          v-else
          :columns="activeResult.columns"
          :rows="activeResult.rows"
          :loading="store.running && activeResult.state === 'running'"
        />
        <div
          v-if="!activeResult.error && activeResult.pageSize > 0"
          class="flex items-center gap-2 border-t border-slate-800 px-4 py-2"
        >
          <select
            class="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-300 outline-none"
            :value="activeResult.pageSize"
            :disabled="store.running"
            @change="onPageSizeChange"
          >
            <option v-for="size in [50, 100, 200, 500, 1000]" :key="size" :value="size">
              {{ size }} / page
            </option>
          </select>
          <button
            class="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-900/60 disabled:opacity-40"
            :disabled="store.running || !hasPrevPage"
            @click="onPrevPage"
          >
            ‹ Prev
          </button>
          <span class="text-xs text-slate-300">Page</span>
          <input
            v-model.number="pageInput"
            type="number"
            min="1"
            class="w-16 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-300 outline-none"
            @keydown.enter="onGotoPage"
            @blur="onGotoPage"
          />
          <span class="text-xs text-slate-300">/ {{ totalPages }}</span>
          <button
            class="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-900/60 disabled:opacity-40"
            :disabled="store.running || !hasNextPage"
            @click="onNextPage"
          >
            Next ›
          </button>
          <span class="ml-auto text-xs text-slate-400">
            <template v-if="activeResult.total != null">
              {{ ((activeResult.page - 1) * activeResult.pageSize + 1).toLocaleString() }}–{{
                ((activeResult.page - 1) * activeResult.pageSize + activeResult.rowCount).toLocaleString()
              }}
              of
              {{ activeResult.total.toLocaleString() }}
              rows
            </template>
            <template v-else>
              {{ activeResult.rowCount.toLocaleString() }} rows
            </template>
            in {{ activeResult.executionTime.toFixed(2) }} ms
          </span>
        </div>
      </template>
      <div v-else class="flex flex-1 items-center justify-center text-xs text-slate-500">
        Run a query to see results
      </div>
    </div>
  </div>
</template>