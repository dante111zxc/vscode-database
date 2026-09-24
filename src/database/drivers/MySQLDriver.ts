import mysql from 'mysql2/promise'
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

const SYSTEM_DATABASES = ['information_schema', 'performance_schema', 'sys', 'mysql']

export class MySQLDriver implements DatabaseDriver {
  public readonly type = 'mysql'

  public readonly isFileBased = false

  private connection: mysql.Connection | null = null

  public async connect(config: ConnectionConfig): Promise<void> {
    if (this.connection) {
      return
    }
    this.connection = await mysql.createConnection({
      host: config.host,
      port: config.port,
      user: config.username,
      password: config.password,
      database: config.database,
      ssl: config.ssl ? {} : undefined,
      supportBigNumbers: true,
      bigNumberStrings: true,
      connectTimeout: 10000,
    })
    await this.connection.connect()
  }

  public async disconnect(): Promise<void> {
    if (!this.connection) {
      return
    }
    await this.connection.end()
    this.connection = null
  }

  public isConnected(): boolean {
    return this.connection !== null
  }

  public async testConnection(config: ConnectionConfig): Promise<boolean> {
    let conn: mysql.Connection | null = null
    try {
      conn = await mysql.createConnection({
        host: config.host,
        port: config.port,
        user: config.username,
        password: config.password,
        database: config.database,
        ssl: config.ssl ? {} : undefined,
        connectTimeout: 10000,
      })
      await conn.connect()
      return true
    } finally {
      if (conn) {
        await conn.end().catch(() => undefined)
      }
    }
  }

  public async getDatabases(): Promise<DatabaseInfo[]> {
    const rows = await this.queryRows<{ Database: string }>('SHOW DATABASES')
    return rows
      .map((row) => row.Database)
      .filter((name) => name && !SYSTEM_DATABASES.includes(name))
      .map((name) => ({ name }))
  }

  public async getTables(database?: string, _schema?: string): Promise<TableInfo[]> {
    const dbName = database || this.currentDatabase()
    const rows = await this.queryRows<{ name: string; tableType: string; tableSchema: string }>(
      'SELECT TABLE_NAME AS name, TABLE_TYPE AS tableType, TABLE_SCHEMA AS tableSchema ' +
        'FROM information_schema.TABLES ' +
        'WHERE TABLE_SCHEMA = ? ' +
        'ORDER BY TABLE_NAME',
      [dbName]
    )
    return rows.map((row) => ({
      name: row.name,
      schema: row.tableSchema,
      type: row.tableType === 'VIEW' ? 'view' : 'table',
    }))
  }

  public async getSchemaObjects(database?: string, _schema?: string): Promise<SchemaObject[]> {
    const dbName = database || this.currentDatabase()
    const tables = await this.getTables(dbName)
    return tables.map((table) => ({
      name: table.name,
      type: table.type,
    }))
  }

  public async getColumns(table: string, database?: string, _schema?: string): Promise<ColumnInfo[]> {
    const dbName = database || this.currentDatabase()
    const rows = await this.queryRows<{
      name: string
      dataType: string
      isNullable: string
      defaultValue: string | null
      columnKey: string
      extra: string
    }>(
      'SELECT COLUMN_NAME AS name, DATA_TYPE AS dataType, IS_NULLABLE AS isNullable, ' +
        'COLUMN_DEFAULT AS defaultValue, COLUMN_KEY AS columnKey, EXTRA AS extra ' +
        'FROM information_schema.COLUMNS ' +
        'WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ' +
        'ORDER BY ORDINAL_POSITION',
      [dbName, table]
    )
    return rows.map((row) => ({
      name: row.name,
      type: row.dataType,
      nullable: row.isNullable === 'YES',
      defaultValue: row.defaultValue,
      primaryKey: row.columnKey === 'PRI',
      autoIncrement: row.extra.toLowerCase().includes('auto_increment'),
    }))
  }

  public async execute(sql: string, options?: QueryOptions): Promise<QueryResult> {
    if (!this.connection) {
      throw new Error('Database is not connected')
    }
    if (options?.database) {
      await this.connection.changeUser({ database: options.database })
    }
    const start = process.hrtime.bigint()
    const [rows] = await this.connection.query(sql, options?.parameters ?? [])
    const executionTime = Number(process.hrtime.bigint() - start) / 1e6

    if (Array.isArray(rows)) {
      const rowObjects = rows as Record<string, unknown>[]
      const columns = rowObjects.length > 0 ? Object.keys(rowObjects[0]) : []
      return { columns, rows: rowObjects, rowCount: rowObjects.length, executionTime }
    }

    const result = rows as mysql.ResultSetHeader
    return { columns: [], rows: [], rowCount: result.affectedRows ?? 0, executionTime }
  }

  public async paginate(
    table: string,
    database?: string,
    _schema?: string,
    limit = 100,
    offset = 0
  ): Promise<QueryResult> {
    const dbName = database || this.currentDatabase()
    return this.execute(
      `SELECT * FROM \`${quoteIdent(dbName)}\`.\`${quoteIdent(table)}\` LIMIT ? OFFSET ?`,
      { database: dbName, parameters: [limit, offset] }
    )
  }

  public async count(table: string, database?: string, _schema?: string): Promise<number> {
    const dbName = database || this.currentDatabase()
    const result = await this.execute(
      `SELECT COUNT(*) AS total FROM \`${quoteIdent(dbName)}\`.\`${quoteIdent(table)}\``,
      { database: dbName }
    )
    const row = result.rows[0] as Record<string, unknown> | undefined
    return Number(row?.total ?? 0)
  }

  private async queryRows<T>(sql: string, params?: unknown[]): Promise<T[]> {
    if (!this.connection) {
      throw new Error('Database is not connected')
    }
    const [rows] = await this.connection.query(sql, params)
    return (Array.isArray(rows) ? rows : []) as T[]
  }

  private currentDatabase(): string {
    if (!this.connection) {
      throw new Error('Database is not connected')
    }
    return this.connection.config.database || ''
  }
}

function quoteIdent(name: string): string {
  if (!name) {
    throw new Error('Database object name is required')
  }
  return name.replace(/`/g, '``')
}