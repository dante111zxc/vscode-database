import { DatabaseSync } from 'node:sqlite'
import * as path from 'node:path'
import type {
  ConnectionConfig,
  ColumnInfo,
  DatabaseInfo,
  QueryResult,
  QueryOptions,
  SchemaObject,
  TableInfo,
} from '../types'
import type { DatabaseDriver } from '../contracts/DatabaseDriver'

export class SQLiteDriver implements DatabaseDriver {
  public readonly type = 'sqlite'

  public readonly isFileBased = true

  private db: DatabaseSync | null = null

  private config: ConnectionConfig | null = null

  public async connect(config: ConnectionConfig): Promise<void> {
    if (this.db) {
      return
    }
    if (!config.filePath) {
      throw new Error('Database file path is required for SQLite')
    }
    this.config = config
    this.db = new DatabaseSync(config.filePath)
  }

  public async disconnect(): Promise<void> {
    if (!this.db) {
      return
    }
    this.db.close()
    this.db = null
    this.config = null
  }

  public isConnected(): boolean {
    return this.db !== null
  }

  public async ping(): Promise<boolean> {
    if (!this.db) {
      return false
    }
    try {
      this.db.prepare('SELECT 1').get()
      return true
    } catch {
      return false
    }
  }

  public async testConnection(config: ConnectionConfig): Promise<boolean> {
    if (!config.filePath) {
      throw new Error('Database file path is required for SQLite')
    }
    const db = new DatabaseSync(config.filePath, { readOnly: false })
    db.close()
    return true
  }

  public async getDatabases(): Promise<DatabaseInfo[]> {
    const db = this.requireDatabase()
    if (!this.config) {
      return []
    }
    const name =
      this.config.database ||
      (this.config.filePath ? path.basename(this.config.filePath) : 'database')
    return [{ name }]
  }

  public async getTables(database?: string, _schema?: string): Promise<TableInfo[]> {
    const db = this.requireDatabase()
    const stmt = db.prepare(
      "SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') " +
        "AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )
    const rows = stmt.all() as unknown as { name: string; type: string }[]
    return rows.map((row) => ({
      name: row.name,
      type: row.type === 'view' ? 'view' : 'table',
    }))
  }

  public async getSchemaObjects(database?: string, schema?: string): Promise<SchemaObject[]> {
    const tables = await this.getTables(database, schema)
    return tables.map((table) => ({
      name: table.name,
      type: table.type,
    }))
  }

  public async getColumns(table: string, _database?: string, _schema?: string): Promise<ColumnInfo[]> {
    const db = this.requireDatabase()
    const columnRows = db
      .prepare(`PRAGMA table_info("${table}")`)
      .all() as unknown as {
      name: string
      type: string
      notnull: number
      dflt_value: string | null
      pk: number
    }[]

    const sql = db.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(table) as
      | { sql: string | null }
      | undefined

    return columnRows.map((row) => ({
      name: row.name,
      type: row.type || 'ANY',
      nullable: row.notnull === 0,
      defaultValue: row.dflt_value,
      primaryKey: row.pk > 0,
      autoIncrement: /AUTOINCREMENT/i.test(sql?.sql || ''),
    }))
  }

  public async execute(sql: string, options?: QueryOptions): Promise<QueryResult> {
    const db = this.requireDatabase()
    const params = options?.parameters ?? []
    if (options?.limit && options.limit > 0 && /^\s*select\b/i.test(sql)) {
      sql = `${sql.replace(/;+\s*$/, '')} LIMIT ${Math.floor(options.limit)}`
    }
    const start = process.hrtime.bigint()
    const stmt = db.prepare(sql)
    const columns = stmt.columns()
    if (columns.length > 0) {
      const rows = stmt.all(...(params as never[])) as unknown as Record<string, unknown>[]
      const executionTime = Number(process.hrtime.bigint() - start) / 1e6
      return {
        columns: columns.map((c) => c.name),
        rows,
        rowCount: rows.length,
        executionTime,
      }
    }
    const changes = stmt.run(...(params as never[]))
    const executionTime = Number(process.hrtime.bigint() - start) / 1e6
    return {
      columns: [],
      rows: [],
      rowCount: Number(changes.changes) || 0,
      executionTime,
    }
  }

  public async paginate(
    table: string,
    _database?: string,
    _schema?: string,
    limit = 100,
    offset = 0
  ): Promise<QueryResult> {
    const db = this.requireDatabase()
    const start = process.hrtime.bigint()
    const stmt = db.prepare(`SELECT * FROM "${quoteIdent(table)}" LIMIT ? OFFSET ?`)
    const rows = stmt.all(limit, offset) as unknown as Record<string, unknown>[]
    return {
      columns: stmt.columns().map((c) => c.name),
      rows,
      rowCount: rows.length,
      executionTime: Number(process.hrtime.bigint() - start) / 1e6,
    }
  }

  public async count(table: string, _database?: string, _schema?: string): Promise<number> {
    const db = this.requireDatabase()
    const row = db
      .prepare(`SELECT COUNT(*) AS total FROM "${quoteIdent(table)}"`)
      .get() as { total: number } | undefined
    return Number(row?.total ?? 0)
  }

  private requireDatabase(): DatabaseSync {
    if (!this.db) {
      throw new Error('Database is not connected')
    }
    return this.db
  }
}

function quoteIdent(name: string): string {
  if (!name) {
    throw new Error('Database object name is required')
  }
  return name.replace(/"/g, '""')
}