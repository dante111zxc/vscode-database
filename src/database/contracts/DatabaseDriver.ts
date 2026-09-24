import type {
  ConnectionConfig,
  DatabaseInfo,
  TableInfo,
  SchemaObject,
  ColumnInfo,
  QueryResult,
  QueryOptions,
} from '../types'


export interface DatabaseDriver {
  /**
   * Database engine type.
   */
  readonly type: string

  /**
   * Whether the database is a single-file database (e.g. SQLite).
   * File based drivers expose tables directly without a database level.
   */
  readonly isFileBased: boolean

  /**
   * Establish connection to database.
   */
  connect(config: ConnectionConfig): Promise<void>

  /**
   * Close current connection.
   */
  disconnect(): Promise<void>

  /**
   * Check whether connection is alive.
   */
  isConnected(): boolean

  /**
   * Test database connection.
   */
  testConnection(config: ConnectionConfig): Promise<boolean>

  /**
   * Get all databases.
   */
  getDatabases(): Promise<DatabaseInfo[]>

  /**
   * Get tables/views from a database.
   * @param database Target database (or file path for file-based drivers). If omitted, uses the current connection.
   * @param schema Optional schema to filter by (e.g. PostgreSQL namespaces).
   */
  getTables(database?: string, schema?: string): Promise<TableInfo[]>

  /**
   * Get all objects (tables, views, sequences, routines) inside a schema.
   * @param schema Optional schema to filter by. If omitted, uses a driver default.
   */
  getSchemaObjects(database?: string, schema?: string): Promise<SchemaObject[]>

  /**
   * Get table columns.
   * @param schema Optional schema the table belongs to.
   */
  getColumns(
    table: string,
    database?: string,
    schema?: string
  ): Promise<ColumnInfo[]>

  /**
   * Fetch one page of rows from a table for data preview.
   */
  paginate(
    table: string,
    database?: string,
    schema?: string,
    limit?: number,
    offset?: number
  ): Promise<QueryResult>

  /**
   * Count total rows in a table.
   */
  count(
    table: string,
    database?: string,
    schema?: string
  ): Promise<number>

  /**
   * Execute SQL query.k
   */
  execute(
    sql: string,
    options?: QueryOptions
  ): Promise<QueryResult>
}