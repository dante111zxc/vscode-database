import * as vscode from 'vscode'
import type { ConnectionManager } from '../database/ConnectionManager'
import type { QueryStore } from '../database/queryStore'
import type { DatabaseDriver } from '../database/contracts/DatabaseDriver'
import { buildWebviewHtml } from '../webview/webviewHtml'
import { sanitizeRows } from '../utils/values'

export interface TableRef {
  connectionId: string
  database?: string
  schema?: string
  table: string
}

interface WebviewMessage {
  type: string
  payload?: Record<string, unknown>
}

const QUERY_PAGE_SIZE = 200

function canPaginate(sql: string): boolean {
  const trimmed = sql.trim()
  const base = trimmed.replace(/;\s*$/, '')
  if (!/^(SELECT|WITH)\b/i.test(base.trim())) {
    return false
  }
  if (/;/.test(base)) {
    return false
  }
  return !/^(CREATE|ALTER|DROP|TRUNCATE|INSERT|UPDATE|DELETE)\b/i.test(base.trim())
}

function buildPageSql(base: string, pageSize: number, offset: number): string {
  return `SELECT * FROM (\n${base}\n) AS "_dbm_page" LIMIT ${pageSize + 1} OFFSET ${offset}`
}

const WEBVIEW_ROOT = 'dist/webview'

function webviewRoot(context: vscode.ExtensionContext): vscode.Uri {
  return vscode.Uri.joinPath(vscode.Uri.file(context.extensionPath), WEBVIEW_ROOT)
}

export class TableDataPanel {
  private static readonly openPanels = new Map<string, TableDataPanel>()

  public static show(
    context: vscode.ExtensionContext,
    manager: ConnectionManager,
    table: TableRef
  ): void {
    const key = `${table.connectionId}:${table.database ?? ''}:${table.schema ?? ''}:${table.table}`
    const existing = TableDataPanel.openPanels.get(key)
    if (existing) {
      existing.panel.reveal()
      return
    }
    new TableDataPanel(context, manager, table, key)
  }

  private readonly panel: vscode.WebviewPanel

  private disposed = false

  private constructor(
    context: vscode.ExtensionContext,
    private readonly manager: ConnectionManager,
    private readonly table: TableRef,
    key: string
  ) {
    this.panel = vscode.window.createWebviewPanel(
      'databaseManager.tableData',
      this.title(),
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        localResourceRoots: [webviewRoot(context)],
        retainContextWhenHidden: true,
      }
    )
    this.panel.webview.html = buildWebviewHtml(this.panel.webview, context, 'panel.html')
    TableDataPanel.openPanels.set(key, this)
    this.panel.onDidDispose(() => {
      this.disposed = true
      TableDataPanel.openPanels.delete(key)
    })
    this.panel.webview.onDidReceiveMessage((message: WebviewMessage) => {
      void this.handleMessage(message)
    })
  }

  private title(): string {
    return this.table.schema ? `${this.table.schema}.${this.table.table}` : this.table.table
  }

  private async handleMessage(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case 'ready': {
        await this.post('init', {
          mode: 'table',
          title: this.title(),
          tableName: this.table.table,
        })
        break
      }
      case 'getPage': {
        const payload = message.payload ?? {}
        await this.sendPage(Number(payload.page ?? 1), Number(payload.pageSize ?? 50))
        break
      }
      default:
        break
    }
  }

  private async sendPage(page: number, pageSize: number): Promise<void> {
    try {
      await this.ensureConnected()
      const driver = this.manager.getDriver(this.table.connectionId)
      if (!driver) {
        throw new Error('Connection is not active')
      }
      const offset = (page - 1) * pageSize
      const [total, data] = await Promise.all([
        driver.count(this.table.table, this.table.database, this.table.schema),
        driver.paginate(this.table.table, this.table.database, this.table.schema, pageSize, offset),
      ])
      await this.post('page', {
        columns: data.columns,
        rows: sanitizeRows(data.rows),
        total,
        page,
        pageSize,
        tableName: this.table.table,
      })
    } catch (error) {
      await this.post('error', { message: toMessage(error) })
    }
  }

  private async ensureConnected(): Promise<void> {
    if (!this.manager.isConnected(this.table.connectionId)) {
      await this.manager.connect(this.table.connectionId)
    }
  }

  private async post(type: string, payload: unknown): Promise<void> {
    if (this.disposed) {
      return
    }
    await this.panel.webview.postMessage({ type, payload })
  }
}

export interface QueryConsoleTarget {
  connectionId: string
  database?: string
  schema?: string
  sql?: string
  savedQueryId?: string
  title: string
}

export class QueryPanel {
  private static readonly openPanels = new Map<string, QueryPanel>()

  public static open(
    context: vscode.ExtensionContext,
    manager: ConnectionManager,
    queryStore: QueryStore,
    target: QueryConsoleTarget
  ): void {
    const key = target.savedQueryId ?? `${target.connectionId}:${target.database ?? ''}:${target.schema ?? ''}`
    const existing = QueryPanel.openPanels.get(key)
    if (existing) {
      existing.panel.reveal()
      return
    }
    new QueryPanel(context, manager, queryStore, target, key)
  }

  private readonly panel: vscode.WebviewPanel

  private disposed = false

  private currentSql = ''

  private pagination: {
    sql: string
    page: number
    pageSize: number
    total: number | null
  } | null = null

  private postingPage = false

  private countExecutionTime: number | null = null

  private constructor(
    context: vscode.ExtensionContext,
    private readonly manager: ConnectionManager,
    private readonly queryStore: QueryStore,
    private readonly target: QueryConsoleTarget,
    key: string
  ) {
    this.panel = vscode.window.createWebviewPanel(
      'databaseManager.queryConsole',
      target.title,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        localResourceRoots: [webviewRoot(context)],
        retainContextWhenHidden: true,
      }
    )
    this.currentSql = target.sql ?? ''
    this.panel.webview.html = buildWebviewHtml(this.panel.webview, context, 'panel.html')
    QueryPanel.openPanels.set(key, this)
    this.panel.onDidDispose(() => {
      this.disposed = true
      QueryPanel.openPanels.delete(key)
      void this.maybePromptSave()
    })
    this.panel.webview.onDidReceiveMessage((message: WebviewMessage) => {
      void this.handleMessage(message)
    })
  }

  private async handleMessage(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case 'ready': {
        await this.post('init', {
          mode: 'query',
          title: this.target.title,
          sql: this.currentSql,
          schema: this.target.schema ?? null,
          connectionId: this.target.connectionId,
          database: this.target.database ?? null,
          savedQueryId: this.target.savedQueryId ?? null,
        })
        break
      }
      case 'sqlChanged': {
        const payload = message.payload ?? {}
        this.currentSql = typeof payload.sql === 'string' ? payload.sql : this.currentSql
        break
      }
      case 'getSchemaInfo': {
        await this.sendSchemaInfo()
        break
      }
      case 'runQuery': {
        const payload = message.payload ?? {}
        await this.runQuery(String(payload.sql ?? ''))
        break
      }
      case 'queryPage': {
        const payload = message.payload ?? {}
        const page = Math.max(1, Number(payload.page ?? 1))
        await this.goToPage(page)
        break
      }
      case 'queryPageSize': {
        const payload = message.payload ?? {}
        const size = Math.max(1, Number(payload.pageSize ?? QUERY_PAGE_SIZE))
        await this.setPageSize(size)
        break
      }
      default:
        break
    }
  }

  private async runQuery(sql: string): Promise<void> {
    try {
      if (!this.manager.isConnected(this.target.connectionId)) {
        await this.manager.connect(this.target.connectionId)
      }
      const driver = this.manager.getDriver(this.target.connectionId)
      if (!driver) {
        throw new Error('Connection is not active')
      }
      const target = sql.trim()
      this.currentSql = sql
      if (canPaginate(target)) {
        this.countExecutionTime = null
        this.pagination = {
          sql: target.replace(/;\s*$/, ''),
          page: 1,
          pageSize: QUERY_PAGE_SIZE,
          total: null,
        }
        await this.loadPage()
        return
      }
      this.pagination = null
      const result = await driver.execute(target, { database: this.target.database })
      await this.post('queryResult', {
        columns: result.columns,
        rows: sanitizeRows(result.rows),
        rowCount: result.rowCount,
        total: result.rowCount,
        page: 1,
        pageSize: 0,
        executionTime: result.executionTime,
      })
    } catch (error) {
      this.pagination = null
      await this.post('queryResult', {
        columns: [],
        rows: [],
        rowCount: 0,
        total: 0,
        page: 1,
        pageSize: 0,
        executionTime: 0,
        error: toMessage(error),
      })
    }
  }

  private async goToPage(page: number): Promise<void> {
    const pagination = this.pagination
    if (!pagination || this.postingPage) {
      return
    }
    if (pagination.total !== null) {
      const lastPage = Math.max(1, Math.ceil(pagination.total / pagination.pageSize))
      pagination.page = Math.min(Math.max(1, page), lastPage)
    } else {
      pagination.page = Math.max(1, page)
    }
    await this.loadPage()
  }

  private async setPageSize(size: number): Promise<void> {
    const pagination = this.pagination
    if (!pagination || this.postingPage) {
      return
    }
    pagination.pageSize = size
    pagination.page = 1
    await this.loadPage()
  }

  private async loadPage(): Promise<void> {
    const pagination = this.pagination
    if (!pagination || this.postingPage) {
      return
    }
    this.postingPage = true
    try {
      if (!this.manager.isConnected(this.target.connectionId)) {
        await this.manager.connect(this.target.connectionId)
      }
      const driver = this.manager.getDriver(this.target.connectionId)
      if (!driver) {
        throw new Error('Connection is not active')
      }
      if (pagination.total === null) {
        try {
          const countStart = process.hrtime.bigint()
          const countSql = `SELECT COUNT(*) AS "__dbm_count" FROM (\n${pagination.sql}\n) AS "_dbm_src"`
          const countResult = await driver.execute(countSql, { database: this.target.database })
          const first = countResult.rows[0] as Record<string, unknown> | undefined
          pagination.total = Number(first?.__dbm_count ?? 0)
          const countTime = Number(process.hrtime.bigint() - countStart) / 1e6
          this.countExecutionTime = countTime
        } catch {
          pagination.total = null
          this.countExecutionTime = null
        }
      }
      const offset = (pagination.page - 1) * pagination.pageSize
      const sql = buildPageSql(pagination.sql, pagination.pageSize, offset)
      const result = await driver.execute(sql, { database: this.target.database })
      const rows = result.rows.slice(0, pagination.pageSize)
      await this.post('queryResult', {
        columns: result.columns,
        rows: sanitizeRows(rows),
        rowCount: rows.length,
        total: pagination.total,
        page: pagination.page,
        pageSize: pagination.pageSize,
        executionTime: result.executionTime,
        countExecutionTime: this.countExecutionTime,
      })
    } catch (error) {
      await this.post('queryResult', {
        columns: [],
        rows: [],
        rowCount: 0,
        total: pagination.total,
        page: pagination.page,
        pageSize: pagination.pageSize,
        executionTime: 0,
        error: toMessage(error),
      })
    } finally {
      this.postingPage = false
    }
  }

  private async sendSchemaInfo(): Promise<void> {
    try {
      if (!this.manager.isConnected(this.target.connectionId)) {
        await this.manager.connect(this.target.connectionId)
      }
      const driver = this.manager.getDriver(this.target.connectionId)
      if (!driver) {
        throw new Error('Connection is not active')
      }
      const tables = await this.collectTables(driver)
      await this.post('schemaInfo', { tables })
    } catch {
      await this.post('schemaInfo', { tables: [] })
    }
  }

  private async collectTables(driver: DatabaseDriver): Promise<
    { name: string; columns: string[] }[]
  > {
    const withColumns = async (
      name: string,
      database: string | undefined,
      schema: string | undefined
    ): Promise<{ name: string; columns: string[] }> => {
      const columns = await driver.getColumns(name, database, schema)
      return { name, columns: columns.map((c) => c.name) }
    }
    if (driver.type === 'postgresql' && this.target.schema) {
      const objects = await driver.getSchemaObjects(this.target.database, this.target.schema)
      const tables = objects.filter((o) => o.type === 'table' || o.type === 'view')
      return Promise.all(tables.map((o) => withColumns(o.name, this.target.database, this.target.schema)))
    }
    const tables = await driver.getTables(this.target.database)
    return Promise.all(tables.map((t) => withColumns(t.name, this.target.database, t.schema)))
  }

  private async maybePromptSave(): Promise<void> {
    await Promise.resolve()
    const sql = (this.currentSql ?? '').trim()
    if (!sql) {
      return
    }
    const unchanged = this.target.savedQueryId && sql === (this.target.sql ?? '').trim()
    if (unchanged) {
      return
    }
    const choice = await vscode.window.showInformationMessage(
      'Save the current query console?',
      { modal: true },
      'Save'
    )
    if (choice !== 'Save') {
      return
    }
    const label = deriveLabel(this.currentSql)
    try {
      if (this.target.savedQueryId) {
        await this.queryStore.updateSql(this.target.savedQueryId, this.currentSql)
      } else {
        await this.queryStore.save({
          connectionId: this.target.connectionId,
          database: this.target.database,
          schema: this.target.schema,
          label,
          sql: this.currentSql,
        })
      }
    } catch {
      // ignore persistence errors on close
    }
  }

  private async post(type: string, payload: unknown): Promise<void> {
    if (this.disposed) {
      return
    }
    await this.panel.webview.postMessage({ type, payload })
  }
}

function deriveLabel(sql: string): string {
  const firstLine = sql
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0)
  const label = (firstLine ?? 'Query console').replace(/\s+/g, ' ').slice(0, 50)
  return label || 'Query console'
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}