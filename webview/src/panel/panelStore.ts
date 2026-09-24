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
  queryResult: QueryResultData | null
  running: boolean
  queryError: string | null
  queryPage: number
  queryPageSize: number
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
    queryResult: null,
    running: false,
    queryError: null,
    queryPage: 1,
    queryPageSize: 0,
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
      this.queryResult = null
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

    applyQueryResult(data: QueryResultData & { error?: string }) {
      this.running = false
      this.queryError = null
      if (data.error) {
        this.queryError = data.error
        return
      }
      this.queryResult = {
        columns: data.columns,
        rows: data.rows,
        rowCount: data.rowCount,
        total: data.total,
        page: data.page,
        pageSize: data.pageSize,
        executionTime: data.executionTime,
        countExecutionTime: data.countExecutionTime ?? null,
      }
      this.queryPage = data.page ?? 1
      this.queryPageSize = data.pageSize ?? 0
    },
    goToPage(page: number) {
      if (this.running) {
        return
      }
      this.running = true
      this.post('queryPage', { page })
    },
    setQueryPageSize(size: number) {
      if (this.running) {
        return
      }
      this.running = true
      this.post('queryPageSize', { pageSize: size })
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

    runQuery(sql?: string) {
      const target = sql?.trim() ? sql : this.sql
      if (!target?.trim()) {
        this.queryError = 'Please enter a SQL query'
        return
      }
      this.running = true
      this.queryError = null
      this.post('runQuery', { sql: target })
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