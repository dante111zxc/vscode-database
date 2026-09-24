import { defineStore } from 'pinia'

export type PanelMode = 'table' | 'query'

export interface SchemaTableInfo {
  name: string
  columns: string[]
}

export interface SchemaInfo {
  tables: SchemaTableInfo[]
}

export interface TablePage {
  columns: string[]
  rows: Record<string, unknown>[]
  total: number
  page: number
  pageSize: number
  tableName: string
}

export interface QueryResultData {
  columns: string[]
  rows: Record<string, unknown>[]
  rowCount: number
  total: number | null
  page: number
  pageSize: number
  executionTime: number
  countExecutionTime: number | null
}

export interface QueryResultTab {
  id: string
  title: string
  sql: string
  columns: string[]
  rows: Record<string, unknown>[]
  rowCount: number
  total: number | null
  page: number
  pageSize: number
  executionTime: number
  countExecutionTime: number | null
  error: string | null
  state: 'queued' | 'running' | 'done'
}

interface PanelState {
  mode: PanelMode
  title: string
  columns: string[]
  rows: Record<string, unknown>[]
  total: number
  page: number
  pageSize: number
  tableName: string
  loading: boolean
  error: string | null
  sql: string
  schemaInfo: SchemaInfo
  queryTabs: QueryResultTab[]
  activeTab: number
  running: boolean
  queryError: string | null
  runRequest: number
}

let vscodeApi: ReturnType<typeof acquireVsCodeApi> | null = null

let sqlSyncTimer: number | null = null

export const usePanelStore = defineStore('panel', {
  state: (): PanelState => ({
    mode: 'table',
    title: '',
    columns: [],
    rows: [],
    total: 0,
    page: 1,
    pageSize: 50,
    tableName: '',
    loading: false,
    error: null,
    sql: '',
    schemaInfo: { tables: [] },
    queryTabs: [],
    activeTab: -1,
    running: false,
    queryError: null,
    runRequest: 0,
  }),

  actions: {
    vscode() {
      vscodeApi = vscodeApi ?? acquireVsCodeApi()
      return vscodeApi
    },

    post(type: string, payload?: Record<string, unknown>) {
      this.vscode().postMessage({ type, payload })
    },

    handleMessage(message: { type: string; payload?: Record<string, unknown> }) {
      const payload = message.payload ?? {}
      switch (message.type) {
        case 'init':
          this.applyInit(
            payload as {
              mode: PanelMode
              title: string
              tableName?: string
              columns?: string[]
              sql?: string
            }
          )
          break
        case 'page':
          this.applyPage(payload as TablePage)
          break
        case 'queryResult':
          this.applyQueryResult(payload as QueryResultData & { error?: string })
          break
        case 'schemaInfo':
          this.schemaInfo = { tables: (payload as { tables?: SchemaTableInfo[] }).tables ?? [] }
          break
        case 'error':
          this.loading = false
          this.running = false
          this.error = (payload.message as string | undefined) ?? 'Unknown error'
          break
        default:
          break
      }
    },

    applyInit(data: {
      mode: PanelMode
      title: string
      tableName?: string
      columns?: string[]
      sql?: string
    }) {
      this.mode = data.mode
      this.title = data.title
      this.tableName = data.tableName ?? ''
      this.columns = data.columns ?? []
      this.error = null
      this.queryError = null
      this.queryTabs = []
      this.activeTab = -1
      if (typeof data.sql === 'string') {
        this.sql = data.sql
      }
      if (data.mode === 'table') {
        this.page = 1
        this.requestPage()
      } else if (data.mode === 'query') {
        this.schemaInfo = { tables: [] }
        this.getSchemaInfo()
      }
    },

    getSchemaInfo() {
      this.post('getSchemaInfo', {})
    },

    applyPage(page: TablePage) {
      this.loading = false
      this.error = null
      this.columns = page.columns
      this.rows = page.rows
      this.total = page.total
      this.page = page.page
      this.pageSize = page.pageSize
      this.tableName = page.tableName
    },

    applyQueryResult(data: QueryResultData & { error?: string; statementId?: string }) {
      const target = typeof data.statementId === 'string'
        ? this.queryTabs.find((tab) => tab.id === data.statementId)
        : null
      if (target) {
        if (data.error) {
          target.error = data.error
          target.state = 'done'
        } else {
          target.columns = data.columns
          target.rows = data.rows
          target.rowCount = data.rowCount
          target.total = data.total
          target.page = data.page
          target.pageSize = data.pageSize
          target.executionTime = data.executionTime
          target.countExecutionTime = data.countExecutionTime ?? null
          target.error = null
          target.state = 'done'
        }
        const index = this.queryTabs.indexOf(target)
        this.activeTab = index
      } else if (typeof data.statementId !== 'string' && !data.error) {
        this.addStandaloneTab(data)
      }
      this.kickNextQuery()
    },

    runStatements(statements: string[]) {
      if (this.running) {
        return
      }
      const clean = statements.map((sql) => sql.trim()).filter((sql) => sql.length > 0)
      if (clean.length === 0) {
        this.queryError = 'Please enter a SQL query'
        return
      }
      const now = Date.now()
      this.queryTabs = clean.map((sql, i) => ({
        id: `q_${now}_${i}`,
        title: tabTitle(sql, i),
        sql,
        columns: [],
        rows: [],
        rowCount: 0,
        total: null,
        page: 1,
        pageSize: 0,
        executionTime: 0,
        countExecutionTime: null,
        error: null,
        state: i === 0 ? 'running' : 'queued',
      }))
      this.activeTab = this.queryTabs.length - 1
      this.queryError = null
      this.running = true
      const first = this.queryTabs[0]
      this.post('runQuery', { sql: first.sql, statementId: first.id })
    },

    kickNextQuery() {
      const next = this.queryTabs.find((tab) => tab.state === 'queued')
      if (!next) {
        this.running = false
        return
      }
      next.state = 'running'
      this.activeTab = this.queryTabs.indexOf(next)
      this.post('runQuery', { sql: next.sql, statementId: next.id })
    },

    closeTab(index: number) {
      if (index < 0 || index >= this.queryTabs.length) {
        return
      }
      this.queryTabs.splice(index, 1)
      if (this.queryTabs.length === 0) {
        this.activeTab = -1
        this.running = false
        return
      }
      if (this.activeTab >= this.queryTabs.length) {
        this.activeTab = this.queryTabs.length - 1
      } else if (this.activeTab === index) {
        this.activeTab = Math.max(0, index - 1)
      }
    },

    activeResult(): QueryResultTab | null {
      const tab = this.queryTabs[this.activeTab]
      return tab ?? null
    },

    requestRun() {
      this.runRequest += 1
    },

    addStandaloneTab(data: QueryResultData & { error?: string; sql?: string }) {
      const sql = typeof data.sql === 'string' ? data.sql : ''
      const index = this.queryTabs.length + 1
      this.queryTabs.push({
        id: `q_standalone_${Date.now()}_${index}`,
        title: tabTitle(sql, index),
        sql,
        columns: data.columns,
        rows: data.rows,
        rowCount: data.rowCount,
        total: data.total,
        page: data.page,
        pageSize: data.pageSize,
        executionTime: data.executionTime,
        countExecutionTime: data.countExecutionTime ?? null,
        error: data.error ?? null,
        state: 'done',
      })
      this.activeTab = this.queryTabs.length - 1
      this.queryError = null
    },

    goToPage(page: number) {
      if (this.running) {
        return
      }
      const tab = this.queryTabs[this.activeTab]
      if (!tab) {
        return
      }
      this.running = true
      this.post('queryPage', { page, statementId: tab.id, sql: tab.sql })
    },

    setQueryPageSize(size: number) {
      if (this.running) {
        return
      }
      const tab = this.queryTabs[this.activeTab]
      if (!tab) {
        return
      }
      this.running = true
      this.post('queryPageSize', { pageSize: size, statementId: tab.id, sql: tab.sql })
    },

    requestPage() {
      this.loading = true
      this.error = null
      this.post('getPage', { page: this.page, pageSize: this.pageSize })
    },

    setPageSize(size: number) {
      this.pageSize = size
      this.page = 1
      this.requestPage()
    },

    nextPage() {
      this.page += 1
      this.requestPage()
    },

    prevPage() {
      if (this.page > 1) {
        this.page -= 1
        this.requestPage()
      }
    },

    notifySql(sql: string) {
      if (sqlSyncTimer !== null) {
        clearTimeout(sqlSyncTimer)
      }
      sqlSyncTimer = window.setTimeout(() => {
        sqlSyncTimer = null
        this.post('sqlChanged', { sql })
      }, 250)
    },

    flushSql() {
      if (sqlSyncTimer !== null) {
        clearTimeout(sqlSyncTimer)
        sqlSyncTimer = null
      }
      this.post('sqlChanged', { sql: this.sql })
    },
  },
})

function tabTitle(sql: string, index: number): string {
  const first =
    sql
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? ''
  const cleaned = first
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(-{2}.*$)/, '')
    .trim()
  if (!cleaned) {
    return `Query ${index}`
  }
  return cleaned.length > 26 ? `${cleaned.slice(0, 26)}…` : cleaned
}