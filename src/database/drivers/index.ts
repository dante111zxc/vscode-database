import type { DatabaseType } from '../types'
import type { DatabaseDriver } from '../contracts/DatabaseDriver'
import { MySQLDriver } from './MySQLDriver'
import { PostgresDriver } from './PostgresDriver'
import { SQLiteDriver } from './SQLiteDriver'

export function createDriver(type: DatabaseType): DatabaseDriver {
  switch (type) {
    case 'mysql':
    case 'mariadb':
      return new MySQLDriver()
    case 'postgresql':
      return new PostgresDriver()
    case 'sqlite':
      return new SQLiteDriver()
    default:
      throw new Error(`Unsupported database type: ${type}`)
  }
}

export interface DriverConfigView {
  type: DatabaseType
  host: string
  port: number
  database?: string
  filePath?: string
}

export function getLabelForConfig(config: DriverConfigView): string {
  switch (config.type) {
    case 'sqlite':
      return config.filePath || config.database || 'SQLite database'
    case 'mysql':
    case 'mariadb':
      return `${config.host}:${config.port}${config.database ? `/${config.database}` : ''}`
    case 'postgresql':
      return `${config.host}:${config.port}${config.database ? `/${config.database}` : ''}`
    default:
      return config.host
  }
}

export function getTypeLabel(type: DatabaseType): string {
  switch (type) {
    case 'mysql':
      return 'MySQL'
    case 'mariadb':
      return 'MariaDB'
    case 'postgresql':
      return 'PostgreSQL'
    case 'sqlite':
      return 'SQLite'
    default:
      return type
  }
}

export function getDefaultPort(type: DatabaseType): number {
  switch (type) {
    case 'mysql':
    case 'mariadb':
      return 3306
    case 'postgresql':
      return 5432
    case 'sqlite':
      return 0
    default:
      return 0
  }
}

export type { DatabaseDriver } from '../contracts/DatabaseDriver'