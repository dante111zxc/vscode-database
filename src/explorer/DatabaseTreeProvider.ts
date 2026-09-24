import * as vscode from 'vscode'
import type {
  ColumnInfo,
  SavedConnectionConfig,
  SchemaObject,
  SchemaObjectType,
  TableInfo,
} from '../database/types'
import type { ConnectionManager } from '../database/ConnectionManager'
import type { QueryStore, SavedQuery } from '../database/queryStore'
import { getLabelForConfig, getTypeLabel } from '../database/drivers'

export class ConnectionItem extends vscode.TreeItem {
  constructor(
    public readonly connection: SavedConnectionConfig,
    public readonly connected: boolean
  ) {
    super(connection.name, vscode.TreeItemCollapsibleState.Collapsed)
    this.description = `${getTypeLabel(connection.type)} • ${getLabelForConfig(connection)}`
    this.contextValue = 'connection'
    this.tooltip = `${connection.name}\n${this.description}${
      connected ? '\nStatus: Connected' : '\nStatus: Disconnected'
    }`
    this.iconPath = connected
      ? new vscode.ThemeIcon('plug')
      : new vscode.ThemeIcon('database')
  }

  get connectionId(): string {
    return this.connection.id
  }
}

export class DatabaseItem extends vscode.TreeItem {
  constructor(
    public readonly connectionId: string,
    public readonly name: string,
    collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(name, collapsibleState)
    this.description = 'database'
    this.contextValue = 'database'
    this.iconPath = new vscode.ThemeIcon('database')
  }
}

export class SchemaItem extends vscode.TreeItem {
  constructor(
    public readonly connectionId: string,
    public readonly database: string,
    public readonly schema: string
  ) {
    super(schema, vscode.TreeItemCollapsibleState.Collapsed)
    this.description = 'schema'
    this.contextValue = 'schema'
    this.iconPath = new vscode.ThemeIcon('server')
  }
}

export class TableItem extends vscode.TreeItem {
  constructor(
    public readonly connectionId: string,
    public readonly database: string,
    public readonly table: TableInfo
  ) {
    const isView = table.type === 'view'
    super(table.name, vscode.TreeItemCollapsibleState.Collapsed)
    this.description = isView ? 'view' : 'table'
    this.contextValue = isView ? 'view' : 'table'
    this.iconPath = new vscode.ThemeIcon(isView ? 'type-hierarchy' : 'symbol-struct')
    this.command = {
      command: 'database-manager.openTable',
      title: 'Open',
      arguments: [{ connectionId, database, schema: table.schema, table: table.name }],
    }
  }
}

export class SchemaGroupItem extends vscode.TreeItem {
  constructor(
    public readonly connectionId: string,
    public readonly database: string,
    public readonly schema: string,
    public readonly kind: SchemaObjectType,
    public readonly objects: SchemaObject[]
  ) {
    const labels: Record<SchemaObjectType, string> = {
      table: 'Tables',
      view: 'Views',
      sequence: 'Sequences',
      routine: 'Routines',
    }
    super(labels[kind], vscode.TreeItemCollapsibleState.Collapsed)
    this.description = String(objects.length)
    this.contextValue = `group-${kind}`
    this.iconPath = new vscode.ThemeIcon(SchemaObjectItem.iconFor(kind))
  }
}

export class SchemaObjectItem extends vscode.TreeItem {
  constructor(
    public readonly connectionId: string,
    public readonly database: string,
    public readonly schema: string,
    public readonly object: SchemaObject
  ) {
    const hasChildren = object.type === 'table' || object.type === 'view'
    super(object.name, hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None)
    this.description = object.type === 'routine' ? (object.detail ?? 'routine') : undefined
    this.contextValue = object.type
    this.iconPath = new vscode.ThemeIcon(SchemaObjectItem.iconFor(object.type))
    if (hasChildren) {
      this.command = {
        command: 'database-manager.openTable',
        title: 'Open',
        arguments: [{ connectionId, database, schema, table: object.name }],
      }
    }
  }

  public static iconFor(kind: SchemaObjectType): string {
    switch (kind) {
      case 'view':
        return 'type-hierarchy'
      case 'sequence':
        return 'symbol-number'
      case 'routine':
        return 'symbol-method'
      default:
        return 'symbol-struct'
    }
  }
}

export class ColumnItem extends vscode.TreeItem {
  constructor(
    public readonly column: ColumnInfo
  ) {
    const keyMarkers: string[] = []
    if (column.primaryKey) {keyMarkers.push('PK')}
    if (column.autoIncrement) {keyMarkers.push('AI')}
    super(column.name, vscode.TreeItemCollapsibleState.None)
    this.description = [
      column.type,
      keyMarkers.length > 0 ? keyMarkers.join(' ') : '',
      column.nullable ? '' : 'NOT NULL',
    ]
      .filter((p) => p.length > 0)
      .join(' • ')
    this.contextValue = 'column'
    this.iconPath = new vscode.ThemeIcon(column.primaryKey ? 'key' : 'symbol-field')
  }
}

export class SavedQueriesGroupItem extends vscode.TreeItem {
  constructor(
    public readonly queries: SavedQuery[]
  ) {
    super('Saved Queries', vscode.TreeItemCollapsibleState.Collapsed)
    this.description = String(queries.length)
    this.contextValue = 'group-savedquery'
    this.iconPath = new vscode.ThemeIcon('history')
  }
}

export class SavedQueryItem extends vscode.TreeItem {
  constructor(
    public readonly query: SavedQuery
  ) {
    super(query.label || 'Query console', vscode.TreeItemCollapsibleState.None)
    this.description = formatAge(query.savedAt)
    this.contextValue = 'savedquery'
    this.iconPath = new vscode.ThemeIcon('console')
    this.tooltip = query.sql
    this.command = {
      command: 'database-manager.openSavedQuery',
      title: 'Open Query Console',
      arguments: [this],
    }
  }
}

function formatAge(timestamp: number): string {
  const diff = Date.now() - timestamp
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) {
    return 'just now'
  }
  if (minutes < 60) {
    return `${minutes}m ago`
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return `${hours}h ago`
  }
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export class PlaceholderItem extends vscode.TreeItem {
  constructor(label: string) {
    super(label, vscode.TreeItemCollapsibleState.None)
    this.description = undefined
    this.iconPath = new vscode.ThemeIcon('info')
  }
}

export class DatabaseTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<
    vscode.TreeItem | undefined | null | void
  >()

  public readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event

  constructor(
    private readonly manager: ConnectionManager,
    private readonly queryStore: QueryStore
  ) {
    manager.onDidChangeConnections(() => this.refresh())
    manager.onDidChangeConnectionStatus(() => this.refresh())
    queryStore.onDidChange(() => this.refresh())
  }

  public refresh(): void {
    this.onDidChangeTreeDataEmitter.fire()
  }

  public async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (!element) {
      return this.getConnectionItems()
    }
    if (element instanceof ConnectionItem) {
      return this.getDatabaseItems(element)
    }
    if (element instanceof DatabaseItem) {
      return this.getTableItems(element)
    }
    if (element instanceof SchemaItem) {
      return this.getSchemaItems(element)
    }
    if (element instanceof SchemaGroupItem) {
      return element.objects.map(
        (object) =>
          new SchemaObjectItem(element.connectionId, element.database, element.schema, object)
      )
    }
    if (element instanceof SavedQueriesGroupItem) {
      return element.queries.map((query) => new SavedQueryItem(query))
    }
    if (element instanceof SchemaObjectItem) {
      if (element.object.type === 'table' || element.object.type === 'view') {
        return this.getSchemaObjectColumns(element)
      }
      return []
    }
    if (element instanceof TableItem) {
      return this.getColumnItems(element)
    }
    return []
  }

  public getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element
  }

  private async getConnectionItems(): Promise<vscode.TreeItem[]> {
    try {
      const connections = await this.manager.getConnections()
      return connections.map(
        (connection) => new ConnectionItem(connection, this.manager.isConnected(connection.id))
      )
    } catch (error) {
      return [new PlaceholderItem(`Failed to load connections: ${toMessage(error)}`)]
    }
  }

  private async getDatabaseItems(item: ConnectionItem): Promise<vscode.TreeItem[]> {
    const { connectionId } = item
    try {
      if (!this.manager.isConnected(connectionId)) {
        await this.manager.connect(connectionId)
      }
      const driver = this.manager.getDriver(connectionId)
      if (!driver) {
        throw new Error('No active driver for this connection')
      }
      if (driver.isFileBased) {
        const tables = await driver.getTables()
        return this.toTableItems(connectionId, item.connection.database || '', tables)
      }
      const databases = await driver.getDatabases()
      if (databases.length === 0) {
        return [new PlaceholderItem('No databases found')]
      }
      return databases.map(
        (db) =>
          new DatabaseItem(connectionId, db.name, vscode.TreeItemCollapsibleState.Collapsed)
      )
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to load databases: ${toMessage(error)}`)
      return [new PlaceholderItem(`Failed to connect: ${toMessage(error)}`)]
    }
  }

  private async getTableItems(item: DatabaseItem): Promise<vscode.TreeItem[]> {
    try {
      const driver = this.manager.getDriver(item.connectionId)
      if (!driver) {
        throw new Error('Connection is not active')
      }
      const tables = await driver.getTables(item.name)
      if (tables.length === 0) {
        return [new PlaceholderItem('No tables found')]
      }
      const schemas = [...new Set(tables.map((it) => it.schema).filter((s): s is string => Boolean(s)))]
      if (driver.type === 'postgresql' && schemas.length > 0) {
        return schemas.map((schema) => new SchemaItem(item.connectionId, item.name, schema))
      }
      return this.toTableItems(item.connectionId, item.name, tables)
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to load tables: ${toMessage(error)}`)
      return []
    }
  }

  private async getSchemaItems(item: SchemaItem): Promise<vscode.TreeItem[]> {
    try {
      const driver = this.manager.getDriver(item.connectionId)
      if (!driver) {
        throw new Error('Connection is not active')
      }
      const objects = await driver.getSchemaObjects(item.database, item.schema)
      if (objects.length === 0) {
        return [new PlaceholderItem('Empty schema')]
      }
      const groups = new Map<SchemaObjectType, SchemaObject[]>()
      for (const object of objects) {
        const list = groups.get(object.type) ?? []
        list.push(object)
        groups.set(object.type, list)
      }
      const items: vscode.TreeItem[] = [...groups.entries()].map(
        ([kind, list]) =>
          new SchemaGroupItem(item.connectionId, item.database, item.schema, kind, list)
      )
      const saved = await this.queryStore.listForSchema(
        item.connectionId,
        item.database,
        item.schema
      )
      if (saved.length > 0) {
        items.push(new SavedQueriesGroupItem(saved))
      }
      return items
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to load schema objects: ${toMessage(error)}`)
      return []
    }
  }

  private async getSchemaObjectColumns(item: SchemaObjectItem): Promise<vscode.TreeItem[]> {
    try {
      const driver = this.manager.getDriver(item.connectionId)
      if (!driver) {
        throw new Error('Connection is not active')
      }
      const columns = await driver.getColumns(
        item.object.name,
        item.database,
        item.schema
      )
      if (columns.length === 0) {
        return [new PlaceholderItem('No columns')]
      }
      return columns.map((column) => new ColumnItem(column))
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to load columns: ${toMessage(error)}`)
      return []
    }
  }

  private async getColumnItems(item: TableItem): Promise<vscode.TreeItem[]> {
    try {
      const driver = this.manager.getDriver(item.connectionId)
      if (!driver) {
        throw new Error('Connection is not active')
      }
      const columns = await driver.getColumns(
        item.table.name,
        item.database || undefined,
        item.table.schema || undefined
      )
      if (columns.length === 0) {
        return [new PlaceholderItem('No columns')]
      }
      return columns.map((column) => new ColumnItem(column))
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to load columns: ${toMessage(error)}`)
      return []
    }
  }

  private toTableItems(
    connectionId: string,
    database: string,
    tables: TableInfo[]
  ): vscode.TreeItem[] {
    return tables.map(
      (table) => new TableItem(connectionId, database, table)
    )
  }
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}