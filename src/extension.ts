import * as vscode from 'vscode'
import { ConnectionManager } from './database/ConnectionManager'
import { QueryStore } from './database/queryStore'
import {
  DatabaseTreeProvider,
  ConnectionItem,
  SchemaItem,
  TableItem,
  SchemaObjectItem,
  SavedQueryItem,
} from './explorer/DatabaseTreeProvider'
import { WebviewProvider } from './webview/WebviewProvider'
import { TableDataPanel, QueryPanel } from './panels/panels'
import type { TableRef, SchemaRef } from './commands/dataActions'
import {
  dropTable,
  truncateTable,
  dropSchema,
  exportTable,
  importTable,
  exportDatabase,
  importDatabase,
} from './commands/dataActions'

export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  const manager = new ConnectionManager(context)
  const queryStore = new QueryStore(context)

  const treeProvider = new DatabaseTreeProvider(manager, queryStore)
  const treeView = vscode.window.createTreeView('databaseManager.explorer', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
    canSelectMany: false,
  })

  const webview = WebviewProvider.getInstance(context, manager)

  context.subscriptions.push(
    treeView,
    vscode.window.registerWebviewViewProvider(WebviewProvider.viewType, webview, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand('database-manager.addConnection', () =>
      webview.open()
    ),
    vscode.commands.registerCommand('database-manager.editConnection', (item?: ConnectionItem) =>
      webview.open(item?.connectionId)
    ),
    vscode.commands.registerCommand('database-manager.connect', async (item?: ConnectionItem) => {
      if (!item) {
        return
      }
      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Connecting to ${item.connection.name}...`,
          },
          () => manager.connect(item.connection.id)
        )
        treeProvider.refresh()
      } catch (error) {
        void vscode.window.showErrorMessage(toMessage(error))
      }
    }),
    vscode.commands.registerCommand('database-manager.disconnect', async (item?: ConnectionItem) => {
      if (!item) {
        return
      }
      await manager.disconnect(item.connection.id)
      treeProvider.refresh()
    }),
    vscode.commands.registerCommand('database-manager.deleteConnection', async (item?: ConnectionItem) => {
      if (!item) {
        return
      }
      const confirm = await vscode.window.showWarningMessage(
        `Delete connection "${item.connection.name}"?`,
        { modal: true },
        'Delete'
      )
      if (confirm !== 'Delete') {
        return
      }
      await manager.deleteConnection(item.connection.id)
      treeProvider.refresh()
    }),
    vscode.commands.registerCommand('database-manager.refresh', () => treeProvider.refresh()),
    vscode.commands.registerCommand('database-manager.openTable', (ref?: unknown) => {
      const target = tableRefFrom(ref)
      if (!target) {
        return
      }
      TableDataPanel.show(context, manager, target)
    }),
    vscode.commands.registerCommand('database-manager.openQuery', async (ref?: unknown) => {
    const target = schemaRefFrom(ref)
    if (!target) {
      return
    }
    const connection = await manager.getConnection(target.connectionId)
    const dbLabel = target.database || connection?.database || 'database'
    QueryPanel.open(context, manager, queryStore, {
      connectionId: target.connectionId,
      database: target.database,
      schema: target.schema,
      title: `Query • ${target.schema}@${dbLabel}`,
    })
  }),
    vscode.commands.registerCommand('database-manager.openSavedQuery', async (item?: unknown) => {
      const saved = savedQueryItem(item)
      if (!saved) {
        return
      }
      const connection = await manager.getConnection(saved.connectionId)
      const dbLabel = saved.database || connection?.database || 'database'
      QueryPanel.open(context, manager, queryStore, {
        connectionId: saved.connectionId,
        database: saved.database,
        schema: saved.schema,
        sql: saved.sql,
        savedQueryId: saved.id,
        title: `Query • ${saved.label}@${dbLabel}`,
      })
    }),
    vscode.commands.registerCommand('database-manager.deleteSavedQuery', async (item?: unknown) => {
      const saved = savedQueryItem(item)
      if (!saved) {
        return
      }
      const confirm = await vscode.window.showWarningMessage(
        `Delete saved query "${saved.label}"?`,
        { modal: true },
        'Delete'
      )
      if (confirm !== 'Delete') {
        return
      }
      await queryStore.remove(saved.id)
    }),
    vscode.commands.registerCommand('database-manager.renameSavedQuery', async (item?: unknown) => {
      const saved = savedQueryItem(item)
      if (!saved) {
        return
      }
      const label = await vscode.window.showInputBox({
        title: 'Rename Saved Query',
        value: saved.label,
        prompt: 'Enter a new name for this saved query',
        validateInput: (value) => (value.trim() ? undefined : 'Name cannot be empty'),
      })
      if (label === undefined || label.trim() === saved.label) {
        return
      }
      await queryStore.rename(saved.id, label)
    }),
    vscode.commands.registerCommand('database-manager.dropSchema', (ref?: unknown) => {
      const target = schemaRefFrom(ref)
      if (!target) {
        return
      }
      void dropSchema(manager, target).catch(reportError)
    }),
    vscode.commands.registerCommand('database-manager.exportDatabase', (ref?: unknown) => {
      const target = schemaRefFrom(ref)
      if (!target) {
        return
      }
      void exportDatabase(manager, target).catch(reportError)
    }),
    vscode.commands.registerCommand('database-manager.importDatabase', (ref?: unknown) => {
      const target = schemaRefFrom(ref)
      if (!target) {
        return
      }
      void importDatabase(manager, target).catch(reportError)
    }),
    vscode.commands.registerCommand('database-manager.dropTable', (ref?: unknown) => {
      const target = tableRefFrom(ref)
      if (!target) {
        return
      }
      void dropTable(manager, target).catch(reportError)
    }),
    vscode.commands.registerCommand('database-manager.truncateTable', (ref?: unknown) => {
      const target = tableRefFrom(ref)
      if (!target) {
        return
      }
      void truncateTable(manager, target).catch(reportError)
    }),
    vscode.commands.registerCommand('database-manager.exportTable', (ref?: unknown) => {
      const target = tableRefFrom(ref)
      if (!target) {
        return
      }
      void exportTable(manager, target).catch(reportError)
    }),
    vscode.commands.registerCommand('database-manager.importTable', (ref?: unknown) => {
      const target = tableRefFrom(ref)
      if (!target) {
        return
      }
      void importTable(manager, target).catch(reportError)
    })
  )

  console.log('Database Manager activated')
}

export async function deactivate(): Promise<void> {
  // active connections are disposed by the extension host on shutdown
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function reportError(error: unknown): void {
  void vscode.window.showErrorMessage(toMessage(error))
}

function tableRefFrom(item: unknown): TableRef | undefined {
  if (item instanceof SchemaObjectItem) {
    return {
      connectionId: item.connectionId,
      database: item.database,
      schema: item.schema,
      table: item.object.name,
    }
  }
  if (item instanceof TableItem) {
    return {
      connectionId: item.connectionId,
      database: item.database,
      schema: item.table.schema,
      table: item.table.name,
    }
  }
  if (isRecord(item) && typeof item.connectionId === 'string' && typeof item.table === 'string') {
    return item as unknown as TableRef
  }
  return undefined
}

function schemaRefFrom(item: unknown): SchemaRef | undefined {
  if (item instanceof SchemaItem) {
    return { connectionId: item.connectionId, database: item.database, schema: item.schema }
  }
  if (isRecord(item) && typeof item.connectionId === 'string' && typeof item.schema === 'string') {
    return item as unknown as SchemaRef
  }
  return undefined
}

function savedQueryItem(item: unknown) {
  return item instanceof SavedQueryItem ? item.query : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}