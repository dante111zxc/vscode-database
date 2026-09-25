import { Client } from 'pg'
import type {
  ConnectionConfig,
  ColumnInfo,
  DatabaseInfo,
  QueryResult,
  QueryOptions,
  SchemaObject,
  SchemaObjectType,
  TableInfo,
} from '../types'
import type { DatabaseDriver } from '../contracts/DatabaseDriver'

const SYSTEM_SCHEMAS = ['pg_catalog', 'information_schema']

export class PostgresDriver implements DatabaseDriver {
  public readonly type = 'postgresql'

  public readonly isFileBased = false

  private client: Client | null = null

  public async connect(config: ConnectionConfig): Promise<void> {
    if (this.client) {
      return
    }
    this.client = new Client({
      host: config.host,
      port: config.port,
      user: config.username,
      password: config.password,
      database: config.database,
      ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
      connectionTimeoutMillis: 10000,
    })
    await this.client.connect()
  }

  public async disconnect(): Promise<void> {
    if (!this.client) {
      return
    }
    await this.client.end()
    this.client = null
  }

  public isConnected(): boolean {
    return this.client !== null
  }

  public async ping(): Promise<boolean> {
    if (!this.client) {
      return false
    }
    try {
      await this.client.query('SELECT 1')
      return true
    } catch {
      return false
    }
  }

  public async testConnection(config: ConnectionConfig): Promise<boolean> {
    const client = new Client({
      host: config.host,
      port: config.port,
      user: config.username,
      password: config.password,
      database: config.database,
      ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
      connectionTimeoutMillis: 10000,
    })
    try {
      await client.connect()
      return true
    } finally {
      await client.end().catch(() => undefined)
    }
  }

  public async getDatabases(): Promise<DatabaseInfo[]> {
    const rows = await this.queryRows<{ datname: string }>(
      'SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname',
      undefined
    )
    return rows.map((row) => ({ name: row.datname }))
  }

  public async getTables(database?: string, schema?: string): Promise<TableInfo[]> {
    await this.ensureDatabase(database)
    const schemaFilter = schema
      ? ` AND table_schema = $${SYSTEM_SCHEMAS.length + 1} `
      : ''
    const params = schema ? [...SYSTEM_SCHEMAS, schema] : SYSTEM_SCHEMAS
    const rows = await this.queryRows<{
      tableName: string
      tableSchema: string
      tableType: string
    }>(
      'SELECT table_name AS "tableName", table_schema AS "tableSchema", table_type AS "tableType" ' +
        'FROM information_schema.tables ' +
        'WHERE table_schema NOT IN (' +
        SYSTEM_SCHEMAS.map((_, i) => `$${i + 1}`).join(', ') +
        ") AND table_type IN ('BASE TABLE', 'VIEW') " +
        schemaFilter +
        'ORDER BY table_schema, table_name',
      params
    )
    return rows.map((row) => ({
      name: row.tableName,
      schema: row.tableSchema,
      type: row.tableType === 'VIEW' ? 'view' : 'table',
    }))
  }

  public async getSchemaObjects(database?: string, schema?: string): Promise<SchemaObject[]> {
    await this.ensureDatabase(database)
    const schemaName = schema || 'public'
    const rows = await this.queryRows<{
      objectName: string
      objectType: string
      detail: string | null
    }>(
      `SELECT name AS "objectName", kind AS "objectType", detail FROM (
        SELECT table_name AS name, table_type AS kind, NULL AS detail
        FROM information_schema.tables
        WHERE table_schema = $1 AND table_type IN ('BASE TABLE', 'VIEW')
        UNION ALL
        SELECT sequence_name AS name, 'SEQUENCE' AS kind, NULL AS detail
        FROM information_schema.sequences
        WHERE sequence_schema = $1
        UNION ALL
        SELECT routine_name AS name, 'ROUTINE' AS kind, routine_type AS detail
        FROM information_schema.routines
        WHERE specific_schema = $1
      ) AS schema_objects ORDER BY kind, name`,
      [schemaName]
    )
    return rows.map((row) => ({
      name: row.objectName,
      type: schemaObjectType(row.objectType),
      detail: row.detail ?? undefined,
    }))
  }

  public async getColumns(table: string, database?: string, schema?: string): Promise<ColumnInfo[]> {
    await this.ensureDatabase(database)
    const rows = await this.queryRows<{
      name: string
      dataType: string
      nullable: string
      defaultValue: string | null
      primaryKey: boolean
      autoIncrement: boolean
    }>(
      'SELECT c.column_name AS name, ' +
        'c.data_type AS "dataType", ' +
        'c.is_nullable AS nullable, ' +
        'c.column_default AS "defaultValue", ' +
        'CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END AS "primaryKey", ' +
        "(COALESCE(c.column_default, '') LIKE 'nextval(%') AS \"autoIncrement\" " +
        'FROM information_schema.columns c ' +
        'LEFT JOIN information_schema.table_constraints tc ' +
        '  ON tc.table_schema = c.table_schema AND tc.table_name = c.table_name ' +
        "  AND tc.constraint_type = 'PRIMARY KEY' " +
        'LEFT JOIN information_schema.key_column_usage pk ' +
        '  ON pk.constraint_name = tc.constraint_name ' +
        '  AND pk.table_schema = c.table_schema ' +
        '  AND pk.table_name = c.table_name ' +
        '  AND pk.column_name = c.column_name ' +
        'WHERE c.table_schema = $1 AND c.table_name = $2 ' +
        'ORDER BY c.ordinal_position',
      [schema || 'public', table]
    )
    return rows.map((row) => ({
      name: row.name,
      type: row.dataType,
      nullable: row.nullable === 'YES',
      defaultValue: row.defaultValue,
      primaryKey: row.primaryKey,
      autoIncrement: row.autoIncrement,
    }))
  }

  public async execute(sql: string, options?: QueryOptions): Promise<QueryResult> {
    if (!this.client) {
      throw new Error('Database is not connected')
    }
    await this.ensureDatabase(options?.database)
    const start = process.hrtime.bigint()
    const result = await this.client.query(sql, (options?.parameters ?? []) as never[])
    const executionTime = Number(process.hrtime.bigint() - start) / 1e6
    const rowObjects = (result.rows ?? []) as Record<string, unknown>[]
    const columns = rowObjects.length > 0 ? Object.keys(rowObjects[0]) : result.fields.map((f) => f.name)
    return {
      columns,
      rows: rowObjects,
      rowCount: result.rowCount ?? rowObjects.length,
      executionTime,
    }
  }

  private async queryRows<T>(sql: string, params?: unknown[]): Promise<T[]> {
    if (!this.client) {
      throw new Error('Database is not connected')
    }
    const result = await this.client.query(sql, params as never[])
    return (result.rows ?? []) as T[]
  }

  public async paginate(
    table: string,
    database?: string,
    schema?: string,
    limit = 100,
    offset = 0
  ): Promise<QueryResult> {
    await this.ensureDatabase(database)
    const schemaName = schema || 'public'
    const start = process.hrtime.bigint()
    const rows = await this.queryRows<Record<string, unknown>>(
      `SELECT * FROM "${quoteIdent(schemaName)}"."${quoteIdent(table)}" LIMIT $1 OFFSET $2`,
      [limit, offset]
    )
    return {
      columns: rows.length > 0 ? Object.keys(rows[0]) : [],
      rows,
      rowCount: rows.length,
      executionTime: Number(process.hrtime.bigint() - start) / 1e6,
    }
  }

  public async count(table: string, database?: string, schema?: string): Promise<number> {
    await this.ensureDatabase(database)
    const schemaName = schema || 'public'
    const rows = await this.queryRows<{ total: unknown }>(
      `SELECT COUNT(*) AS total FROM "${quoteIdent(schemaName)}"."${quoteIdent(table)}"`,
      undefined
    )
    return Number(rows[0]?.total ?? 0)
  }

  private async ensureDatabase(database?: string): Promise<void> {
    if (!this.client) {
      throw new Error('Database is not connected')
    }
    if (!database || database === this.currentDatabase()) {
      return
    }
    const { host, port, user, password } = this.client
    await this.client.end()
    this.client = new Client({ host, port, user, password, database })
    await this.client.connect()
  }

  private currentDatabase(): string {
    if (!this.client) {
      throw new Error('Database is not connected')
    }
    return this.client.database || ''
  }
}

function schemaObjectType(kind: string): SchemaObjectType {
  switch (kind) {
    case 'VIEW':
      return 'view'
    case 'SEQUENCE':
      return 'sequence'
    case 'ROUTINE':
      return 'routine'
    default:
      return 'table'
  }
}

function quoteIdent(name: string): string {
  if (!name) {
    throw new Error('Database object name is required')
  }
  return name.replace(/"/g, '""')
}