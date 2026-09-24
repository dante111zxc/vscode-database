export type DatabaseType =
  | 'mysql'
  | 'mariadb'
  | 'postgresql'
  | 'sqlite'

export interface ConnectionConfig {
  id: string
  name: string
  type: DatabaseType
  host: string
  port: number
  username: string
  password: string
  database?: string
  ssl?: boolean
  filePath?: string
}

export interface SavedConnectionConfig extends Omit<ConnectionConfig, 'password'> {}

export interface DatabaseInfo {
  name: string
}

export interface TableInfo {
  name: string
  schema?: string
  type: 'table' | 'view'
}

export type SchemaObjectType = 'table' | 'view' | 'sequence' | 'routine'

export interface SchemaObject {
  name: string
  type: SchemaObjectType
  detail?: string
}

export interface ColumnInfo {
  name: string
  type: string
  nullable: boolean
  defaultValue?: string | null
  primaryKey: boolean
  autoIncrement: boolean
}

export interface QueryResult {
  columns: string[]
  rows: Record<string, unknown>[]
  rowCount: number
  executionTime: number
}

export interface QueryOptions {
  database?: string
  limit?: number
  parameters?: unknown[]
}

export interface DatabaseError {
  code: string
  message: string
  cause?: unknown
}

export interface ConnectionTestResult {
  ok: boolean
  message: string
}